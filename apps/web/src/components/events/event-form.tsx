"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CreateEventInput,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_FORMAT_LABELS,
  EVENT_MAX_AGENDA_ITEMS,
  EVENT_MAX_CAPACITY,
  EVENT_MAX_SPEAKERS,
  EVENT_SUMMARY_MAX_CHARS,
  EVENT_TITLE_MAX_CHARS,
  EventFormat,
  SubmitForReviewInput,
  type DirectoryMember,
  type EventCategory,
  type EventDetail,
  type EventFields,
  type EventHostOptions,
  type MemberRef,
  type Page,
} from "@chartermission/contracts";
import { Avatar, Button, Icon, Panel, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { CountrySelect } from "@/components/account/country-select";
import { inputClasses } from "@/components/auth/fields";
import { Switch } from "@/components/settings/controls";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { errorMessage } from "@/components/social/errors";
import { Markdown } from "@/components/social/post-types/markdown";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { uploadFile } from "@/lib/upload";
import { dayKey, formatClock, formatDay, fromZonedInput, sameWallClock, timeZoneOptions, zoneAbbreviation, zoneCity } from "./time";
import { useViewerZone } from "./use-viewer-zone";

/* ---------------- Form state ---------------- */

type SpeakerDraft = { key: string; name: string; title: string; organisation: string; member: MemberRef | null };
type AgendaDraft = { key: string; date: string; start: string; end: string; title: string; description: string; speakers: string };
type Cover = { fileId: string | null; url: string | null; status: "none" | "uploading" | "ready" | "error"; progress: number; error: string | null };

type FormState = {
  title: string;
  summary: string;
  description: string;
  categoryId: string;
  /** "member" or a chapter id. */
  host: string;
  timezone: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  format: EventFormat;
  onlinePlatform: string;
  onlineUrl: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  venueCountry: string;
  venueMapUrl: string;
  registrationMode: "internal" | "external";
  unlimited: boolean;
  capacity: string;
  waitlistEnabled: boolean;
  hasDeadline: boolean;
  deadlineDate: string;
  deadlineTime: string;
  externalUrl: string;
  speakers: SpeakerDraft[];
  agenda: AgendaDraft[];
};

let keyCounter = 0;
const nextKey = () => `k${++keyCounter}`;

function splitZoned(iso: string, timeZone: string) {
  return { date: dayKey(iso, timeZone), time: formatClock(iso, timeZone) };
}

function emptyState(timezone: string): FormState {
  return {
    title: "",
    summary: "",
    description: "",
    categoryId: "",
    host: "member",
    timezone,
    startDate: "",
    startTime: "18:00",
    endDate: "",
    endTime: "20:00",
    format: "online",
    onlinePlatform: "",
    onlineUrl: "",
    venueName: "",
    venueAddress: "",
    venueCity: "",
    venueCountry: "",
    venueMapUrl: "",
    registrationMode: "internal",
    unlimited: false,
    capacity: "100",
    waitlistEnabled: true,
    hasDeadline: false,
    deadlineDate: "",
    deadlineTime: "",
    externalUrl: "",
    speakers: [],
    agenda: [],
  };
}

function stateFromEvent(event: EventDetail): FormState {
  const tz = event.timezone;
  const start = splitZoned(event.startsAt, tz);
  const end = splitZoned(event.endsAt, tz);
  const deadline = event.deadline ? splitZoned(event.deadline, tz) : null;
  return {
    title: event.title,
    summary: event.summary,
    description: event.description,
    categoryId: event.category?.id ?? "",
    host: event.host.type === "chapter" ? event.host.chapter.id : "member",
    timezone: tz,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    format: event.format,
    onlinePlatform: event.online?.platform ?? "",
    onlineUrl: event.online?.joinUrl ?? "",
    venueName: event.venue?.name ?? "",
    venueAddress: event.venue?.address ?? "",
    venueCity: event.venue?.city ?? "",
    venueCountry: event.venue?.countryCode ?? "",
    venueMapUrl: event.venue?.mapUrl ?? "",
    registrationMode: event.registrationMode,
    unlimited: event.registrationMode === "internal" && event.capacity === null,
    capacity: event.capacity === null ? "100" : String(event.capacity),
    waitlistEnabled: event.waitlistEnabled,
    hasDeadline: Boolean(deadline),
    deadlineDate: deadline?.date ?? "",
    deadlineTime: deadline?.time ?? "",
    externalUrl: event.externalUrl ?? "",
    speakers: event.speakers.map((s) => ({ key: nextKey(), name: s.name, title: s.title ?? "", organisation: s.organisation ?? "", member: s.member })),
    agenda: event.agenda.map((a) => {
      const s = splitZoned(a.startsAt, tz);
      return { key: nextKey(), date: s.date, start: s.time, end: a.endsAt ? formatClock(a.endsAt, tz) : "", title: a.title, description: a.description ?? "", speakers: a.speakerNames.join(", ") };
    }),
  };
}

const at = (date: string, time: string, tz: string) => (date && /^\d{2}:\d{2}$/.test(time) ? fromZonedInput(`${date}T${time}`, tz) : null);
const opt = (value: string) => (value.trim() ? value.trim() : undefined);

/** Form state → the contract's EventFields input (before zod defaults). */
function toPayload(s: FormState, coverFileId: string | null) {
  const startsAt = at(s.startDate, s.startTime, s.timezone);
  const endsAt = at(s.endDate || s.startDate, s.endTime, s.timezone);
  const capacity = s.registrationMode === "external" || s.unlimited ? null : s.capacity.trim() === "" ? Number.NaN : Number(s.capacity);
  return {
    title: s.title,
    summary: s.summary,
    description: s.description,
    categoryId: s.categoryId || null,
    format: s.format,
    host: s.host === "member" ? ({ type: "member" } as const) : ({ type: "chapter", chapterId: s.host } as const),
    startsAt: startsAt ?? "",
    endsAt: endsAt ?? "",
    timezone: s.timezone,
    venue:
      s.format === "online"
        ? null
        : { name: s.venueName, address: opt(s.venueAddress), city: s.venueCity, countryCode: s.venueCountry, mapUrl: opt(s.venueMapUrl) },
    online: s.format === "in_person" ? null : { platform: s.onlinePlatform, url: s.onlineUrl },
    registrationMode: s.registrationMode,
    externalUrl: s.registrationMode === "external" ? s.externalUrl : null,
    capacity,
    waitlistEnabled: s.registrationMode === "internal" && !s.unlimited ? s.waitlistEnabled : false,
    registrationDeadline: s.hasDeadline ? (at(s.deadlineDate, s.deadlineTime, s.timezone) ?? "") : null,
    coverFileId,
    speakers: s.speakers.map((sp) => ({ name: sp.name, title: opt(sp.title), organisation: opt(sp.organisation), memberId: sp.member?.id })),
    agenda: s.agenda.map((a) => ({
      startsAt: at(a.date || s.startDate, a.start, s.timezone) ?? "",
      endsAt: a.end ? (at(a.date || s.startDate, a.end, s.timezone) ?? "") : undefined,
      title: a.title,
      description: opt(a.description),
      speakerNames: a.speakers
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    })),
  };
}

type Errors = Record<string, string>;

/** Friendlier wording for the generic zod messages (datetime/number parsing). */
function humanise(path: string, message: string): string {
  if (/Invalid (ISO )?datetime|Invalid input/i.test(message)) {
    if (path === "startsAt") return "Pick the start date and time";
    if (path === "endsAt") return "Pick the end date and time";
    if (path === "registrationDeadline") return "Pick when registration closes";
    if (path.startsWith("agenda.")) return "Pick a time within the event";
  }
  if (message === "Add a link") {
    if (path === "online.url") return "Add the online join link";
    if (path === "externalUrl") return "Add the registration link";
  }
  if (/expected number, received nan/i.test(message)) return "Enter a capacity, or choose unlimited";
  if (path === "venue.countryCode") return "Choose the country";
  return message;
}

function validate(s: FormState, coverFileId: string | null): { data: EventFields | null; errors: Errors } {
  const result = CreateEventInput.safeParse(toPayload(s, coverFileId));
  if (result.success) return { data: result.data, errors: {} };
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_";
    errors[path] ??= humanise(path, issue.message);
  }
  return { data: null, errors };
}

/** Where each error path is shown and focused. */
function fieldFor(path: string): string {
  if (path === "startsAt") return "startDate";
  if (path === "endsAt") return "endDate";
  if (path === "registrationDeadline") return "deadlineDate";
  if (path === "venue" || path === "venue.name") return "venueName";
  if (path === "venue.city") return "venueCity";
  if (path === "venue.countryCode") return "venueCountry";
  if (path === "venue.mapUrl") return "venueMapUrl";
  if (path === "venue.address") return "venueAddress";
  if (path === "online" || path === "online.url") return "onlineUrl";
  if (path === "online.platform") return "onlinePlatform";
  if (path === "host" || path.startsWith("host.")) return "host";
  const speaker = /^speakers\.(\d+)\.(\w+)/.exec(path);
  if (speaker) return `speaker-${speaker[1]}-${speaker[2]}`;
  const agenda = /^agenda\.(\d+)\.(\w+)/.exec(path);
  if (agenda) return `agenda-${agenda[1]}-${agenda[2] === "endsAt" ? "end" : agenda[2] === "title" ? "title" : "start"}`;
  return path;
}

const sectionOf = (field: string) =>
  /^(title|summary|categoryId|cover)/.test(field)
    ? "basics"
    : field === "host"
      ? "host"
      : /^(start|end|timezone)/.test(field)
        ? "when"
        : /^(venue|online|format)/.test(field)
          ? "where"
          : /^(capacity|deadline|externalUrl|registration)/.test(field)
            ? "registration"
            : field.startsWith("speaker")
              ? "speakers"
              : field.startsWith("agenda")
                ? "agenda"
                : field === "description"
                  ? "description"
                  : "basics";

/* ---------------- Small controls ---------------- */

function FieldShell({ id, label, hint, error, optional, children, className }: { id: string; label: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="font-normal text-secondary"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs text-error">
          <Icon name="alert" size={14} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describe = (id: string, error?: string, hint?: unknown) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

function TextInput({
  id,
  value,
  onChange,
  error,
  hint,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & { id: string; value: string; onChange: (value: string) => void; error?: string; hint?: unknown }) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={Boolean(error) || undefined}
      aria-describedby={describe(id, error, hint)}
      className={inputClasses(Boolean(error), className)}
      {...rest}
    />
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const left = max - value.length;
  return <span className={cn("text-xs", left < 0 ? "text-error" : left < 20 ? "text-warning" : "text-disabled")}>{value.length}/{max}</span>;
}

function Section({ id, title, description, icon, children, aside }: { id: string; title: string; description?: string; icon: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <Panel id={`section-${id}`} aria-labelledby={`section-${id}-heading`} className="flex scroll-mt-24 flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4 max-sm:px-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint-2 text-primary">
            <Icon name={icon} size={18} />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 id={`section-${id}-heading`} className="text-h3 text-ink">
              {title}
            </h2>
            {description && <p className="text-sm text-secondary">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="flex flex-col gap-5 px-6 py-5 max-sm:px-4">{children}</div>
    </Panel>
  );
}

function ChoiceCard({ name, value, checked, onChange, title, description, icon, id }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; description?: string; icon?: IconName; id?: string }) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-start gap-3 rounded-card border p-3.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-primary-light/30",
        checked ? "border-primary bg-primary-tint-2" : "border-line bg-card hover:border-line-strong",
      )}
    >
      <input id={id} type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {icon && (
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", checked ? "bg-primary text-inverse" : "bg-muted text-secondary")}>
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{title}</span>
        {description && <span className="text-xs text-secondary">{description}</span>}
      </span>
      <span aria-hidden="true" className={cn("ml-auto mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-primary bg-primary" : "border-line-strong bg-card")}>
        {checked && <span className="size-1.5 rounded-full bg-card" />}
      </span>
    </label>
  );
}

function IconButton({ label, icon, onClick, disabled, danger, flip }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean; danger?: boolean; flip?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("rounded-md p-1.5 text-secondary hover:bg-muted disabled:pointer-events-none disabled:opacity-40", danger ? "hover:text-error" : "hover:text-ink")}
    >
      <Icon name={icon} size={16} className={flip ? "rotate-180" : undefined} />
    </button>
  );
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Up / down / remove for speaker and agenda rows. */
function RowControls({ index, count, noun, onMove, onRemove }: { index: number; count: number; noun: string; onMove: (delta: number) => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton label={`Move ${noun} up`} icon="chevron-down" flip onClick={() => onMove(-1)} disabled={index === 0} />
      <IconButton label={`Move ${noun} down`} icon="chevron-down" onClick={() => onMove(1)} disabled={index === count - 1} />
      <IconButton label={`Remove ${noun}`} icon="x" onClick={onRemove} danger />
    </div>
  );
}

/* ---------------- Member link for speakers ---------------- */

function MemberPicker({ id, onPick }: { id: string; onPick: (member: MemberRef) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryMember[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<Page<DirectoryMember>>("/members", { query: { q: term, limit: 5 }, signal: controller.signal })
        .then((page) => setResults(page.items))
        .catch(() => {});
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const shown = q.trim().length >= 2 ? results : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        Search members to link
      </label>
      <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members by name" className={inputClasses(false, "h-9")} autoFocus />
      <ul aria-live="polite" className="flex flex-col">
        {shown?.map((member) => (
          <li key={member.id}>
            <button type="button" onClick={() => onPick(member)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted">
              <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{member.name}</span>
              {member.headline && <span className="max-w-[50%] truncate text-xs text-secondary">{member.headline}</span>}
            </button>
          </li>
        ))}
        {shown && !shown.length && <li className="px-2 py-1.5 text-sm text-secondary">No members found</li>}
      </ul>
    </div>
  );
}

/* ---------------- The form ---------------- */

export type EventFormProps = {
  mode: "create" | "edit";
  event?: EventDetail;
  viewer: { name: string; avatarUrl: string | null; tone: MemberRef["tone"] };
  hostOptions: EventHostOptions;
  categories: EventCategory[];
  countryGroups: CountryGroup[];
};

const SUBMITTABLE = new Set(["draft", "changes_requested", "rejected", "unpublished"]);

/**
 * Create / edit an event (CM-EVT-01/02/05): sections for basics, host, time (with a live
 * preview in the host's own zone), format and place, registration, speakers, agenda and
 * description. Validates with the contract's CreateEventInput before calling the API.
 */
export function EventForm({ mode, event, viewer, hostOptions, categories, countryGroups }: EventFormProps) {
  const router = useRouter();
  const uid = useId();
  const browserZone = useViewerZone();
  const [state, setState] = useState<FormState>(() => (event ? stateFromEvent(event) : emptyState("Africa/Lagos")));
  const [baseline, setBaseline] = useState(() => JSON.stringify(state));
  const [zoneTouched, setZoneTouched] = useState(Boolean(event));
  const [cover, setCover] = useState<Cover>(() => ({ fileId: null, url: event?.coverUrl ?? null, status: event?.coverUrl ? "ready" : "none", progress: 1, error: null }));
  const [coverChanged, setCoverChanged] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "submit">(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [previewDescription, setPreviewDescription] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const zones = useMemo(() => timeZoneOptions(), []);

  // New events default to the host's own zone once the browser's is known.
  const effectiveState = !zoneTouched && browserZone && mode === "create" ? { ...state, timezone: browserZone } : state;
  const s = effectiveState;
  const dirty = JSON.stringify({ ...s, timezone: zoneTouched ? s.timezone : state.timezone }) !== baseline || coverChanged;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((current) => {
      const base = !zoneTouched && browserZone && mode === "create" ? { ...current, timezone: browserZone } : current;
      return { ...base, [key]: value };
    });
    if (Object.keys(errors).length) setErrors({});
    if (!zoneTouched && browserZone && mode === "create") setZoneTouched(true);
  };

  const coverFileId = coverChanged ? cover.fileId : null;
  const live = useMemo(() => validate(s, coverFileId), [s, coverFileId]);
  const shownErrors = showErrors ? { ...live.errors, ...errors } : errors;
  const errorFor = (field: string) => Object.entries(shownErrors).find(([path]) => fieldFor(path) === field)?.[1];

  // Leave guard: the browser's own prompt for reloads/closing, a confirm for in-app links.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (done.current) return;
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (done.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("Leave without saving? Your changes to this event will be lost.")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  async function pickCover(file: File) {
    setCover({ fileId: null, url: URL.createObjectURL(file), status: "uploading", progress: 0, error: null });
    setCoverChanged(true);
    try {
      const view = await uploadFile(file, "event_cover", (progress) => setCover((c) => ({ ...c, progress })));
      setCover((c) => ({ ...c, fileId: view.id, url: view.url ?? c.url, status: "ready", progress: 1 }));
    } catch (e) {
      setCover((c) => ({ ...c, status: "error", error: errorMessage(e), fileId: null }));
    }
  }

  function removeCover() {
    setCover({ fileId: null, url: null, status: "none", progress: 1, error: null });
    setCoverChanged(Boolean(event?.coverUrl) || cover.status !== "none");
  }

  function showErrorSummary() {
    setShowErrors(true);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  /** PATCH body: everything editable; host and cover only when changed (host is fixed after first publish). */
  function patchBody(data: EventFields) {
    const body: Record<string, unknown> = { ...data };
    delete body.coverFileId;
    if (coverChanged) body.coverFileId = cover.fileId;
    const original = event ? stateFromEvent(event).host : null;
    if (original === s.host) delete body.host;
    return body;
  }

  async function save(action: "save" | "submit") {
    setFormError(null);
    if (cover.status === "uploading") {
      setFormError("Wait for the cover image to finish uploading.");
      return;
    }
    const result = validate(s, coverFileId);
    if (!result.data) {
      setErrors({});
      showErrorSummary();
      return;
    }
    const submitNote = SubmitForReviewInput.safeParse({ note: note.trim() || undefined });
    setBusy(action);
    try {
      let saved: EventDetail;
      if (mode === "create" || !event) {
        saved = await api<EventDetail>("/events", { method: "POST", body: { ...result.data, coverFileId: cover.fileId } });
      } else {
        saved = await api<EventDetail>(`/events/${event.id}`, { method: "PATCH", body: patchBody(result.data) });
      }
      if (action === "submit") {
        try {
          saved = await api<EventDetail>(`/events/${saved.id}/submit`, { method: "POST", body: submitNote.success ? submitNote.data : {} });
        } catch (e) {
          done.current = true;
          toast.error(e);
          router.replace(`/events/${saved.slug}/edit`);
          return;
        }
      }
      done.current = true;
      setBaseline(JSON.stringify(s));
      setCoverChanged(false);
      toast.success(
        action === "submit"
          ? saved.status === "published"
            ? "Published — your event is live"
            : "Submitted for review. We’ll notify you when it’s checked."
          : mode === "create"
            ? "Draft saved"
            : saved.status === "published"
              ? "Changes are live"
              : "Changes saved",
      );
      router.push(`/events/${saved.slug}`);
      router.refresh();
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) {
        setErrors(e.fields);
        showErrorSummary();
      } else {
        setFormError(errorMessage(e));
      }
      setBusy(null);
    }
  }

  function cancel() {
    if (dirty) setLeaving(true);
    else router.push(event ? `/events/${event.slug}` : "/events");
  }

  /* ----- derived ----- */
  const startsAt = at(s.startDate, s.startTime, s.timezone);
  const endsAt = at(s.endDate || s.startDate, s.endTime, s.timezone);
  const multiDay = Boolean(s.endDate && s.startDate && s.endDate !== s.startDate);
  const eventDays = useMemo(() => {
    if (!s.startDate) return [];
    const out: string[] = [];
    const d = new Date(`${s.startDate}T00:00:00Z`);
    const last = s.endDate && s.endDate > s.startDate ? s.endDate : s.startDate;
    while (out.length < 15) {
      const iso = d.toISOString().slice(0, 10);
      out.push(iso);
      if (iso >= last) break;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [s.startDate, s.endDate]);
  const status = event?.status;
  const published = status === "published";
  const canSubmit = mode === "create" || (status ? SUBMITTABLE.has(status) : false);
  const submitLabel = hostOptions.canPublishDirectly ? (mode === "create" ? "Publish event" : "Save and publish") : mode === "create" ? "Submit for review" : "Save and submit";
  const hostLocked = Boolean(event?.review?.publishedAt);
  const errorList = Object.entries(showErrors ? shownErrors : {});

  const hostChoices = [
    ...(hostOptions.canHostAsMember ? [{ value: "member", title: `You (${viewer.name})`, description: "Hosted by you as a member", icon: "user" as const }] : []),
    ...hostOptions.chapters.map((c) => ({ value: c.id, title: c.name, description: "A chapter you lead", icon: "building" as const })),
  ];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(canSubmit ? "submit" : "save");
      }}
      className="flex flex-col gap-5"
      aria-label={mode === "create" ? "New event" : "Edit event"}
    >
      {errorList.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="flex flex-col gap-2 rounded-card border border-error/30 bg-error-light px-5 py-4 focus-visible:outline-2 focus-visible:outline-error">
          <p className="flex items-center gap-2 text-md font-semibold text-ink">
            <Icon name="alert" size={18} className="text-error" />
            {errorList.length === 1 ? "One thing to fix" : `${errorList.length} things to fix`}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-9 text-sm text-body">
            {errorList.map(([path, message]) => (
              <li key={path}>
                <a
                  href={`#${fieldFor(path)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const target = document.getElementById(fieldFor(path)) ?? document.getElementById(`section-${sectionOf(fieldFor(path))}`);
                    target?.scrollIntoView({ block: "center", behavior: "smooth" });
                    target?.focus({ preventScroll: true });
                  }}
                  className="text-error hover:underline"
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {published && (
        <p className="flex items-start gap-2 rounded-card border border-info/30 bg-info-light px-5 py-3 text-sm text-body">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-info" />
          This event is live. Changes appear straight away, and registrants are notified if you change the time, venue or online link.
        </p>
      )}

      {/* Basics */}
      <Section id="basics" title="Basics" description="What members see first on cards and the event page." icon="lightbulb">
        <FieldShell id="title" label="Title" error={errorFor("title")}>
          <div className="relative">
            <TextInput id="title" value={s.title} onChange={(v) => set("title", v)} maxLength={EVENT_TITLE_MAX_CHARS + 20} error={errorFor("title")} placeholder="e.g. AfCFTA Rules of Origin Explained" className="pr-16" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <Counter value={s.title} max={EVENT_TITLE_MAX_CHARS} />
            </span>
          </div>
        </FieldShell>
        <FieldShell id="summary" label="Summary" hint="One or two sentences for cards and previews." error={errorFor("summary")}>
          <textarea
            id="summary"
            value={s.summary}
            onChange={(e) => set("summary", e.target.value)}
            rows={2}
            aria-invalid={Boolean(errorFor("summary")) || undefined}
            aria-describedby={describe("summary", errorFor("summary"), true)}
            className={inputClasses(Boolean(errorFor("summary")), "h-auto resize-y py-2.5")}
          />
          <span className="-mt-1 self-end">
            <Counter value={s.summary} max={EVENT_SUMMARY_MAX_CHARS} />
          </span>
        </FieldShell>
        <FieldShell id="categoryId" label="Category" optional error={errorFor("categoryId")}>
          <select id="categoryId" value={s.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={inputClasses(false, "cursor-pointer")}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">
            Cover image <span className="font-normal text-secondary">(optional)</span>
          </span>
          <div className="flex items-start gap-4 max-sm:flex-col">
            <div className="relative flex aspect-[40/21] w-56 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-muted max-sm:w-full">
              {cover.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover.url} alt="Cover preview" className="size-full object-cover" />
              ) : (
                <Icon name="image" size={28} className="text-disabled" />
              )}
              {cover.status === "uploading" && (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-primary-tint">
                  <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(cover.progress * 100)}%` }} />
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <label className={cn(buttonClasses({ variant: "secondary", size: "small" }), "cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-primary-light/40")}>
                  <Icon name="image" size={16} />
                  {cover.url ? "Replace image" : "Upload image"}
                  <input
                    id="cover"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void pickCover(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {cover.url && (
                  <button type="button" onClick={removeCover} className={buttonClasses({ variant: "ghost", size: "small" })}>
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs text-secondary" aria-live="polite">
                {cover.status === "uploading"
                  ? `Uploading… ${Math.round(cover.progress * 100)}%`
                  : cover.status === "error"
                    ? <span className="text-error">{cover.error}</span>
                    : "JPEG, PNG or WebP, up to 5 MB. 1200 × 630 works best. Without one, the event gets the Charter Mission pattern."}
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Host */}
      <Section id="host" title="Host" description="Who the event is listed under." icon="users">
        {hostLocked ? (
          <p className="text-sm text-body">
            The host can’t change after the event was first published. It’s hosted by{" "}
            <strong className="font-medium text-ink">{hostChoices.find((h) => h.value === s.host)?.title ?? (event?.host.type === "chapter" ? event.host.chapter.name : viewer.name)}</strong>.
          </p>
        ) : (
          <fieldset id="host" tabIndex={-1} className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <legend className="sr-only">Host</legend>
            {hostChoices.map((choice) => (
              <ChoiceCard key={choice.value} name="host" value={choice.value} checked={s.host === choice.value} onChange={() => set("host", choice.value)} title={choice.title} description={choice.description} icon={choice.icon} />
            ))}
          </fieldset>
        )}
        {errorFor("host") && <p className="text-xs text-error">{errorFor("host")}</p>}
      </Section>

      {/* When */}
      <Section id="when" title="Date and time" description="Members see the time in your event’s zone and in their own." icon="clock">
        <div className="grid grid-cols-[1fr_140px] gap-3 max-sm:grid-cols-[1fr_110px]">
          <FieldShell id="startDate" label="Starts" error={errorFor("startDate")}>
            <TextInput id="startDate" type="date" value={s.startDate} onChange={(v) => set("startDate", v)} error={errorFor("startDate")} />
          </FieldShell>
          <FieldShell id="startTime" label="Time">
            <TextInput id="startTime" type="time" value={s.startTime} onChange={(v) => set("startTime", v)} />
          </FieldShell>
          <FieldShell id="endDate" label="Ends" error={errorFor("endDate")} hint="Leave the date as is for a same-day event.">
            <TextInput id="endDate" type="date" value={s.endDate || s.startDate} min={s.startDate || undefined} onChange={(v) => set("endDate", v)} error={errorFor("endDate")} hint />
          </FieldShell>
          <FieldShell id="endTime" label="Time">
            <TextInput id="endTime" type="time" value={s.endTime} onChange={(v) => set("endTime", v)} />
          </FieldShell>
        </div>
        <FieldShell id="timezone" label="Time zone" error={errorFor("timezone")}>
          <div className="flex gap-2 max-sm:flex-col">
            <select
              id="timezone"
              value={s.timezone}
              onChange={(e) => {
                setZoneTouched(true);
                setState((c) => ({ ...c, timezone: e.target.value }));
              }}
              className={inputClasses(false, "cursor-pointer")}
            >
              {zones.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.zones.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {browserZone && browserZone !== s.timezone && (
              <button
                type="button"
                onClick={() => {
                  setZoneTouched(true);
                  setState((c) => ({ ...c, timezone: browserZone }));
                }}
                className={cn(buttonClasses({ variant: "secondary", size: "small" }), "shrink-0")}
              >
                Use my zone ({zoneCity(browserZone)})
              </button>
            )}
          </div>
        </FieldShell>
        <TimePreview startsAt={startsAt} endsAt={endsAt} timezone={s.timezone} viewer={browserZone} />
      </Section>

      {/* Where */}
      <Section id="where" title="Format and place" icon="map-pin">
        <fieldset className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <legend className="sr-only">Format</legend>
          {EventFormat.options.map((format) => (
            <ChoiceCard
              key={format}
              name="format"
              value={format}
              checked={s.format === format}
              onChange={() => set("format", format)}
              title={EVENT_FORMAT_LABELS[format]}
              icon={format === "online" ? "video" : format === "hybrid" ? "globe" : "map-pin"}
              description={format === "online" ? "A video call or stream" : format === "hybrid" ? "A venue and a stream" : "At a venue"}
            />
          ))}
        </fieldset>
        {s.format !== "in_person" && (
          <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="video" size={16} className="text-info" />
              Online access
            </p>
            <div className="grid grid-cols-[200px_1fr] gap-3 max-sm:grid-cols-1">
              <FieldShell id="onlinePlatform" label="Platform" error={errorFor("onlinePlatform")}>
                <TextInput id="onlinePlatform" value={s.onlinePlatform} onChange={(v) => set("onlinePlatform", v)} placeholder="Zoom, Google Meet…" list={`${uid}-platforms`} error={errorFor("onlinePlatform")} />
                <datalist id={`${uid}-platforms`}>
                  {["Zoom", "Google Meet", "Microsoft Teams", "YouTube Live", "LinkedIn Live", "Webex"].map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </FieldShell>
              <FieldShell id="onlineUrl" label="Join link" error={errorFor("onlineUrl")} hint="Kept encrypted. Only registered members see it, from 24 hours before the start.">
                <TextInput id="onlineUrl" type="url" inputMode="url" value={s.onlineUrl} onChange={(v) => set("onlineUrl", v)} placeholder="https://" error={errorFor("onlineUrl")} hint />
              </FieldShell>
            </div>
          </div>
        )}
        {s.format !== "online" && (
          <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="map-pin" size={16} className="text-success" />
              Venue
            </p>
            <FieldShell id="venueName" label="Venue name" error={errorFor("venueName")}>
              <TextInput id="venueName" value={s.venueName} onChange={(v) => set("venueName", v)} placeholder="e.g. Kempinski Hotel Gold Coast City" error={errorFor("venueName")} />
            </FieldShell>
            <FieldShell id="venueAddress" label="Address" optional error={errorFor("venueAddress")}>
              <TextInput id="venueAddress" value={s.venueAddress} onChange={(v) => set("venueAddress", v)} error={errorFor("venueAddress")} />
            </FieldShell>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <FieldShell id="venueCity" label="City" error={errorFor("venueCity")}>
                <TextInput id="venueCity" value={s.venueCity} onChange={(v) => set("venueCity", v)} error={errorFor("venueCity")} />
              </FieldShell>
              <FieldShell id="venueCountry" label="Country" error={errorFor("venueCountry")}>
                <CountrySelect id="venueCountry" groups={countryGroups} value={s.venueCountry} onChange={(e) => set("venueCountry", e.target.value)} invalid={Boolean(errorFor("venueCountry"))} aria-describedby={describe("venueCountry", errorFor("venueCountry"))} />
              </FieldShell>
            </div>
            <FieldShell id="venueMapUrl" label="Map link" optional error={errorFor("venueMapUrl")} hint="A Google Maps or OpenStreetMap link for “Open in maps”.">
              <TextInput id="venueMapUrl" type="url" inputMode="url" value={s.venueMapUrl} onChange={(v) => set("venueMapUrl", v)} placeholder="https://" error={errorFor("venueMapUrl")} hint />
            </FieldShell>
          </div>
        )}
      </Section>

      {/* Registration */}
      <Section id="registration" title="Registration" icon="check">
        <fieldset className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <legend className="sr-only">Registration mode</legend>
          <ChoiceCard name="mode" value="internal" checked={s.registrationMode === "internal"} onChange={() => set("registrationMode", "internal")} title="On Charter Mission" description="Members register here; you see the list, reminders go out" icon="users" />
          <ChoiceCard name="mode" value="external" checked={s.registrationMode === "external"} onChange={() => set("registrationMode", "external")} title="On another site" description="Link to your own registration page" icon="external" />
        </fieldset>
        {s.registrationMode === "internal" ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <FieldShell id="capacity" label="Capacity" error={errorFor("capacity")} className="w-40">
                <TextInput id="capacity" type="number" min={1} max={EVENT_MAX_CAPACITY} inputMode="numeric" value={s.unlimited ? "" : s.capacity} disabled={s.unlimited} onChange={(v) => set("capacity", v)} error={errorFor("capacity")} placeholder={s.unlimited ? "Unlimited" : undefined} className="disabled:bg-muted" />
              </FieldShell>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-body">
                <input type="checkbox" checked={s.unlimited} onChange={(e) => set("unlimited", e.target.checked)} className="size-4 accent-primary" />
                No seat limit
              </label>
            </div>
            <div className={cn("flex items-start justify-between gap-4 rounded-card border border-line p-4", s.unlimited && "opacity-60")}>
              <div className="flex flex-col gap-0.5">
                <span id={`${uid}-waitlist`} className="text-sm font-medium text-ink">
                  Waitlist when full
                </span>
                <span id={`${uid}-waitlist-hint`} className="text-xs text-secondary">
                  {s.unlimited ? "Only applies with a seat limit." : "When someone cancels, the first person waiting gets their seat automatically and is emailed."}
                </span>
              </div>
              <Switch checked={s.waitlistEnabled && !s.unlimited} disabled={s.unlimited} onChange={(v) => set("waitlistEnabled", v)} label="Waitlist when full" describedBy={`${uid}-waitlist-hint`} />
            </div>
          </>
        ) : (
          <FieldShell id="externalUrl" label="Registration link" error={errorFor("externalUrl")} hint="https only. Members leave Charter Mission to register; capacity is managed there.">
            <TextInput id="externalUrl" type="url" inputMode="url" value={s.externalUrl} onChange={(v) => set("externalUrl", v)} placeholder="https://" error={errorFor("externalUrl")} hint />
          </FieldShell>
        )}
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-body">
            <input
              type="checkbox"
              checked={s.hasDeadline}
              onChange={(e) => {
                const on = e.target.checked;
                setState((c) => ({ ...c, hasDeadline: on, deadlineDate: c.deadlineDate || c.startDate, deadlineTime: c.deadlineTime || "12:00" }));
              }}
              className="size-4 accent-primary"
            />
            Close registration before the event starts
          </label>
          {s.hasDeadline && (
            <div className="grid grid-cols-[1fr_140px] gap-3 max-sm:grid-cols-[1fr_110px]">
              <FieldShell id="deadlineDate" label="Registration closes" error={errorFor("deadlineDate")} hint={`In the event’s time zone (${zoneAbbreviation(s.timezone)}).`}>
                <TextInput id="deadlineDate" type="date" value={s.deadlineDate} max={s.startDate || undefined} onChange={(v) => set("deadlineDate", v)} error={errorFor("deadlineDate")} hint />
              </FieldShell>
              <FieldShell id="deadlineTime" label="Time">
                <TextInput id="deadlineTime" type="time" value={s.deadlineTime} onChange={(v) => set("deadlineTime", v)} />
              </FieldShell>
            </div>
          )}
        </div>
      </Section>

      {/* Speakers */}
      <Section id="speakers" title="Speakers" description="Optional. Link members so their profile photo and name are used." icon="user" aside={<span className="text-xs text-secondary">{s.speakers.length}/{EVENT_MAX_SPEAKERS}</span>}>
        {s.speakers.length > 0 && (
          <ol className="flex flex-col gap-3">
            {s.speakers.map((speaker, index) => (
              <li key={speaker.key} className="flex flex-col gap-3 rounded-card border border-line p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                    {speaker.member ? <Avatar name={speaker.member.name} src={speaker.member.avatarUrl ?? undefined} tone={speaker.member.tone} size={24} /> : <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs text-secondary">{index + 1}</span>}
                    <span className="truncate">{speaker.name || `Speaker ${index + 1}`}</span>
                  </span>
                  <RowControls
                    index={index}
                    count={s.speakers.length}
                    noun={`speaker ${speaker.name || index + 1}`}
                    onMove={(d) => set("speakers", move(s.speakers, index, d))}
                    onRemove={() => set("speakers", s.speakers.filter((x) => x.key !== speaker.key))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                  <FieldShell id={`speaker-${index}-name`} label="Name" error={errorFor(`speaker-${index}-name`)}>
                    <TextInput id={`speaker-${index}-name`} value={speaker.name} onChange={(v) => set("speakers", s.speakers.map((x) => (x.key === speaker.key ? { ...x, name: v } : x)))} error={errorFor(`speaker-${index}-name`)} />
                  </FieldShell>
                  <FieldShell id={`speaker-${index}-title`} label="Role" optional error={errorFor(`speaker-${index}-title`)}>
                    <TextInput id={`speaker-${index}-title`} value={speaker.title} onChange={(v) => set("speakers", s.speakers.map((x) => (x.key === speaker.key ? { ...x, title: v } : x)))} placeholder="Head of Trade Policy" />
                  </FieldShell>
                  <FieldShell id={`speaker-${index}-organisation`} label="Organisation" optional error={errorFor(`speaker-${index}-organisation`)}>
                    <TextInput id={`speaker-${index}-organisation`} value={speaker.organisation} onChange={(v) => set("speakers", s.speakers.map((x) => (x.key === speaker.key ? { ...x, organisation: v } : x)))} />
                  </FieldShell>
                </div>
                {speaker.member ? (
                  <p className="flex items-center gap-2 text-xs text-secondary">
                    <Icon name="link" size={14} />
                    Linked to {speaker.member.name}’s profile
                    <button type="button" onClick={() => set("speakers", s.speakers.map((x) => (x.key === speaker.key ? { ...x, member: null } : x)))} className="font-medium text-primary-light hover:underline">
                      Unlink
                    </button>
                  </p>
                ) : linking === speaker.key ? (
                  <MemberPicker
                    id={`speaker-${index}-member`}
                    onPick={(member) => {
                      set("speakers", s.speakers.map((x) => (x.key === speaker.key ? { ...x, member, name: x.name || member.name, title: x.title || (member.headline ?? "") } : x)));
                      setLinking(null);
                    }}
                  />
                ) : (
                  <button type="button" onClick={() => setLinking(speaker.key)} className="flex w-fit items-center gap-1 text-xs font-medium text-primary-light hover:underline">
                    <Icon name="link" size={14} />
                    Link a member profile
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          disabled={s.speakers.length >= EVENT_MAX_SPEAKERS}
          onClick={() => set("speakers", [...s.speakers, { key: nextKey(), name: "", title: "", organisation: "", member: null }])}
          className={cn(buttonClasses({ variant: "secondary", size: "small" }), "self-start")}
        >
          <Icon name="plus" size={16} />
          Add speaker
        </button>
      </Section>

      {/* Agenda */}
      <Section id="agenda" title="Agenda" description={`Optional. Times are in ${zoneCity(s.timezone)} time (${zoneAbbreviation(s.timezone)}).`} icon="menu" aside={<span className="text-xs text-secondary">{s.agenda.length}/{EVENT_MAX_AGENDA_ITEMS}</span>}>
        {s.agenda.length > 0 && (
          <ol className="flex flex-col gap-3">
            {s.agenda.map((item, index) => {
              const update = (patch: Partial<AgendaDraft>) => set("agenda", s.agenda.map((x) => (x.key === item.key ? { ...x, ...patch } : x)));
              return (
                <li key={item.key} className="flex flex-col gap-3 rounded-card border border-line p-4">
                  <div className="flex items-start gap-3 max-sm:flex-col">
                    <div className={cn("grid shrink-0 gap-2", multiDay ? "grid-cols-[150px_100px_100px] max-sm:grid-cols-3" : "grid-cols-[100px_100px]")}>
                      {multiDay && (
                        <FieldShell id={`agenda-${index}-date`} label="Day">
                          <select id={`agenda-${index}-date`} value={item.date || s.startDate} onChange={(e) => update({ date: e.target.value })} className={inputClasses(false, "cursor-pointer px-2")}>
                            {eventDays.map((d) => (
                              <option key={d} value={d}>
                                {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                              </option>
                            ))}
                          </select>
                        </FieldShell>
                      )}
                      <FieldShell id={`agenda-${index}-start`} label="From">
                        <TextInput id={`agenda-${index}-start`} type="time" value={item.start} onChange={(v) => update({ start: v })} error={errorFor(`agenda-${index}-start`)} className="px-2" />
                      </FieldShell>
                      <FieldShell id={`agenda-${index}-end`} label="To" optional>
                        <TextInput id={`agenda-${index}-end`} type="time" value={item.end} onChange={(v) => update({ end: v })} error={errorFor(`agenda-${index}-end`)} className="px-2" />
                      </FieldShell>
                    </div>
                    <FieldShell id={`agenda-${index}-title`} label="Session" error={errorFor(`agenda-${index}-title`)} className="flex-1 max-sm:w-full">
                      <TextInput id={`agenda-${index}-title`} value={item.title} onChange={(v) => update({ title: v })} placeholder="e.g. Opening keynote" error={errorFor(`agenda-${index}-title`)} />
                    </FieldShell>
                    <div className="pt-6 max-sm:self-end max-sm:pt-0">
                      <RowControls index={index} count={s.agenda.length} noun={`agenda item ${item.title || index + 1}`} onMove={(d) => set("agenda", move(s.agenda, index, d))} onRemove={() => set("agenda", s.agenda.filter((x) => x.key !== item.key))} />
                    </div>
                  </div>
                  {(errorFor(`agenda-${index}-start`) || errorFor(`agenda-${index}-end`)) && (
                    <p className="flex items-center gap-1 text-xs text-error">
                      <Icon name="alert" size={14} />
                      {errorFor(`agenda-${index}-start`) ?? errorFor(`agenda-${index}-end`)}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                    <FieldShell id={`agenda-${index}-description`} label="Details" optional>
                      <TextInput id={`agenda-${index}-description`} value={item.description} onChange={(v) => update({ description: v })} />
                    </FieldShell>
                    <FieldShell id={`agenda-${index}-speakers`} label="Speakers" optional hint="Names, separated by commas.">
                      <TextInput id={`agenda-${index}-speakers`} value={item.speakers} onChange={(v) => update({ speakers: v })} list={`${uid}-speaker-names`} hint />
                    </FieldShell>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <datalist id={`${uid}-speaker-names`}>
          {s.speakers.filter((sp) => sp.name.trim()).map((sp) => (
            <option key={sp.key} value={sp.name} />
          ))}
        </datalist>
        <button
          type="button"
          disabled={s.agenda.length >= EVENT_MAX_AGENDA_ITEMS}
          onClick={() => {
            const last = s.agenda[s.agenda.length - 1];
            const start = last?.end || last?.start || s.startTime;
            set("agenda", [...s.agenda, { key: nextKey(), date: last?.date || s.startDate, start, end: "", title: "", description: "", speakers: "" }]);
          }}
          className={cn(buttonClasses({ variant: "secondary", size: "small" }), "self-start")}
        >
          <Icon name="plus" size={16} />
          Add agenda item
        </button>
      </Section>

      {/* Description */}
      <Section
        id="description"
        title="Description"
        description="What it’s about, who should come, what to bring. Kept on the page after the event."
        icon="book"
        aside={
          <div role="group" aria-label="Description view" className="flex gap-0.5 rounded-lg bg-muted p-[3px]">
            {[false, true].map((preview) => (
              <button key={String(preview)} type="button" aria-pressed={previewDescription === preview} onClick={() => setPreviewDescription(preview)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", previewDescription === preview ? "bg-card text-primary" : "text-secondary hover:text-ink")}>
                {preview ? "Preview" : "Write"}
              </button>
            ))}
          </div>
        }
      >
        {previewDescription ? (
          <div className="min-h-[200px] rounded-lg border border-line p-4">{s.description.trim() ? <Markdown text={s.description} headingOffset={1} /> : <p className="text-sm text-secondary">Nothing to preview yet.</p>}</div>
        ) : (
          <FieldShell id="description" label="Description" hint="Blank lines start paragraphs; “## ” starts a heading; “- ” makes a list; **bold**." error={errorFor("description")}>
            <textarea
              id="description"
              value={s.description}
              onChange={(e) => set("description", e.target.value)}
              rows={10}
              aria-invalid={Boolean(errorFor("description")) || undefined}
              aria-describedby={describe("description", errorFor("description"), true)}
              className={inputClasses(Boolean(errorFor("description")), "h-auto resize-y py-3 leading-6")}
            />
            <span className="-mt-1 self-end">
              <Counter value={s.description} max={EVENT_DESCRIPTION_MAX_CHARS} />
            </span>
          </FieldShell>
        )}
      </Section>

      {canSubmit && !hostOptions.canPublishDirectly && (
        <Section id="review" title="Review" description="Events from hosts are checked by the Charter Mission team before they’re listed, usually within a day." icon="shield">
          <FieldShell id="reviewNote" label="Note for the reviewer" optional hint="Only used when you submit.">
            <textarea id="reviewNote" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={inputClasses(false, "h-auto resize-y py-2.5")} aria-describedby="reviewNote-hint" />
          </FieldShell>
        </Section>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-t-card border border-b-0 border-line bg-card/95 px-5 py-3.5 shadow-[0px_-8px_24px_0px_rgba(26,32,44,0.06)] backdrop-blur max-sm:px-3">
        <p className={cn("text-sm text-secondary", !formError && "max-sm:sr-only")} aria-live="polite">
          {formError ? <span className="text-error">{formError}</span> : dirty ? "Unsaved changes" : mode === "edit" ? "No changes yet" : "Fill in the sections, then save or submit."}
        </p>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-end max-sm:gap-1.5 max-sm:*:px-3 max-sm:*:py-2 max-sm:*:text-sm">
          <button type="button" onClick={cancel} className={buttonClasses({ variant: "ghost" })}>
            Cancel
          </button>
          {(!published || mode === "create") && (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void save("save")}>
              {busy === "save" ? "Saving…" : mode === "create" ? "Save draft" : "Save"}
            </Button>
          )}
          {canSubmit ? (
            <Button type="submit" disabled={busy !== null} variant="accent">
              <Icon name="send" size={18} />
              {busy === "submit" ? "Working…" : submitLabel}
            </Button>
          ) : (
            published && (
              <Button type="submit" disabled={busy !== null || !dirty}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </Button>
            )
          )}
        </div>
      </div>

      {leaving && (
        <ConfirmDialog
          title="Discard your changes?"
          confirmLabel="Discard changes"
          danger
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            done.current = true;
            router.push(event ? `/events/${event.slug}` : "/events");
          }}
        >
          Everything you changed since you last saved will be lost.
        </ConfirmDialog>
      )}
      <Link href="#section-basics" className="sr-only focus:not-sr-only">
        Back to the top of the form
      </Link>
    </form>
  );
}

/** "Shows as Sat 21 Nov, 21:00 in Dubai" under the time fields. */
function TimePreview({ startsAt, endsAt, timezone, viewer }: { startsAt: string | null; endsAt: string | null; timezone: string; viewer: string | null }) {
  if (!startsAt) return <p className="text-sm text-secondary">Pick a date to see how the time shows to members.</p>;
  const eventLine = `${formatDay(startsAt, timezone)}, ${formatClock(startsAt, timezone)}${endsAt ? `–${formatClock(endsAt, timezone)}` : ""} ${zoneAbbreviation(timezone, startsAt)}`;
  const differs = viewer && !sameWallClock(viewer, timezone, startsAt);
  const examples = ["Africa/Lagos", "Africa/Nairobi", "Europe/London"].filter((z) => z !== timezone && z !== viewer && !sameWallClock(z, timezone, startsAt)).slice(0, 2);
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5 rounded-card bg-primary-tint-2 px-4 py-3 text-sm">
      <p className="text-ink">
        <span className="font-medium">{eventLine}</span> <span className="text-secondary">in {zoneCity(timezone)}</span>
      </p>
      {viewer && (
        <p className="text-body">
          {differs ? (
            <>
              Shows as <strong className="font-medium text-ink">{formatDay(startsAt, viewer)}, {formatClock(startsAt, viewer)}</strong> in {zoneCity(viewer)} (your time)
            </>
          ) : (
            <>Same as your time zone ({zoneCity(viewer)}).</>
          )}
        </p>
      )}
      {examples.length > 0 && (
        <p className="text-xs text-secondary">
          {examples.map((z) => `${formatClock(startsAt, z)} in ${zoneCity(z)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
