"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import {
  INITIATIVE_DESCRIPTION_MAX,
  INITIATIVE_MAX_MILESTONES,
  INITIATIVE_MAX_ROLES,
  INITIATIVE_SUMMARY_MAX,
  INITIATIVE_TITLE_MAX,
  InitiativeEditableStatus,
  InitiativeInput,
  type InitiativeDetail,
  type InitiativeHostOptions,
} from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Field, FormAlert, inputClasses } from "@/components/auth/fields";
import { PagePictureField } from "@/components/pages/picture-field";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import { initiativeHref, initiativeStatusMeta } from "./format";
import { useT } from "@/i18n/client";

type Option = { value: string; label: string };
type RoleDraft = { key: string; id?: string; title: string; description: string; skills: string; open: boolean };
type MilestoneDraft = { key: string; id?: string; title: string; note: string; targetDate: string; done: boolean };

const selectClasses = (invalid: boolean) => inputClasses(invalid, "cursor-pointer appearance-none");
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

const STATUS_HINT: Record<string, string> = {
  idea: "Still shaping it. Members can follow along.",
  recruiting: "Looking for people. Members can ask to join.",
  active: "Under way. Members can follow it.",
  paused: "On hold for now.",
  completed: "Done. It stays up so others can learn from it.",
};

/**
 * Start or edit an initiative: who hosts it (new only), what it is, its theme, country, status and
 * cover, the roles it needs and its milestones. Live as soon as it is saved.
 */
export function InitiativeForm({
  initiative,
  hosts,
  themes,
  countries,
}: {
  initiative?: InitiativeDetail;
  hosts?: InitiativeHostOptions;
  themes: Option[];
  countries: Option[];
}) {
  const t = useT();
  const router = useRouter();
  const formId = useId();
  const [host, setHost] = useState("member");
  const [title, setTitle] = useState(initiative?.title ?? "");
  const [summary, setSummary] = useState(initiative?.summary ?? "");
  const [description, setDescription] = useState(initiative?.description ?? "");
  const [themeId, setThemeId] = useState(initiative?.theme?.id ?? "");
  const [countryCode, setCountryCode] = useState(initiative?.country?.code ?? "");
  const [status, setStatus] = useState<string>(initiative?.status === "archived" ? "completed" : (initiative?.status ?? "recruiting"));
  const [cover, setCover] = useState<{ fileId: string | null; url: string | null; changed: boolean }>({ fileId: null, url: initiative?.coverUrl ?? null, changed: false });
  const [roles, setRoles] = useState<RoleDraft[]>(
    () => initiative?.roles.map((r) => ({ key: nextKey(), id: r.id, title: r.title, description: r.description, skills: r.skills.join(", "), open: r.open })) ?? [],
  );
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(
    () => initiative?.milestoneList.map((m) => ({ key: nextKey(), id: m.id, title: m.title, note: m.note ?? "", targetDate: m.targetDate ?? "", done: m.state === "done" })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const hostChoices: Option[] = [
    { value: "member", label: t("Myself") },
    ...(hosts?.pages ?? []).map((p) => ({ value: `page:${p.id}`, label: t("Page: {name}", { name: p.name }) })),
    ...(hosts?.chapters ?? []).map((c) => ({ value: `chapter:${c.id}`, label: t("Chapter: {name}", { name: c.name }) })),
  ];

  function payload() {
    const [kind, hostId] = host.split(":");
    return {
      title,
      summary,
      description,
      themeId: themeId || null,
      countryCode: countryCode || null,
      status,
      ...(cover.changed || !initiative ? { coverFileId: cover.fileId } : {}),
      roles: roles.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        title: r.title,
        description: r.description,
        skills: r.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        open: r.open,
      })),
      milestones: milestones.map((m) => ({ ...(m.id ? { id: m.id } : {}), title: m.title, note: m.note || null, targetDate: m.targetDate || null, done: m.done })),
      ...(initiative ? {} : { host: kind === "page" ? { type: "page", pageId: hostId } : kind === "chapter" ? { type: "chapter", chapterId: hostId } : { type: "member" } }),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const body = payload();
    const parsed = InitiativeInput.safeParse(initiative ? { ...body, host: { type: "member" } } : body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      document.getElementById(`${formId}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = initiative
        ? await api<InitiativeDetail>(`/initiatives/${initiative.id}`, { method: "PATCH", body })
        : await api<InitiativeDetail>("/initiatives", { method: "POST", body });
      toast.success(initiative ? "Initiative updated" : "Your initiative is live");
      router.push(initiativeHref(saved.slug));
      router.refresh();
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) setErrors(e.fields);
      setServerError(e);
      setBusy(false);
    }
  }

  const err = (key: string) => errors[key];
  const fid = (key: string) => `${formId}-${key}`;
  const counter = (n: number, max: number) => (
    <span className={cn("text-xs", n > max - 20 ? "text-warning" : "text-secondary")}>
      {n} / {max}
    </span>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6 rounded-card border border-line bg-card p-6 max-sm:p-4">
      {!initiative && (
        <FormAlert tone="info" icon="lightbulb">
          Your initiative goes live as soon as you save it. You lead it: you answer join requests, manage the team and post updates. You can invite co-organisers once people join.
        </FormAlert>
      )}

      {!initiative && hostChoices.length > 1 && (
        <Field id={fid("host")} label="Who is running it?" error={err("host")} hint={<span className="text-xs text-secondary">A page’s admins or a chapter’s leads can organise it too.</span>}>
          <select id={fid("host")} value={host} onChange={(e) => setHost(e.target.value)} className={selectClasses(!!err("host"))}>
            {hostChoices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field id={fid("title")} label="Name" hint={counter(title.length, INITIATIVE_TITLE_MAX)} error={err("title")}>
        <input id={fid("title")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={INITIATIVE_TITLE_MAX} placeholder="e.g. Farm-to-Port Lagos" className={inputClasses(!!err("title"))} />
      </Field>
      <Field id={fid("summary")} label="In a sentence or two" hint={counter(summary.length, INITIATIVE_SUMMARY_MAX)} error={err("summary")}>
        <textarea
          id={fid("summary")}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={INITIATIVE_SUMMARY_MAX}
          rows={2}
          placeholder="What you’re doing, and for whom. Shown on the initiative’s card."
          className={cn(inputClasses(!!err("summary")), "h-auto py-2.5")}
        />
      </Field>
      <Field id={fid("description")} label="About (optional)" hint={<span className="text-xs text-secondary">The problem, your plan, and how people can help</span>} error={err("description")}>
        <textarea
          id={fid("description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={INITIATIVE_DESCRIPTION_MAX}
          rows={7}
          className={cn(inputClasses(!!err("description")), "h-auto py-2.5")}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field id={fid("themeId")} label="Theme" error={err("themeId")}>
          <select id={fid("themeId")} value={themeId} onChange={(e) => setThemeId(e.target.value)} className={selectClasses(!!err("themeId"))}>
            <option value="">Choose a theme</option>
            {themes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fid("countryCode")} label="Where it runs" error={err("countryCode")}>
          <select id={fid("countryCode")} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className={selectClasses(!!err("countryCode"))}>
            <option value="">Several countries or online</option>
            {countries.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fid("status")} label="Status" error={err("status")}>
          <select id={fid("status")} value={status} onChange={(e) => setStatus(e.target.value)} className={selectClasses(!!err("status"))}>
            {InitiativeEditableStatus.options.map((s) => (
              <option key={s} value={s}>
                {initiativeStatusMeta[s].label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="-mt-3 text-xs text-secondary">{STATUS_HINT[status]}</p>

      <PagePictureField kind="cover" purpose="initiative_cover" name={title} url={cover.url} onChange={(p) => setCover({ ...p, changed: true })} />
      {err("coverFileId") && <p className="-mt-4 text-xs text-error">{err("coverFileId")}</p>}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex w-full items-center justify-between gap-3">
          <span className="text-h3 text-ink">Roles you need</span>
          <span className="text-xs text-secondary">{t("{count} of {max}", { count: roles.length, max: INITIATIVE_MAX_ROLES })}</span>
        </legend>
        <p className="text-sm text-secondary">Members can ask to join for a role. Leave this empty if you’re not looking for anyone yet.</p>
        {roles.map((role, i) => (
          <div key={role.key} className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <Field id={fid(`roles.${i}.title`)} label={t("Role {number}", { number: i + 1 })} error={err(`roles.${i}.title`)} className="flex-1">
                <input
                  id={fid(`roles.${i}.title`)}
                  value={role.title}
                  maxLength={80}
                  placeholder="e.g. Cold-chain logistics lead"
                  onChange={(e) => setRoles((rs) => rs.map((r) => (r.key === role.key ? { ...r, title: e.target.value } : r)))}
                  className={inputClasses(!!err(`roles.${i}.title`))}
                />
              </Field>
              <button
                type="button"
                onClick={() => setRoles((rs) => rs.filter((r) => r.key !== role.key))}
                aria-label={t("Remove role {number}", { number: i + 1 })}
                className="mt-7 rounded-md p-1.5 text-secondary hover:bg-muted hover:text-error"
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
            <Field id={fid(`roles.${i}.description`)} label="What it involves (optional)" error={err(`roles.${i}.description`)}>
              <input
                id={fid(`roles.${i}.description`)}
                value={role.description}
                maxLength={400}
                placeholder="e.g. Plan routes for the pilot corridor. ~6 hrs/week."
                onChange={(e) => setRoles((rs) => rs.map((r) => (r.key === role.key ? { ...r, description: e.target.value } : r)))}
                className={inputClasses(!!err(`roles.${i}.description`))}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <Field id={fid(`roles.${i}.skills`)} label="Skills, separated by commas (optional)" error={err(`roles.${i}.skills`)} className="min-w-[240px] flex-1">
                <input
                  id={fid(`roles.${i}.skills`)}
                  value={role.skills}
                  placeholder="e.g. Logistics, Ops"
                  onChange={(e) => setRoles((rs) => rs.map((r) => (r.key === role.key ? { ...r, skills: e.target.value } : r)))}
                  className={inputClasses(!!err(`roles.${i}.skills`))}
                />
              </Field>
              {role.id && (
                <label className="flex h-[42px] items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={!role.open}
                    onChange={(e) => setRoles((rs) => rs.map((r) => (r.key === role.key ? { ...r, open: !e.target.checked } : r)))}
                    className="size-4 accent-primary"
                  />
                  Filled
                </label>
              )}
            </div>
          </div>
        ))}
        {roles.length < INITIATIVE_MAX_ROLES && (
          <Button
            variant="secondary"
            size="small"
            className="self-start"
            onClick={() => setRoles((rs) => [...rs, { key: nextKey(), title: "", description: "", skills: "", open: true }])}
          >
            <Icon name="plus" size={16} />
            Add a role
          </Button>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex w-full items-center justify-between gap-3">
          <span className="text-h3 text-ink">Milestones</span>
          <span className="text-xs text-secondary">{t("{count} of {max}", { count: milestones.length, max: INITIATIVE_MAX_MILESTONES })}</span>
        </legend>
        <p className="text-sm text-secondary">The steps to get there, in order. Tick them off as you go: progress on the card follows them.</p>
        {milestones.map((m, i) => (
          <div key={m.key} className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <Field id={fid(`milestones.${i}.title`)} label={t("Milestone {number}", { number: i + 1 })} error={err(`milestones.${i}.title`)} className="flex-1">
                <input
                  id={fid(`milestones.${i}.title`)}
                  value={m.title}
                  maxLength={120}
                  placeholder="e.g. Pilot hub live"
                  onChange={(e) => setMilestones((ms) => ms.map((x) => (x.key === m.key ? { ...x, title: e.target.value } : x)))}
                  className={inputClasses(!!err(`milestones.${i}.title`))}
                />
              </Field>
              <div className="mt-7 flex items-center">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => setMilestones((ms) => move(ms, i, i - 1))}
                  aria-label={t("Move milestone {number} up", { number: i + 1 })}
                  className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevron-down" size={18} className="rotate-180" />
                </button>
                <button
                  type="button"
                  disabled={i === milestones.length - 1}
                  onClick={() => setMilestones((ms) => move(ms, i, i + 1))}
                  aria-label={t("Move milestone {number} down", { number: i + 1 })}
                  className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevron-down" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setMilestones((ms) => ms.filter((x) => x.key !== m.key))}
                  aria-label={t("Remove milestone {number}", { number: i + 1 })}
                  className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-error"
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <Field id={fid(`milestones.${i}.note`)} label="Detail (optional)" error={err(`milestones.${i}.note`)} className="min-w-[220px] flex-1">
                <input
                  id={fid(`milestones.${i}.note`)}
                  value={m.note}
                  maxLength={200}
                  placeholder="e.g. 40 farms across Ogun and Oyo"
                  onChange={(e) => setMilestones((ms) => ms.map((x) => (x.key === m.key ? { ...x, note: e.target.value } : x)))}
                  className={inputClasses(!!err(`milestones.${i}.note`))}
                />
              </Field>
              <Field id={fid(`milestones.${i}.targetDate`)} label="Target date (optional)" error={err(`milestones.${i}.targetDate`)} className="w-[180px]">
                <input
                  id={fid(`milestones.${i}.targetDate`)}
                  type="date"
                  value={m.targetDate}
                  onChange={(e) => setMilestones((ms) => ms.map((x) => (x.key === m.key ? { ...x, targetDate: e.target.value } : x)))}
                  className={inputClasses(!!err(`milestones.${i}.targetDate`))}
                />
              </Field>
              <label className="flex h-[42px] items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={m.done}
                  onChange={(e) => setMilestones((ms) => ms.map((x) => (x.key === m.key ? { ...x, done: e.target.checked } : x)))}
                  className="size-4 accent-primary"
                />
                Done
              </label>
            </div>
          </div>
        ))}
        {milestones.length < INITIATIVE_MAX_MILESTONES && (
          <Button
            variant="secondary"
            size="small"
            className="self-start"
            onClick={() => setMilestones((ms) => [...ms, { key: nextKey(), title: "", note: "", targetDate: "", done: false }])}
          >
            <Icon name="plus" size={16} />
            Add a milestone
          </Button>
        )}
      </fieldset>

      {serverError && !Object.keys(errors).length ? <ErrorNotice error={serverError} /> : null}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-error">
          Check the highlighted fields.
        </p>
      )}
      <div className="flex justify-end gap-2.5 border-t border-line pt-5">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="accent" disabled={busy}>
          {busy ? "Saving…" : initiative ? "Save changes" : "Start the initiative"}
        </Button>
      </div>
    </form>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
