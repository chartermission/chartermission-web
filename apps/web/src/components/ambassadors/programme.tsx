"use client";

import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  AMBASSADOR_AGREEMENT,
  AMBASSADOR_AGREEMENT_VERSION,
  type AmbassadorApplicationInput,
  type AmbassadorNominationInput,
  type MyAmbassadorStep,
  type MyAmbassadorView,
} from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, RoleBadgePill, buttonClasses, cn, type RoleBadgeData } from "@chartermission/ui";
import { Checkbox, Field, FormAlert, describedBy, inputClasses, textLinkClasses } from "@/components/auth/fields";
import { CountrySelect } from "@/components/account/country-select";
import { errorMessage } from "@/components/social/error-message";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";

type Errors = Record<string, string>;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Field errors from a 422, or a form-level message for anything else. */
function readError(error: unknown): { fields: Errors; message: string | null } {
  if (isApiError(error, "VALIDATION_FAILED") && error.fields && Object.keys(error.fields).length) {
    return { fields: error.fields, message: null };
  }
  return { fields: {}, message: errorMessage(error) };
}

const textareaClasses = (invalid: boolean) => cn(inputClasses(invalid), "h-auto py-2.5");

/** The Ambassador programme page: apply, follow an application, onboard, and nominate someone. */
export function AmbassadorProgramme({
  initial,
  countryGroups,
  emailVerified,
  defaultCountry,
  name,
}: {
  initial: MyAmbassadorView;
  countryGroups: CountryGroup[];
  emailVerified: boolean;
  defaultCountry: string | null;
  name: string;
}) {
  const [view, setView] = useState(initial);
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <StatusSection view={view} onChange={setView} countryGroups={countryGroups} emailVerified={emailVerified} defaultCountry={defaultCountry} name={name} />
      </div>
      <aside className="flex flex-col gap-5" aria-label="About the role and nominations">
        <AboutRole />
        <NominateCard countryGroups={countryGroups} emailVerified={emailVerified} />
      </aside>
    </div>
  );
}

function StatusSection({
  view,
  onChange,
  countryGroups,
  emailVerified,
  defaultCountry,
  name,
}: {
  view: MyAmbassadorView;
  onChange: (v: MyAmbassadorView) => void;
  countryGroups: CountryGroup[];
  emailVerified: boolean;
  defaultCountry: string | null;
  name: string;
}) {
  switch (view.status) {
    case "in_review":
      return <InReview view={view} />;
    case "onboarding":
      return <Onboarding view={view} onChange={onChange} name={name} />;
    case "ambassador":
      return <Serving view={view} />;
    case "alumni":
      return <Alumni view={view} />;
    default:
      if (!view.canApply) {
        return (
          <Panel className="flex flex-col gap-2 p-6">
            <h2 className="text-h2 text-ink">Thank you for applying</h2>
            <p className="text-md text-body">
              We weren’t able to offer you an Ambassador role this time.
              {view.reapplyFrom ? ` You can apply again from ${formatDate(view.reapplyFrom)}.` : ""} In the meantime, you can still
              nominate someone you think would be a great fit.
            </p>
          </Panel>
        );
      }
      return (
        <ApplyForm
          onApplied={onChange}
          countryGroups={countryGroups}
          emailVerified={emailVerified}
          defaultCountry={view.country?.code ?? defaultCountry}
          again={view.status === "closed"}
        />
      );
  }
}

/* ----------------------------- Apply ----------------------------- */

function ApplyForm({
  onApplied,
  countryGroups,
  emailVerified,
  defaultCountry,
  again,
}: {
  onApplied: (v: MyAmbassadorView) => void;
  countryGroups: CountryGroup[];
  emailVerified: boolean;
  defaultCountry: string | null;
  again: boolean;
}) {
  const id = useId();
  const [form, setForm] = useState({
    countryCode: defaultCountry ?? "",
    city: "",
    organisation: "",
    jobTitle: "",
    linkedinUrl: "",
    phone: "",
    hoursPerWeek: "",
    motivation: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const fid = (k: string) => `${id}-${k}`;
  const err = (k: string) => errors[k];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (!form.countryCode) local.countryCode = "Choose the country you would lead";
    const hours = Number(form.hoursPerWeek);
    if (!form.hoursPerWeek || !Number.isInteger(hours) || hours < 1) local.hoursPerWeek = "Enter the hours a week you can give";
    if (form.motivation.trim().length < 80) local.motivation = "Tell us a little more (80 characters or more)";
    setErrors(local);
    setMessage(null);
    if (Object.keys(local).length) return;
    const body: AmbassadorApplicationInput = { ...form, hoursPerWeek: hours };
    setBusy(true);
    try {
      onApplied(await api<MyAmbassadorView>("/ambassadors/applications", { body }));
    } catch (error) {
      const r = readError(error);
      setErrors(r.fields);
      setMessage(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 text-ink">{again ? "Apply again" : "Apply to be an Ambassador"}</h2>
        <p className="text-md text-secondary">
          One Ambassador leads each country chapter, in Africa and across the diaspora. It takes about five minutes; your name, email and
          photo come from your profile.
        </p>
      </div>
      {!emailVerified && <FormAlert tone="warning">Verify your email address before you apply. Check your inbox for the link.</FormAlert>}
      {message && <FormAlert tone="error">{message}</FormAlert>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={fid("country")} label="Country chapter you would lead" error={err("countryCode")}>
            <CountrySelect
              id={fid("country")}
              groups={countryGroups}
              value={form.countryCode}
              invalid={!!err("countryCode")}
              aria-describedby={describedBy(err("countryCode") && `${fid("country")}-error`)}
              onChange={(e) => set({ countryCode: e.target.value })}
            />
          </Field>
          <Field id={fid("city")} label="City" hint={<Optional />} error={err("city")}>
            <input id={fid("city")} value={form.city} maxLength={80} onChange={(e) => set({ city: e.target.value })} className={inputClasses(!!err("city"))} />
          </Field>
          <Field id={fid("organisation")} label="Organisation" hint={<Optional />} error={err("organisation")}>
            <input id={fid("organisation")} value={form.organisation} maxLength={120} onChange={(e) => set({ organisation: e.target.value })} className={inputClasses(!!err("organisation"))} />
          </Field>
          <Field id={fid("jobTitle")} label="Role or title" hint={<Optional />} error={err("jobTitle")}>
            <input id={fid("jobTitle")} value={form.jobTitle} maxLength={120} onChange={(e) => set({ jobTitle: e.target.value })} className={inputClasses(!!err("jobTitle"))} />
          </Field>
          <Field id={fid("linkedin")} label="LinkedIn profile" hint={<Optional />} error={err("linkedinUrl")}>
            <input
              id={fid("linkedin")}
              type="url"
              inputMode="url"
              placeholder="https://linkedin.com/in/…"
              value={form.linkedinUrl}
              maxLength={500}
              aria-describedby={describedBy(err("linkedinUrl") && `${fid("linkedin")}-error`)}
              onChange={(e) => set({ linkedinUrl: e.target.value })}
              className={inputClasses(!!err("linkedinUrl"))}
            />
          </Field>
          <Field id={fid("phone")} label="Phone or WhatsApp" hint={<Optional />} error={err("phone")}>
            <input id={fid("phone")} type="tel" autoComplete="tel" value={form.phone} maxLength={40} onChange={(e) => set({ phone: e.target.value })} className={inputClasses(!!err("phone"))} />
          </Field>
          <Field id={fid("hours")} label="Hours a week you can give" error={err("hoursPerWeek")}>
            <input
              id={fid("hours")}
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              value={form.hoursPerWeek}
              aria-describedby={describedBy(`${fid("hours")}-hint`, err("hoursPerWeek") && `${fid("hours")}-error`)}
              onChange={(e) => set({ hoursPerWeek: e.target.value })}
              className={inputClasses(!!err("hoursPerWeek"))}
            />
            <p id={`${fid("hours")}-hint`} className="text-xs text-secondary">
              Most Ambassadors give 3 to 5 hours a week.
            </p>
          </Field>
        </div>
        <Field id={fid("motivation")} label="Why you, and what would you do in your first 90 days?" error={err("motivation")}>
          <textarea
            id={fid("motivation")}
            rows={6}
            maxLength={3000}
            value={form.motivation}
            aria-describedby={describedBy(`${fid("motivation")}-count`, err("motivation") && `${fid("motivation")}-error`)}
            onChange={(e) => set({ motivation: e.target.value })}
            className={textareaClasses(!!err("motivation"))}
          />
          <p id={`${fid("motivation")}-count`} className="text-right text-xs text-secondary">
            {form.motivation.trim().length} / 3000
          </p>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-secondary">The community team reviews every application and replies by email.</p>
          <Button type="submit" disabled={busy || !emailVerified}>
            {busy ? "Sending…" : "Send application"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Optional() {
  return <span className="text-xs text-secondary">Optional</span>;
}

/* ----------------------------- In review ----------------------------- */

const REVIEW_STEPS = ["Application received", "Screening and review", "Interview", "Decision"];

function InReview({ view }: { view: MyAmbassadorView }) {
  return (
    <Panel className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <Chip tone="hashtag" className="self-start">
          In review
        </Chip>
        <h2 className="text-h2 text-ink">Your application is with the team</h2>
        <p className="text-md text-body">
          You applied to lead the {view.country?.name ?? "country"} chapter{view.appliedAt ? ` on ${formatDate(view.appliedAt)}` : ""}. We
          review every application and will email you about next steps, usually within three weeks.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {REVIEW_STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2.5 text-sm text-body">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium",
                i === 0 ? "bg-primary text-inverse" : "bg-muted text-secondary",
              )}
              aria-hidden
            >
              {i === 0 ? <Icon name="check" size={14} /> : i + 1}
            </span>
            {step}
            {i === 0 && <span className="sr-only">(done)</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* ----------------------------- Onboarding ----------------------------- */

function Onboarding({ view, onChange, name }: { view: MyAmbassadorView; onChange: (v: MyAmbassadorView) => void; name: string }) {
  const ob = view.onboarding;
  if (!ob) return null;
  const percent = Math.round((ob.done / ob.total) * 100);
  return (
    <>
      <Panel className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Chip tone="hashtag" className="self-start">
            Onboarding
          </Chip>
          <h2 className="text-h2 text-ink">Welcome, Ambassador-to-be</h2>
          <p className="text-md text-body">
            You have been selected to lead the {view.country?.name} chapter. Finish these steps and your Ambassador badge goes live on your
            profile.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="flex justify-between text-xs text-secondary">
            <span>
              {ob.done} of {ob.total} steps done
            </span>
            <span>{percent}%</span>
          </p>
          <div
            className="h-1.5 w-full overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-label="Onboarding progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <ol className="flex flex-col divide-y divide-line">
          {ob.steps.map((step) => (
            <StepRow key={step.key} step={step} view={view} />
          ))}
        </ol>
      </Panel>
      <AgreementCard view={view} onChange={onChange} name={name} />
    </>
  );
}

function StepRow({ step, view }: { step: MyAmbassadorStep; view: MyAmbassadorView }) {
  const done = step.status !== "pending";
  let action: ReactNode = null;
  if (!done) {
    if (step.key === "agreement") action = <a href="#agreement" className={textLinkClasses}>Read and sign</a>;
    else if (step.key === "profile") action = <Link href="/settings/profile" className={textLinkClasses}>Edit profile</Link>;
    else if (step.key === "orientation" || step.key === "first_event")
      action = <span className="text-xs text-secondary">Your community manager will arrange this</span>;
  }
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", done ? "bg-success-light text-success" : "border border-line-strong text-secondary")}
        aria-hidden
      >
        {done && <Icon name="check" size={14} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium text-ink">
          {step.label}
          <span className="sr-only">{done ? (step.status === "waived" ? " (not needed)" : " (done)") : " (to do)"}</span>
        </p>
        <p className="text-sm text-secondary">
          {step.key === "profile" && !done ? "Add a profile photo and a bio of a few sentences, including your vision for the chapter." : step.description}
        </p>
        {step.key === "training" && view.onboarding!.training.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1">
            {view.onboarding!.training.map((c) => (
              <li key={c.courseId} className="flex items-center gap-2 text-sm">
                <Icon name={c.completedAt ? "check" : "book"} size={14} className={c.completedAt ? "text-success" : "text-secondary"} />
                <a href={c.startUrl} target="_blank" rel="noreferrer" className={textLinkClasses}>
                  {c.title}
                  <span className="sr-only"> (opens Charter Center in a new tab)</span>
                </a>
                {c.completedAt && <span className="text-xs text-secondary">Done</span>}
              </li>
            ))}
          </ul>
        )}
        {step.status === "waived" && <p className="text-xs text-secondary">Not needed for you</p>}
        {done && step.completedAt && step.status === "done" && <p className="text-xs text-secondary">Done {formatDate(step.completedAt)}</p>}
      </div>
      {action && <div className="shrink-0 pt-0.5 text-sm">{action}</div>}
    </li>
  );
}

function AgreementCard({ view, onChange, name }: { view: MyAmbassadorView; onChange: (v: MyAmbassadorView) => void; name: string }) {
  const id = useId();
  const [fullName, setFullName] = useState(name);
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signed = view.agreement;

  async function sign(e: FormEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (fullName.trim().length < 2) local.fullName = "Type your full name to sign";
    if (!accept) local.accept = "Tick the box to confirm you agree";
    setErrors(local);
    setMessage(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      onChange(await api<MyAmbassadorView>("/ambassadors/me/agreement", { body: { fullName, accept: true, version: AMBASSADOR_AGREEMENT_VERSION } }));
    } catch (error) {
      const r = readError(error);
      setErrors(r.fields);
      setMessage(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="agreement" className="flex scroll-mt-24 flex-col gap-4 p-6" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-h2 text-ink">
          {AMBASSADOR_AGREEMENT.title}
        </h2>
        <p className="text-md text-body">{AMBASSADOR_AGREEMENT.intro}</p>
      </div>
      <ol className="flex max-h-[420px] flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-muted/40 p-4" tabIndex={0} aria-label="Agreement text">
        {AMBASSADOR_AGREEMENT.clauses.map((c, i) => (
          <li key={c.heading} className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-ink">
              {i + 1}. {c.heading}
            </p>
            <p className="text-sm text-body">{c.body}</p>
          </li>
        ))}
      </ol>
      {signed ? (
        <FormAlert tone="success">
          Signed as “{signed.signedName}” on {formatDate(signed.signedAt)}.
        </FormAlert>
      ) : (
        <form onSubmit={sign} noValidate className="flex flex-col gap-4">
          {message && <FormAlert tone="error">{message}</FormAlert>}
          <Field id={`${id}-name`} label="Type your full name to sign" error={errors.fullName}>
            <input
              id={`${id}-name`}
              autoComplete="name"
              value={fullName}
              maxLength={120}
              aria-describedby={describedBy(errors.fullName && `${id}-name-error`)}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClasses(!!errors.fullName)}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Checkbox
              name="accept"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              invalid={!!errors.accept}
              describedBy={describedBy(errors.accept && `${id}-accept-error`)}
            >
              <span className="text-body">I have read the Ambassador Agreement and Code of Conduct and I agree to it.</span>
            </Checkbox>
            {errors.accept && (
              <p id={`${id}-accept-error`} className="flex items-center gap-1 text-xs text-error">
                <Icon name="alert" size={14} className="shrink-0" />
                {errors.accept}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Signing…" : "Sign agreement"}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/* ----------------------------- Serving and alumni ----------------------------- */

function badgeFor(view: MyAmbassadorView, kind: RoleBadgeData["kind"]): RoleBadgeData {
  const label = kind === "alumni_ambassador" ? "Alumni Ambassador" : kind === "founding_ambassador" ? "Founding Ambassador" : "Ambassador";
  return { kind, label, place: view.chapter?.name ?? view.country?.name ?? "" };
}

function Serving({ view }: { view: MyAmbassadorView }) {
  const badge = badgeFor(view, view.founding ? "founding_ambassador" : "ambassador");
  return (
    <Panel className="flex flex-col gap-4 p-6">
      <RoleBadgePill badge={badge} />
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 text-ink">
          You are the {badge.label} for {view.country?.name}
        </h2>
        <p className="text-md text-body">
          {view.certifiedAt ? `Your badge went live on ${formatDate(view.certifiedAt)}. ` : ""}It shows next to your name across Charter
          Mission. Your community manager will share the chapter tools and next steps with you.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {view.chapter && (
          <Link href={`/chapters/${view.chapter.slug}`} className={buttonClasses()}>
            Open {view.chapter.name}
          </Link>
        )}
        <a href="#agreement-summary" className={buttonClasses({ variant: "secondary" })}>
          Your agreement
        </a>
      </div>
      {view.agreement && (
        <p id="agreement-summary" className="text-xs text-secondary">
          Ambassador Agreement signed as “{view.agreement.signedName}” on {formatDate(view.agreement.signedAt)} (version{" "}
          {view.agreement.version}).
        </p>
      )}
    </Panel>
  );
}

function Alumni({ view }: { view: MyAmbassadorView }) {
  return (
    <Panel className="flex flex-col gap-4 p-6">
      <RoleBadgePill badge={badgeFor(view, "alumni_ambassador")} />
      <h2 className="text-h2 text-ink">Thank you for leading the {view.country?.name} chapter</h2>
      <p className="text-md text-body">
        Your term has ended and your profile shows an Alumni Ambassador badge. If you would like to serve another term, talk to the
        community team. You can also nominate someone to take the chapter forward.
      </p>
    </Panel>
  );
}

/* ----------------------------- Sidebar ----------------------------- */

const ROLE_POINTS: { icon: "flag" | "calendar" | "users" | "shield"; text: string }[] = [
  { icon: "flag", text: "Lead your country’s chapter for a 12-month term" },
  { icon: "users", text: "Welcome new members and connect people across the network" },
  { icon: "calendar", text: "Host at least one chapter event each quarter" },
  { icon: "shield", text: "An Ambassador badge on your profile, and support from the community team" },
];

function AboutRole() {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <h2 className="text-md font-medium text-ink">About the role</h2>
      <ul className="flex flex-col gap-2.5">
        {ROLE_POINTS.map((p) => (
          <li key={p.text} className="flex items-start gap-2.5 text-sm text-body">
            <Icon name={p.icon} size={16} className="mt-0.5 shrink-0 text-primary" />
            {p.text}
          </li>
        ))}
      </ul>
      <p className="text-xs text-secondary">A volunteer role of about 3 to 5 hours a week. Ambassadors stay non-partisan.</p>
    </Panel>
  );
}

function NominateCard({ countryGroups, emailVerified }: { countryGroups: CountryGroup[]; emailVerified: boolean }) {
  const id = useId();
  const empty = { fullName: "", email: "", countryCode: "", organisation: "", linkedinUrl: "", reason: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const fid = (k: string) => `${id}-${k}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (form.fullName.trim().length < 2) local.fullName = "Enter their full name";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = "Enter a valid email";
    if (!form.countryCode) local.countryCode = "Choose a country";
    if (form.reason.trim().length < 30) local.reason = "Tell us why (30 characters or more)";
    setErrors(local);
    setMessage(null);
    if (Object.keys(local).length) return;
    const body: AmbassadorNominationInput = form;
    setBusy(true);
    try {
      await api("/ambassadors/nominations", { body });
      setSent(form.fullName.trim());
      setForm(empty);
    } catch (error) {
      const r = readError(error);
      setErrors(r.fields);
      setMessage(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="nominate" className="flex scroll-mt-24 flex-col gap-4 p-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-md font-medium text-ink">
          Nominate someone
        </h2>
        <p className="text-sm text-secondary">Know someone who would lead their country’s chapter well? Tell us about them.</p>
      </div>
      {sent && (
        <FormAlert tone="success">
          Thank you. Unless {sent} is already talking to us, we will email them an invitation to apply and mention that you nominated them.
        </FormAlert>
      )}
      {message && <FormAlert tone="error">{message}</FormAlert>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Field id={fid("name")} label="Their full name" error={errors.fullName}>
          <input id={fid("name")} value={form.fullName} maxLength={120} onChange={(e) => set({ fullName: e.target.value })} className={inputClasses(!!errors.fullName)} />
        </Field>
        <Field id={fid("email")} label="Their email" error={errors.email}>
          <input id={fid("email")} type="email" value={form.email} maxLength={254} onChange={(e) => set({ email: e.target.value })} className={inputClasses(!!errors.email)} />
        </Field>
        <Field id={fid("country")} label="Country chapter" error={errors.countryCode}>
          <CountrySelect id={fid("country")} groups={countryGroups} value={form.countryCode} invalid={!!errors.countryCode} onChange={(e) => set({ countryCode: e.target.value })} />
        </Field>
        <Field id={fid("org")} label="Organisation" hint={<Optional />} error={errors.organisation}>
          <input id={fid("org")} value={form.organisation} maxLength={120} onChange={(e) => set({ organisation: e.target.value })} className={inputClasses(!!errors.organisation)} />
        </Field>
        <Field id={fid("linkedin")} label="LinkedIn profile" hint={<Optional />} error={errors.linkedinUrl}>
          <input id={fid("linkedin")} type="url" inputMode="url" value={form.linkedinUrl} maxLength={500} onChange={(e) => set({ linkedinUrl: e.target.value })} className={inputClasses(!!errors.linkedinUrl)} />
        </Field>
        <Field id={fid("reason")} label="Why would they be a great Ambassador?" error={errors.reason}>
          <textarea id={fid("reason")} rows={4} maxLength={1500} value={form.reason} onChange={(e) => set({ reason: e.target.value })} className={textareaClasses(!!errors.reason)} />
        </Field>
        {!emailVerified && <p className="text-xs text-secondary">Verify your email address to send nominations.</p>}
        <Button type="submit" variant="secondary" disabled={busy || !emailVerified}>
          {busy ? "Sending…" : "Send nomination"}
        </Button>
      </form>
    </Panel>
  );
}
