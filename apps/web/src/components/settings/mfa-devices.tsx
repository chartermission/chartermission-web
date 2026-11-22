"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import {
  AddMfaDeviceInput,
  MFA_DEVICE_NAME_MAX,
  MFA_MAX_DEVICES,
  MfaCodeInput,
  type MfaDeviceSetup,
  type MfaDeviceView,
} from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Field, FormAlert, describedBy, inputClasses, retryMessage } from "@/components/auth/fields";
import { relativeTime } from "@/components/social/format";
import { useIntlTag, useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

type Adding = { step: "start" } | { step: "scan"; name: string; setup: MfaDeviceSetup } | null;

const cleaned = (code: string) => code.replace(/\s/g, "");

function failure(t: Translate, e: unknown): { code?: string; form?: string } {
  if (isApiError(e, "INVALID_MFA_CODE")) return { code: e.message };
  if (isApiError(e, "RATE_LIMITED")) return { form: retryMessage(t, e.retryAfter) };
  return { form: isApiError(e) ? e.message : "Something went wrong. Please try again." };
}

function CodeField({ id, label, hint, value, error, onChange }: { id: string; label: string; hint?: string; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className="w-[240px] max-w-full">
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && `${id}-error`, hint && `${id}-hint`)}
        className={inputClasses(!!error, "font-mono tracking-[0.3em]")}
      />
    </Field>
  );
}

/**
 * The authenticator apps ("devices") on the account, shown while two-step verification is on.
 * A code from any of them signs in, so a second device is the way back in if one is lost.
 * Adding one takes a code from a device already here, then a code from the new one; removing
 * one takes a code from any of them. The last device can't be removed.
 */
export function MfaDevices() {
  const t = useT();
  const intl = useIntlTag();
  const id = useId();
  const [devices, setDevices] = useState<MfaDeviceView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<{ name?: string; code?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let live = true;
    api<MfaDeviceView[]>("/auth/mfa/devices")
      .then((list) => live && setDevices(list))
      .catch((e: unknown) => live && setLoadError(isApiError(e) ? e.message : "Your devices couldn’t be loaded. Refresh the page to try again."));
    return () => {
      live = false;
    };
  }, []);

  function reset() {
    setAdding(null);
    setRemoving(null);
    setName("");
    setCode("");
    setErrors({});
    setShowSecret(false);
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const parsed = AddMfaDeviceInput.safeParse({ name, code: cleaned(code) });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] === "name" ? "name" : "code"] ??= issue.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const setup = await api<MfaDeviceSetup>("/auth/mfa/devices", { method: "POST", body: parsed.data });
      setAdding({ step: "scan", name: parsed.data.name, setup });
      setCode("");
    } catch (e) {
      setErrors(failure(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (adding?.step !== "scan") return;
    const parsed = MfaCodeInput.safeParse({ code: cleaned(code) });
    if (!parsed.success) return setErrors({ code: parsed.error.issues[0]?.message ?? "Enter the 6-digit code" });
    setBusy(true);
    setErrors({});
    try {
      const device = await api<MfaDeviceView>(`/auth/mfa/devices/${adding.setup.deviceId}/confirm`, { method: "POST", body: parsed.data });
      setDevices((current) => [...(current ?? []), device]);
      reset();
      setDone(t("“{name}” was added. A code from any of your devices now works when you sign in.", { name: device.name }));
    } catch (e) {
      setErrors(failure(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent, device: MfaDeviceView) {
    event.preventDefault();
    const parsed = MfaCodeInput.safeParse({ code: cleaned(code) });
    if (!parsed.success) return setErrors({ code: parsed.error.issues[0]?.message ?? "Enter the 6-digit code" });
    setBusy(true);
    setErrors({});
    try {
      setDevices(await api<MfaDeviceView[]>(`/auth/mfa/devices/${device.id}/remove`, { method: "POST", body: parsed.data }));
      reset();
      setDone(t("“{name}” was removed. Its codes no longer work, and your other sessions were signed out.", { name: device.name }));
    } catch (e) {
      setErrors(failure(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <FormAlert tone="error">{loadError}</FormAlert>;
  if (!devices) return <p className="text-sm text-secondary">Loading your devices…</p>;

  const full = devices.length >= MFA_MAX_DEVICES;
  const day = (iso: string) => new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Your devices</h3>
        <span className="text-xs text-secondary">{t("{count} of {max}", { count: devices.length, max: MFA_MAX_DEVICES })}</span>
      </div>
      <div aria-live="polite">{done && <FormAlert tone="success">{done}</FormAlert>}</div>

      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {devices.map((device) => (
          <li key={device.id} className="flex flex-col gap-3 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-ink" dir="auto">
                  {device.name}
                </span>
                <span className="text-xs text-secondary">
                  {t("Added {date}", { date: day(device.addedAt) })}
                  {" · "}
                  {device.lastUsedAt ? t("Last used {when}", { when: relativeTime(intl, t, device.lastUsedAt) }) : t("Not used yet")}
                </span>
              </span>
              {devices.length > 1 && removing !== device.id && (
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    reset();
                    setDone(null);
                    setRemoving(device.id);
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
            {removing === device.id && (
              <form noValidate onSubmit={(event) => void remove(event, device)} className="flex flex-col gap-2">
                {errors.form && <FormAlert tone="error">{errors.form}</FormAlert>}
                <div className="flex flex-wrap items-start gap-2">
                  <CodeField
                    id={`${id}-remove-code`}
                    label={t("Code from any of your devices")}
                    value={code}
                    error={errors.code}
                    onChange={(value) => {
                      setCode(value);
                      setErrors({});
                    }}
                  />
                  <div className="flex gap-2 pt-[26px]">
                    <Button type="submit" variant="secondary" disabled={busy}>
                      {busy ? "Removing…" : "Remove device"}
                    </Button>
                    <Button variant="ghost" onClick={reset} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>

      {devices.length === 1 && !adding && (
        <p className="text-xs text-secondary">Add a second device, such as another phone, so you aren’t locked out if you lose this one.</p>
      )}

      {adding?.step === "start" && (
        <form noValidate onSubmit={(event) => void start(event)} className="flex flex-col gap-3 rounded-lg border border-line p-3">
          {errors.form && <FormAlert tone="error">{errors.form}</FormAlert>}
          <Field id={`${id}-name`} label="Name for the new device" error={errors.name} className="w-[320px] max-w-full">
            <input
              id={`${id}-name`}
              value={name}
              maxLength={MFA_DEVICE_NAME_MAX}
              onChange={(event) => {
                setName(event.target.value);
                setErrors({});
              }}
              placeholder="e.g. Work phone"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy(errors.name && `${id}-name-error`)}
              className={inputClasses(!!errors.name)}
            />
          </Field>
          <div className="flex flex-wrap items-start gap-2">
            <CodeField
              id={`${id}-current-code`}
              label={t("Code from a device you already use")}
              value={code}
              error={errors.code}
              onChange={(value) => {
                setCode(value);
                setErrors({});
              }}
            />
            <div className="flex gap-2 pt-[26px]">
              <Button type="submit" disabled={busy}>
                {busy ? "Checking…" : "Continue"}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      {adding?.step === "scan" && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          {errors.form && <FormAlert tone="error">{errors.form}</FormAlert>}
          <p className="text-sm text-body">{t("Scan this QR code with the authenticator app on “{name}”, then enter the code it shows.", { name: adding.name })}</p>
          {/* Rendered as an image so the SVG can't run anything. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(adding.setup.qrSvg)}`}
            alt="QR code for your authenticator app"
            width={176}
            height={176}
            className="self-start rounded-lg border border-line bg-card p-2"
          />
          <button type="button" className="self-start text-sm font-medium text-primary-light underline" onClick={() => setShowSecret((v) => !v)}>
            {showSecret ? "Hide setup key" : "Can’t scan it? Enter a setup key instead"}
          </button>
          {showSecret && <code className="self-start rounded-md bg-muted px-2 py-1 font-mono text-sm tracking-wider break-all text-ink">{adding.setup.secret}</code>}
          <form noValidate onSubmit={(event) => void confirm(event)} className="flex flex-wrap items-start gap-2">
            <CodeField
              id={`${id}-new-code`}
              label={t("Code from the new device")}
              value={code}
              error={errors.code}
              onChange={(value) => {
                setCode(value);
                setErrors({});
              }}
            />
            <div className="flex gap-2 pt-[26px]">
              <Button type="submit" disabled={busy}>
                {busy ? "Checking…" : "Add device"}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {!adding && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="small"
            disabled={full || busy}
            onClick={() => {
              reset();
              setDone(null);
              setAdding({ step: "start" });
            }}
          >
            Add another device
          </Button>
          {full && <span className="text-xs text-secondary">{t("You have the most devices an account can hold ({max}). Remove one to add another.", { max: MFA_MAX_DEVICES })}</span>}
        </div>
      )}
    </div>
  );
}
