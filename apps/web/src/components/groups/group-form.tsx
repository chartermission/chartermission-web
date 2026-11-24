"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  GROUP_ABOUT_MAX,
  GROUP_NAME_MAX,
  GROUP_RULES_MAX,
  GroupInput,
  GroupUpdateInput,
  type GroupDetail,
  type GroupOwnerType,
  type GroupPostPermission,
  type GroupVisibility,
} from "@chartermission/contracts";
import { Button, Divider, Icon, cn } from "@chartermission/ui";
import { CountrySelect } from "@/components/account/country-select";
import { Field, inputClasses } from "@/components/auth/fields";
import { PagePictureField } from "@/components/pages/picture-field";
import { PageLogo } from "@/components/pages/page-logo";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { LockIcon, groupHref } from "./group-parts";

const TAGLINE_MAX = 120;
const JOIN_QUESTION_MAX = 300;
const MAX_HASHTAGS = 5;

export type OwnerOption = { type: GroupOwnerType; id: string; slug?: string; name: string; logoUrl?: string | null; note: string };

type Values = {
  name: string;
  slug: string;
  tagline: string;
  about: string;
  rules: string;
  visibility: GroupVisibility;
  postPermission: GroupPostPermission;
  postApproval: boolean;
  joinQuestion: string;
  countryCode: string;
  hashtags: string[];
  owner: string;
};
type Picture = { fileId: string | null; url: string | null; changed: boolean };

/** The address a name gives, the way the API makes it (lowercase letters, numbers and hyphens). */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

const noSubscribe = () => () => {};
/** The site's host ("chartermission.com"), once in the browser; empty while rendering on the server. */
function useHost(): string {
  return useSyncExternalStore(noSubscribe, () => window.location.host, () => "");
}

const ownerKey = (o: Pick<OwnerOption, "type" | "id">) => `${o.type}:${o.id}`;

function initialValues(group: GroupDetail | undefined, preset: string | undefined): Values {
  return {
    name: group?.name ?? "",
    slug: group?.slug ?? "",
    tagline: group?.tagline ?? "",
    about: group?.about ?? "",
    rules: group?.rules ?? "",
    visibility: group?.visibility ?? "public",
    postPermission: group?.postPermission ?? "members",
    postApproval: group?.postApproval ?? false,
    joinQuestion: group?.joinQuestion ?? "",
    countryCode: group?.country?.code ?? "",
    hashtags: group?.hashtags ?? [],
    owner: preset ?? "member:",
  };
}

/**
 * Create a group, or change one (its Manage → Settings). Who runs it is chosen when it is created
 * (me, a page I manage, a chapter team I'm on) and can't change; nor can its address.
 */
export function GroupForm({
  group,
  owners = [],
  preset,
  countries,
  onSaved,
}: {
  group?: GroupDetail;
  /** Pages and chapter teams the member may create a group for (create only). */
  owners?: OwnerOption[];
  /** "page:{id}" or "chapter:{id}" chosen in advance (from a page's or chapter's "Create a group"). */
  preset?: string;
  countries: CountryGroup[];
  onSaved?: (group: GroupDetail) => void;
}) {
  const t = useT();
  const router = useRouter();
  const editing = !!group;
  const [values, setValues] = useState<Values>(() => initialValues(group, preset && owners.some((o) => ownerKey(o) === preset) ? preset : undefined));
  const [slugEdited, setSlugEdited] = useState(false);
  const [editSlug, setEditSlug] = useState(false);
  const [logo, setLogo] = useState<Picture>({ fileId: null, url: group?.logoUrl ?? null, changed: false });
  const [cover, setCover] = useState<Picture>({ fileId: null, url: group?.coverUrl ?? null, changed: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState<Record<string, unknown> | null>(null);

  const host = useHost();
  const slug = editing ? group.slug : slugEdited ? values.slug : slugFromName(values.name);
  const switching = editing && values.visibility !== group.visibility;

  const clearError = (key: string) => {
    if (errors[key])
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
  };
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    clearError(key);
  };
  const text = (key: "name" | "tagline" | "about" | "rules" | "joinQuestion") => (event: { target: { value: string } }) => set(key, event.target.value);

  function focusFirst(next: Record<string, string>) {
    document.getElementById(`group-${Object.keys(next)[0]}`)?.focus();
  }

  function payload(): Record<string, unknown> {
    const [ownerType, ownerId] = values.owner.split(":") as [GroupOwnerType, string];
    const base: Record<string, unknown> = {
      name: values.name,
      tagline: values.tagline.trim() || null,
      about: values.about.trim() || null,
      rules: values.rules.trim() || null,
      visibility: values.visibility,
      postPermission: values.postPermission,
      postApproval: values.postApproval,
      joinQuestion: values.visibility === "private" ? values.joinQuestion.trim() || null : null,
      countryCode: values.countryCode || null,
      hashtags: values.hashtags,
      ...(logo.changed ? { logoFileId: logo.fileId } : {}),
      ...(cover.changed ? { coverFileId: cover.fileId } : {}),
    };
    if (editing) return base;
    return {
      ...base,
      ...(slugEdited && values.slug ? { slug: values.slug } : {}),
      ownerType,
      ...(ownerType === "page" ? { pageId: ownerId } : {}),
      ...(ownerType === "chapter" ? { chapterId: ownerId } : {}),
    };
  }

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setServerError(null);
    try {
      const saved = editing
        ? await api<GroupDetail>(groupHref(group.slug), { method: "PATCH", body })
        : await api<GroupDetail>("/groups", { method: "POST", body });
      if (editing) {
        toast.success(t("Group settings saved"));
        setBusy(false);
        setLogo((p) => ({ ...p, changed: false }));
        setCover((p) => ({ ...p, changed: false }));
        onSaved?.(saved);
        router.refresh();
      } else {
        toast.success(t("Your group is ready. Invite people to join it."));
        router.push(groupHref(saved.slug));
        router.refresh();
      }
    } catch (error) {
      setBusy(false);
      if (isApiError(error) && error.fields && Object.keys(error.fields).length) {
        setErrors(error.fields);
        focusFirst(error.fields);
      } else setServerError(error);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setServerError(null);
    const body = payload();
    const parsed = editing ? GroupUpdateInput.safeParse(body) : GroupInput.safeParse(body);
    const next: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
    }
    if (!editing && slugEdited && !values.slug) next.slug = t("Choose an address for the group");
    if (Object.keys(next).length) {
      setErrors(next);
      focusFirst(next);
      return;
    }
    if (switching) {
      setConfirmSwitch(body);
      return;
    }
    void save(body);
  }

  const counter = (n: number, max: number) => (
    <span className="text-xs text-secondary">
      {n} / {max}
    </span>
  );

  const ownerChoices: OwnerOption[] = [{ type: "member", id: "", name: t("Me"), note: t("You run it, and can add admins and moderators.") }, ...owners];

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {serverError !== null && <ErrorNotice error={serverError} />}

      <Field id="group-name" label={t("Group name")} hint={counter(values.name.length, GROUP_NAME_MAX)} error={errors.name}>
        <input
          id="group-name"
          value={values.name}
          onChange={text("name")}
          maxLength={GROUP_NAME_MAX}
          required
          dir="auto"
          placeholder={t("e.g. Fintech Builders in West Africa")}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby="group-address"
          className={inputClasses(!!errors.name)}
        />
      </Field>
      <div id="group-address" className="-mt-3 flex flex-col gap-1.5 text-xs text-secondary">
        {editSlug && !editing ? (
          <Field id="group-slug" label={t("Group address")} error={errors.slug}>
            <div className="flex items-center gap-1.5" dir="ltr">
              <span className="shrink-0 text-sm text-secondary">{host}/groups/</span>
              <input
                id="group-slug"
                value={values.slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  set("slug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60));
                }}
                maxLength={60}
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={errors.slug ? true : undefined}
                className={inputClasses(!!errors.slug, "flex-1")}
              />
            </div>
          </Field>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2">
            <span>{t("Address")}:</span>
            <span dir="ltr" className="font-medium text-body">
              {host}/groups/{slug || "…"}
            </span>
            {!editing && (
              <button
                type="button"
                className="rounded-sm font-medium text-primary-light hover:underline"
                onClick={() => {
                  setEditSlug(true);
                  setSlugEdited(true);
                  setValues((current) => ({ ...current, slug }));
                }}
              >
                {t("Change")}
              </button>
            )}
          </p>
        )}
        {!editing && <p>{t("The address can’t be changed once the group is created.")}</p>}
        {errors.slug && !editSlug && <p className="text-error">{errors.slug}</p>}
      </div>

      <Field id="group-tagline" label={t("Tagline")} hint={counter(values.tagline.length, TAGLINE_MAX)} error={errors.tagline}>
        <input
          id="group-tagline"
          value={values.tagline}
          onChange={text("tagline")}
          maxLength={TAGLINE_MAX}
          dir="auto"
          placeholder={t("One line on what the group is for")}
          aria-invalid={errors.tagline ? true : undefined}
          className={inputClasses(!!errors.tagline)}
        />
      </Field>

      <Field id="group-about" label={t("About")} hint={counter(values.about.length, GROUP_ABOUT_MAX)} error={errors.about}>
        <textarea
          id="group-about"
          value={values.about}
          onChange={text("about")}
          maxLength={GROUP_ABOUT_MAX}
          rows={5}
          dir="auto"
          placeholder={t("Who the group is for and what members share here")}
          aria-invalid={errors.about ? true : undefined}
          className={inputClasses(!!errors.about, "h-auto resize-y py-2.5")}
        />
      </Field>

      <Field id="group-rules" label={t("Rules")} hint={counter(values.rules.length, GROUP_RULES_MAX)} error={errors.rules}>
        <textarea
          id="group-rules"
          value={values.rules}
          onChange={text("rules")}
          maxLength={GROUP_RULES_MAX}
          rows={4}
          dir="auto"
          placeholder={t("What members agree to, one rule per line (optional)")}
          aria-invalid={errors.rules ? true : undefined}
          className={inputClasses(!!errors.rules, "h-auto resize-y py-2.5")}
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">{t("Who can see it")}</legend>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Choice
            name="group-visibility"
            id="group-visibility"
            checked={values.visibility === "public"}
            onChange={() => set("visibility", "public")}
            icon={<Icon name="globe" size={18} />}
            title={t("Public")}
            note={t("Anyone can see posts and join")}
          />
          <Choice
            name="group-visibility"
            checked={values.visibility === "private"}
            onChange={() => set("visibility", "private")}
            icon={<LockIcon size={18} />}
            title={t("Private")}
            note={t("Anyone can find it; only members see posts. People ask to join or are invited")}
          />
        </div>
        {switching && (
          <p role="note" className="flex items-start gap-2 rounded-lg bg-warning-light px-3 py-2.5 text-sm text-ink">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
            {values.visibility === "private"
              ? t("Posts already in the group will be seen only by its members. New people will have to ask to join.")
              : t("Posts already in the group will be seen by every signed-in member, and anyone can join without asking.")}
          </p>
        )}
      </fieldset>

      {!editing && owners.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-ink">{t("Run as")}</legend>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {ownerChoices.map((owner, index) => (
              <Choice
                key={ownerKey(owner)}
                name="group-owner"
                id={index === 0 ? "group-ownerType" : undefined}
                checked={values.owner === ownerKey(owner)}
                onChange={() => set("owner", ownerKey(owner))}
                icon={
                  owner.type === "member" ? (
                    <Icon name="user" size={18} />
                  ) : owner.type === "page" ? (
                    <PageLogo name={owner.name} src={owner.logoUrl} size={22} />
                  ) : (
                    <Icon name="globe" size={18} />
                  )
                }
                title={owner.name}
                note={owner.note}
              />
            ))}
          </div>
          {(errors.ownerType || errors.pageId || errors.chapterId) && (
            <p className="text-xs text-error">{errors.ownerType ?? errors.pageId ?? errors.chapterId}</p>
          )}
        </fieldset>
      )}

      <Divider />

      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field id="group-postPermission" label={t("Who can post")} error={errors.postPermission}>
          <select
            id="group-postPermission"
            value={values.postPermission}
            onChange={(event) => set("postPermission", event.target.value as GroupPostPermission)}
            className={inputClasses(!!errors.postPermission, "cursor-pointer")}
          >
            <option value="members">{t("All members")}</option>
            <option value="admins">{t("Only admins and moderators")}</option>
          </select>
        </Field>
        <Field id="group-countryCode" label={t("Country")} error={errors.countryCode}>
          <CountrySelect
            id="group-countryCode"
            groups={countries}
            value={values.countryCode}
            onChange={(event) => set("countryCode", event.target.value)}
            invalid={!!errors.countryCode}
            placeholder={t("Not tied to a country")}
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          id="group-postApproval"
          type="checkbox"
          checked={values.postApproval}
          onChange={(event) => set("postApproval", event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{t("Approve posts first")}</span>
          <span className="text-xs text-secondary">{t("Members’ posts wait until an admin or moderator approves them.")}</span>
        </span>
      </label>

      {values.visibility === "private" && (
        <Field id="group-joinQuestion" label={t("Join question (optional)")} hint={counter(values.joinQuestion.length, JOIN_QUESTION_MAX)} error={errors.joinQuestion}>
          <input
            id="group-joinQuestion"
            value={values.joinQuestion}
            onChange={text("joinQuestion")}
            maxLength={JOIN_QUESTION_MAX}
            dir="auto"
            placeholder={t("e.g. What do you work on, and what would you like to share here?")}
            aria-invalid={errors.joinQuestion ? true : undefined}
            aria-describedby="group-joinQuestion-hint"
            className={inputClasses(!!errors.joinQuestion)}
          />
          <p id="group-joinQuestion-hint" className="text-xs text-secondary">
            {t("People answer it when they ask to join. Admins and moderators see the answers.")}
          </p>
        </Field>
      )}

      <Field
        id="group-hashtags"
        label={t("Hashtags")}
        hint={<span className="text-xs text-secondary">{t("{count} of {max}", { count: values.hashtags.length, max: MAX_HASHTAGS })}</span>}
        error={errors.hashtags}
      >
        <HashtagsInput id="group-hashtags" value={values.hashtags} invalid={!!errors.hashtags} onChange={(next) => set("hashtags", next)} />
      </Field>

      <Divider />
      <PagePictureField kind="logo" purpose="group_logo" name={values.name || "G"} url={logo.url} onChange={(picture) => setLogo({ ...picture, changed: true })} />
      {errors.logoFileId && <p className="-mt-3 text-xs text-error">{errors.logoFileId}</p>}
      <PagePictureField kind="cover" purpose="group_cover" name={values.name} url={cover.url} onChange={(picture) => setCover({ ...picture, changed: true })} />
      {errors.coverFileId && <p className="-mt-3 text-xs text-error">{errors.coverFileId}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line pt-5">
        {!editing && (
          <Button variant="secondary" onClick={() => router.push("/groups")} disabled={busy}>
            {t("Cancel")}
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? t("Saving…") : editing ? t("Save changes") : t("Create group")}
        </Button>
      </div>

      {confirmSwitch && (
        <ConfirmDialog
          title={values.visibility === "private" ? t("Make the group private?") : t("Make the group public?")}
          confirmLabel={values.visibility === "private" ? t("Make private") : t("Make public")}
          onClose={() => setConfirmSwitch(null)}
          onConfirm={async () => {
            const body = confirmSwitch;
            setConfirmSwitch(null);
            await save(body);
          }}
        >
          {values.visibility === "private"
            ? t("Posts already in the group will be seen only by its members. New people will have to ask to join.")
            : t("Posts already in the group will be seen by every signed-in member, and anyone can join without asking.")}
        </ConfirmDialog>
      )}
    </form>
  );
}

/** A radio shown as a card: icon, title and one line of explanation. */
function Choice({
  name,
  id,
  checked,
  onChange,
  icon,
  title,
  note,
}: {
  name: string;
  id?: string;
  checked: boolean;
  onChange: () => void;
  icon: ReactNode;
  title: string;
  note: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors",
        checked ? "border-primary bg-primary-tint-2" : "border-line hover:border-line-strong",
      )}
    >
      <input id={id} type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 size-4 shrink-0 accent-primary" />
      <span className={cn("mt-0.5 shrink-0", checked ? "text-primary" : "text-secondary")}>{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-secondary">{note}</span>
      </span>
    </label>
  );
}

/** Up to five hashtags: type and press Enter or comma; Backspace removes the last. */
function HashtagsInput({ id, value, invalid, onChange }: { id: string; value: string[]; invalid: boolean; onChange: (next: string[]) => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_HASHTAGS;

  function add() {
    const tag = draft.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 50);
    if (!tag || full) return;
    if (!value.some((v) => v.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Hashtags")}>
          {value.map((tag) => (
            <li key={tag} className="flex items-center gap-1 rounded-full bg-accent-light py-1 ps-3 pe-1.5 text-sm font-medium text-accent-hover">
              <span dir="auto">#{tag}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== tag))}
                className="rounded-full p-0.5 hover:bg-card/60"
                aria-label={t("Remove {name}", { name: `#${tag}` })}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        disabled={full}
        dir="auto"
        placeholder={full ? t("That’s the most a group can have") : t("Type a hashtag and press Enter")}
        aria-invalid={invalid || undefined}
        className={inputClasses(invalid)}
      />
    </div>
  );
}
