"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { HANDLE_PATTERN, type HandleAvailability, type OwnProfile } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { FieldError, inputClasses } from "@/components/auth/fields";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useLocale, useT, T } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

type Check = { state: "idle" } | { state: "checking" } | { state: "free" } | { state: "taken"; reason: string } | { state: "invalid" };

/**
 * The member's username: the name in their profile address (/{username}) and in
 * @mentions. It can be changed once every 30 days; the old address keeps redirecting to the
 * new one, and nobody else can take the old name for six months.
 */
export function UsernameEditor({ handle, availableAt }: { handle: string; availableAt: string | null }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const id = useId();
  const [current, setCurrent] = useState(handle);
  const [lockedUntil, setLockedUntil] = useState(availableAt);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(handle);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const candidate = value.trim().toLowerCase();
  const changed = candidate !== current.toLowerCase();

  // Check availability a moment after the member stops typing.
  useEffect(() => {
    if (!editing || !changed || !HANDLE_PATTERN.test(candidate)) return;
    let live = true;
    const timer = setTimeout(() => {
      api<HandleAvailability>("/me/handle-availability", { query: { handle: candidate } })
        .then((r) => live && setCheck(r.available ? { state: "free" } : { state: "taken", reason: r.reason ?? "" }))
        .catch(() => live && setCheck({ state: "idle" }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [editing, changed, candidate]);

  function onChange(next: string) {
    setValue(next.replace(/\s+/g, "-"));
    setError(null);
    const c = next.trim().toLowerCase().replace(/\s+/g, "-");
    setCheck(c === current.toLowerCase() ? { state: "idle" } : HANDLE_PATTERN.test(c) ? { state: "checking" } : { state: "invalid" });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !changed || check.state !== "free") return;
    setSaving(true);
    try {
      const profile = await api<OwnProfile>("/me/profile", { method: "PATCH", body: { handle: candidate } });
      setCurrent(profile.handle);
      setValue(profile.handle);
      setLockedUntil(profile.handleChangeAvailableAt);
      setEditing(false);
      setCheck({ state: "idle" });
      toast.success(t("username.saved", { handle: profile.handle }));
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.handle ?? e.message) : t("common.tryAgain"));
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  const lockedDate = lockedUntil ? new Date(lockedUntil).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric" }) : null;
  const message =
    error ??
    (check.state === "invalid" ? t("username.rules") : check.state === "taken" ? check.reason || t("username.taken") : undefined);

  return (
    <li className="flex flex-col gap-3 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">{t("username.label")}</span>
          <span className="text-sm text-body" dir="ltr">
            @{current} <span className="text-secondary">· <span dir="ltr"><T vars={{ current }}>{"chartermission.com/{current}"}</T></span></span>
          </span>
          {lockedDate && <span className="text-xs text-secondary">{t("username.lockedUntil", { date: lockedDate })}</span>}
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/${current}`} className="text-sm font-medium text-primary-light hover:underline">
            {t("username.viewProfile")}
          </Link>
          {!editing && !lockedDate && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                setEditing(true);
                requestAnimationFrame(() => input.current?.select());
              }}
            >
              {t("username.change")}
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <label htmlFor={`${id}-input`} className="text-sm font-medium text-ink">
            {t("username.newLabel")}
          </label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="relative min-w-0 flex-1 basis-64" dir="ltr">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 my-auto h-fit start-3.5 text-sm text-secondary">
                @
              </span>
              <input
                ref={input}
                id={`${id}-input`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                aria-invalid={!!message}
                aria-describedby={t("{id}-help {id2}-status", { id, id2: id })}
                className={inputClasses(!!message, "ps-8 pe-9")}
              />
              <span className="absolute inset-y-0 my-auto h-fit end-3">
                {check.state === "checking" && <span className="block size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden />}
                {check.state === "free" && <Icon name="check" size={16} className="text-success" />}
                {(check.state === "taken" || check.state === "invalid") && <Icon name="x" size={16} className="text-error" />}
              </span>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="small" disabled={saving || !changed || check.state !== "free"} aria-busy={saving}>
                {saving ? t("common.saving") : t("common.save")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="small"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setValue(current);
                  setCheck({ state: "idle" });
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
          <p id={`${id}-status`} aria-live="polite" className="min-h-4 text-xs">
            {message ? <FieldError id={`${id}-error`} message={message} /> : check.state === "free" ? <span className="text-success">{t("username.available", { handle: candidate })}</span> : null}
          </p>
          <p id={`${id}-help`} className="text-xs text-secondary">
            {t("username.help")}
          </p>
        </form>
      )}
    </li>
  );
}
