"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  COURSE_LEVEL_LABELS,
  LEARNING_FEATURED_LIMIT,
  type AdminCourseView,
  type LinkStatus,
  type SyncRunView,
  type UpdateCourseCurationInput,
} from "@chartermission/contracts";
import { Chip, FilterSelect, Icon, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { SkeletonBar, SkeletonCard, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import { SyncPanel } from "./sync-panel";
import { T, useT } from "@/i18n/client";

type Patch = Partial<Pick<AdminCourseView, "hidden" | "featured">>;
type Filters = { q: string; link: "" | LinkStatus; visibility: "" | "visible" | "hidden" | "removed"; featured: "" | "yes" | "no"; topic: string };

const NO_FILTERS: Filters = { q: "", link: "", visibility: "", featured: "", topic: "" };

const LINK_OPTIONS = [
  { value: "", label: "Any link status" },
  { value: "broken", label: "Broken links" },
  { value: "ok", label: "Working links" },
  { value: "unknown", label: "Not checked yet" },
];
const VISIBILITY_OPTIONS = [
  { value: "", label: "Any visibility" },
  { value: "visible", label: "Visible to members" },
  { value: "hidden", label: "Hidden by an admin" },
  { value: "removed", label: "Removed from source" },
];
const FEATURED_OPTIONS = [
  { value: "", label: "Featured or not" },
  { value: "yes", label: "Featured" },
  { value: "no", label: "Not featured" },
];

const LINK_CHIP: Record<LinkStatus, { label: string; tone: "success" | "error" | "neutral"; icon: "check" | "alert" | "clock" }> = {
  ok: { label: "Link OK", tone: "success", icon: "check" },
  broken: { label: "Broken", tone: "error", icon: "alert" },
  unknown: { label: "Unchecked", tone: "neutral", icon: "clock" },
};

/** Visible to members: not hidden by an admin, still in the Charter Center feed. */
const isVisible = (c: AdminCourseView) => !c.hidden && !c.removedAt;

function matches(c: AdminCourseView, f: Filters) {
  if (f.link && c.linkStatus !== f.link) return false;
  if (f.visibility === "visible" && !isVisible(c)) return false;
  if (f.visibility === "hidden" && !c.hidden) return false;
  if (f.visibility === "removed" && !c.removedAt) return false;
  if (f.featured === "yes" && !c.featured) return false;
  if (f.featured === "no" && c.featured) return false;
  if (f.topic && !c.topics.some((t) => t.slug === f.topic)) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${c.title} ${c.provider} ${c.externalId}`.toLowerCase().includes(q)) return false;
  return true;
}

function LinkBadge({ course }: { course: AdminCourseView }) {
  const chip = LINK_CHIP[course.linkStatus];
  return (
    <span className="flex flex-col gap-0.5">
      <Chip tone={chip.tone} className="gap-1 self-start px-2! py-0.5! text-xs!">
        <Icon name={chip.icon} size={12} />
        {chip.label}
        {course.httpStatus !== null && course.linkStatus !== "unknown" && <span className="font-normal">· {course.httpStatus}</span>}
      </Chip>
      <span className="text-xs text-secondary">
        {course.lastCheckedAt ? (
          <>
            Checked <DateTime iso={course.lastCheckedAt} dateOnly />
          </>
        ) : (
          "Never checked"
        )}
      </span>
    </span>
  );
}

function CharterCenterLink({ course, label = "Charter Center" }: { course: AdminCourseView; label?: string }) {
  return (
    <a
      href={course.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline"
    >
      {label}
      <Icon name="external" size={12} />
      <span className="sr-only"><T vars={{ title: course.title }}>{": {title} (opens in a new tab)"}</T></span>
    </a>
  );
}

/**
 * Learning catalogue curation: Charter Center owns the content; admins only hide/unhide and
 * feature/unfeature (PATCH /admin/courses/:id), see link status and run syncs. Changes apply
 * optimistically and roll back if the API refuses.
 */
export function CoursesWorkspace({ courses, truncated, runs }: { courses: AdminCourseView[]; truncated: boolean; runs: SyncRunView[] }) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const [, startRefresh] = useTransition();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [confirmHide, setConfirmHide] = useState<AdminCourseView | null>(null);

  const rows = courses.map((c) => (patches[c.id] ? { ...c, ...patches[c.id] } : c));
  const topics = [...new Map(rows.flatMap((c) => c.topics).map((t) => [t.slug, t])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const broken = rows.filter((c) => c.linkStatus === "broken");
  const shown = rows
    .filter((c) => matches(c, filters))
    // Broken links first, then featured, then A–Z.
    .sort(
      (a, b) =>
        Number(b.linkStatus === "broken") - Number(a.linkStatus === "broken") ||
        Number(b.featured) - Number(a.featured) ||
        a.title.localeCompare(b.title),
    );
  const featuredVisible = rows.filter((c) => c.featured && isVisible(c)).length;
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const charterCenterOrigin = (() => {
    try {
      return courses[0] ? new URL(courses[0].sourceUrl).origin : null;
    } catch {
      return null;
    }
  })();

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  async function curate(course: AdminCourseView, change: UpdateCourseCurationInput, done: string) {
    const previous = patches[course.id];
    setSaving((s) => new Set(s).add(course.id));
    setPatches((p) => ({ ...p, [course.id]: { ...p[course.id], ...change } }));
    try {
      const updated = await api<AdminCourseView>(`/admin/courses/${course.id}`, { method: "PATCH", body: change });
      setPatches((p) => ({ ...p, [course.id]: { hidden: updated.hidden, featured: updated.featured } }));
      toast(done);
      startRefresh(() => router.refresh());
    } catch (e) {
      setPatches((p) => {
        const next = { ...p };
        if (previous) next[course.id] = previous;
        else delete next[course.id];
        return next;
      });
      const message = isApiError(e, "FORBIDDEN") ? "Your role can’t curate courses." : errorMessage(e);
      toast(t("“{title}” wasn’t changed. {message}", { title: course.title, message }), "error");
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(course.id);
        return next;
      });
    }
  }

  function toggleFeatured(course: AdminCourseView) {
    const featured = !course.featured;
    const overLimit = featured && featuredVisible >= LEARNING_FEATURED_LIMIT;
    void curate(
      course,
      { featured },
      featured
        ? `${t("“{title}” featured.", { title: course.title })}${overLimit ? ` ${t("The Learning page shows the {LEARNINGFEATUREDLIMIT} newest featured courses.", { LEARNINGFEATUREDLIMIT: LEARNING_FEATURED_LIMIT })}` : ""}`
        : t("“{title}” no longer featured.", { title: course.title }),
    );
  }

  function toggleHidden(course: AdminCourseView) {
    if (course.hidden) void curate(course, { hidden: false }, t("“{title}” is visible to members again.", { title: course.title }));
    else setConfirmHide(course);
  }

  const actionButton = (className?: string) => buttonClasses({ variant: "secondary", size: "small", className: cn("px-2.5!", className) });

  return (
    <>
      <div className="flex items-start gap-3 rounded-card border border-info/30 bg-info-light p-4">
        <Icon name="book" size={20} className="mt-0.5 shrink-0 text-info" />
        <div className="flex flex-col gap-1 text-sm text-body">
          <p className="font-medium text-ink">Course content is managed on Charter Center</p>
          <p>
            Titles, descriptions, lessons and links come from Charter Center and can’t be edited here. To change a course, edit it
            on Charter Center; it updates at the next sync. Here you can hide a course from members or feature it on the Learning page.
          </p>
          {charterCenterOrigin && (
            <a
              href={charterCenterOrigin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-start rounded-sm font-medium text-primary hover:underline"
            >
              Open Charter Center
              <Icon name="external" size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>

      {broken.length > 0 && (
        <section aria-labelledby={`${ids}-broken`} className="flex flex-col gap-3 rounded-card border border-error/40 bg-card p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-error-light text-error">
              <Icon name="alert" size={16} />
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 id={`${ids}-broken`} className="text-md font-semibold text-ink">
                {broken.length} broken {broken.length === 1 ? "link" : "links"}
              </h2>
              <p className="text-sm text-secondary">
                Members can’t start these courses: “Start learning” is hidden until a link check succeeds. Fix the link on Charter
                Center, then run a link check.
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {broken.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span dir="auto" className="truncate text-sm font-medium text-ink">
                    {c.title}
                  </span>
                  <span className="truncate text-xs text-secondary">
                    {c.httpStatus !== null ? t("HTTP {httpStatus}", { httpStatus: c.httpStatus }) : "No response"} ·{" "}
                    {c.lastCheckedAt ? (
                      <>
                        last checked <DateTime iso={c.lastCheckedAt} />
                      </>
                    ) : (
                      "never checked"
                    )}{" "}
                    · <span className="break-all">{c.sourceUrl}</span>
                  </span>
                </div>
                <CharterCenterLink course={c} label="Open link" />
                {c.hidden && <Chip tone="neutral" className="px-2! py-0.5! text-xs!">Hidden</Chip>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SyncPanel initialRuns={runs} />

      <div role="group" aria-label="Filter courses" className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[320px]">
          <label htmlFor={`${ids}-q`} className="sr-only">
            Search courses by title or provider
          </label>
          <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 text-secondary" />
          <input
            id={`${ids}-q`}
            type="search"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search title or provider"
            className={inputClasses(false, "py-1.5 pr-3 pl-8")}
          />
        </div>
        <FilterSelect label="Link status" options={LINK_OPTIONS} value={filters.link} onChange={(e) => set("link", e.target.value as Filters["link"])} />
        <FilterSelect
          label="Visibility"
          options={VISIBILITY_OPTIONS}
          value={filters.visibility}
          onChange={(e) => set("visibility", e.target.value as Filters["visibility"])}
        />
        <FilterSelect
          label="Featured"
          options={FEATURED_OPTIONS}
          value={filters.featured}
          onChange={(e) => set("featured", e.target.value as Filters["featured"])}
        />
        <FilterSelect
          label="Topic"
          options={[{ value: "", label: "All topics" }, ...topics.map((t) => ({ value: t.slug, label: t.name }))]}
          value={filters.topic}
          onChange={(e) => set("topic", e.target.value)}
        />
        {filtered && (
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2"
          >
            Clear filters
          </button>
        )}
      </div>

      <p className="-mt-2 text-xs text-secondary" aria-live="polite">
        <T vars={{ count: shown.length, count2: rows.length, featuredVisible, LEARNINGFEATUREDLIMIT: LEARNING_FEATURED_LIMIT }}>{"Showing {count} of {count2} courses · {featuredVisible} featured (the Learning page shows up to {LEARNINGFEATUREDLIMIT})"}</T>
      </p>
      {truncated && <FormNotice tone="warning">Only the first 1,000 courses are listed. Use search to find others.</FormNotice>}

      <div className="overflow-hidden rounded-card border border-line bg-card">
        {shown.length === 0 ? (
          <EmptyState icon="book" title={rows.length === 0 ? "No courses yet" : "No courses match these filters"}>
            {rows.length === 0 ? "Run a sync to pull the catalogue from Charter Center." : "Try a different filter or clear them."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] table-fixed border-collapse text-left">
              <caption className="sr-only">Courses synced from Charter Center, broken links first</caption>
              <thead className="bg-muted text-label text-secondary uppercase">
                <tr>
                  <th scope="col" className="py-3 pr-3 pl-4 font-semibold">Course</th>
                  <th scope="col" className="hidden w-[180px] py-3 pr-3 font-semibold xl:table-cell">Topics · level</th>
                  <th scope="col" className="w-[150px] py-3 pr-3 font-semibold">Link</th>
                  <th scope="col" className="w-[150px] py-3 pr-3 font-semibold">Members see</th>
                  <th scope="col" className="w-[188px] py-3 pr-4 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const busy = saving.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      aria-busy={busy}
                      className={cn("border-t border-line align-top text-sm first:border-t-0", c.linkStatus === "broken" && "bg-error-light/40", busy && "opacity-70")}
                    >
                      <td className="py-3 pr-3 pl-4">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span dir="auto" className="truncate font-medium text-ink" title={c.title}>
                              {c.title}
                            </span>
                            {c.featured && <Icon name="flame" size={14} className="shrink-0 text-accent" label="Featured" />}
                          </span>
                          <span className="truncate text-xs text-secondary">
                            {c.provider} · {c.languageName}
                            {c.durationLabel ? ` · ${c.durationLabel}` : ""}
                            {!c.free && " · Paid"}
                          </span>
                          <span className="truncate text-xs text-secondary xl:hidden">
                            {c.topics.map((t) => t.name).join(", ")} · {COURSE_LEVEL_LABELS[c.level]}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 text-xs text-secondary">
                            <CharterCenterLink course={c} />
                            <span>{c.clicks30d} {c.clicks30d === 1 ? "click" : "clicks"} in 30 days</span>
                          </span>
                        </div>
                      </td>
                      <td className="hidden py-3 pr-3 xl:table-cell">
                        <span className="block truncate text-body">{c.topics.map((t) => t.name).join(", ") || "—"}</span>
                        <span className="block text-xs text-secondary">{COURSE_LEVEL_LABELS[c.level]}</span>
                      </td>
                      <td className="py-3 pr-3">
                        <LinkBadge course={c} />
                      </td>
                      <td className="py-3 pr-3">
                        <span className="flex flex-col items-start gap-1">
                          {c.removedAt ? (
                            <Chip tone="warning" className="px-2! py-0.5! text-xs!">Removed from source</Chip>
                          ) : c.hidden ? (
                            <Chip tone="neutral" className="gap-1 px-2! py-0.5! text-xs!">
                              <Icon name="eye-off" size={12} />
                              Hidden
                            </Chip>
                          ) : (
                            <Chip tone="success" className="gap-1 px-2! py-0.5! text-xs!">
                              <Icon name="eye" size={12} />
                              Visible
                            </Chip>
                          )}
                          {c.removedAt && (
                            <span className="text-xs text-secondary">
                              Since <DateTime iso={c.removedAt} dateOnly />
                              {c.hidden ? " · also hidden" : ""}
                            </span>
                          )}
                          {c.featured && (
                            <Chip tone="hashtag" className="px-2! py-0.5! text-xs!">Featured</Chip>
                          )}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            aria-pressed={c.featured}
                            onClick={() => toggleFeatured(c)}
                            className={actionButton()}
                          >
                            <span className="sr-only">{c.title}: </span>
                            {c.featured ? "Unfeature" : "Feature"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-pressed={c.hidden}
                            onClick={() => toggleHidden(c)}
                            className={actionButton(c.hidden ? undefined : "text-error!")}
                          >
                            <span className="sr-only">{c.title}: </span>
                            {c.hidden ? "Unhide" : "Hide"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmHide && (
        <ReasonDialog
          title="Hide this course from members?"
          description={
            <>
              <p dir="auto" className="mb-1 line-clamp-2 font-medium text-ink">
                {confirmHide.title}
              </p>
              <p>
                It leaves the Learning page, search and learning paths. It stays synced from Charter Center and you can unhide it at any
                time.
              </p>
            </>
          }
          confirmLabel="Hide course"
          tone="danger"
          reasonField="none"
          onConfirm={() => {
            const course = confirmHide;
            setConfirmHide(null);
            void curate(course, { hidden: true }, t("“{title}” hidden from members.", { title: course.title }));
          }}
          onClose={() => setConfirmHide(null)}
        />
      )}
    </>
  );
}

export function CoursesWorkspaceSkeleton() {
  return (
    <>
      <SkeletonBar className="h-[92px] w-full rounded-card" />
      <SkeletonCard lines={4} />
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonBar key={i} className="h-8 w-36 rounded-lg" />
        ))}
      </div>
      <SkeletonTable label="Loading courses" rows={8} />
    </>
  );
}
