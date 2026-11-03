"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { MfaCodeInput, type MfaSetupResponse } from "@chartermission/contracts";
import { Button, Chip } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { PasswordConfirmDialog } from "@/components/account/password-confirm-dialog";
import { Field, FormAlert, describedBy, inputClasses, retryMessage } from "@/components/auth/fields";
import { SettingsCard } from "./settings-card";

type Stage = { kind: "idle" } | { kind: "setup"; data: MfaSetupResponse } | { kind: "done" };

/** Optional TOTP for members (CM-AUTH-09): setup → scan QR → confirm a code; turn off with the password. */
export function MfaCard({ enabled: initiallyEnabled, required }: { enabled: boolean; required: boolean }) {
  const id = useId();
  const router = useRouter();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<MfaSetupResponse>("/auth/mfa/setup", { method: "POST" });
      setStage({ kind: "setup", data });
    } catch (e) {
      setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = MfaCodeInput.safeParse({ code: code.replace(/\s/g, "") });
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message ?? "Enter the 6-digit code");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/mfa/enable", { method: "POST", body: parsed.data });
      setEnabled(true);
      setStage({ kind: "done" });
      setCode("");
      router.refresh();
    } catch (e) {
      if (isApiError(e, "INVALID_MFA_CODE")) setCodeError(e.message);
      else if (isApiError(e, "RATE_LIMITED")) setError(retryMessage(e.retryAfter));
      else setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      id="two-step"
      title="Two-step verification"
      description="Use an authenticator app (such as Google Authenticator or 1Password) for a second sign-in code."
      aside={enabled ? <Chip tone="success">On</Chip> : <Chip tone="neutral">Off</Chip>}
      list={false}
    >
      <div aria-live="polite">
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {stage.kind === "done" && (
          <FormAlert tone="success">
            Two-step verification is on. From now on we’ll ask for a code from your authenticator app each time you sign in, so keep it handy.
          </FormAlert>
        )}
      </div>

      {stage.kind === "setup" ? (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-4 text-sm text-body">
            <li className="flex flex-col gap-2">
              <span>
                <strong className="font-medium text-ink">1.</strong> Scan this QR code with your authenticator app.
              </span>
              {/* Rendered as an image so the SVG can't run anything. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(stage.data.qrSvg)}`}
                alt="QR code for your authenticator app"
                width={176}
                height={176}
                className="rounded-lg border border-line bg-card p-2"
              />
              <button
                type="button"
                className="self-start text-sm font-medium text-primary-light underline"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? "Hide setup key" : "Can’t scan it? Enter a setup key instead"}
              </button>
              {showSecret && (
                <code className="self-start rounded-md bg-muted px-2 py-1 font-mono text-sm tracking-wider break-all text-ink">
                  {stage.data.secret}
                </code>
              )}
            </li>
            <li>
              <strong className="font-medium text-ink">2.</strong> Enter the 6-digit code the app shows.
            </li>
          </ol>
          <form noValidate onSubmit={confirm} className="flex flex-wrap items-start gap-2">
            <Field id={`${id}-code`} label="Authenticator code" error={codeError} className="w-[200px]">
              <input
                id={`${id}-code`}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeError(undefined);
                }}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={describedBy(codeError && `${id}-code-error`)}
                className={inputClasses(!!codeError, "font-mono tracking-[0.3em]")}
              />
            </Field>
            <div className="flex gap-2 pt-[26px]">
              <Button type="submit" disabled={busy}>
                {busy ? "Checking…" : "Turn on"}
              </Button>
              <Button variant="ghost" onClick={() => setStage({ kind: "idle" })} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-body">
            {required
              ? "Your role requires two-step verification, so it can’t be turned off."
              : "You’ll be asked for a code when you sign in to the admin console."}
          </p>
          {!required && (
            <Button variant="secondary" size="small" onClick={() => setDisabling(true)}>
              Turn off
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-body">Optional for members. Required for moderators and admins.</p>
          <Button size="small" onClick={() => void start()} disabled={busy}>
            {busy ? "Starting…" : "Set up"}
          </Button>
        </div>
      )}

      <PasswordConfirmDialog
        open={disabling}
        onClose={() => setDisabling(false)}
        title="Turn off two-step verification?"
        description="You’ll only need your password to sign in."
        confirmLabel="Turn off"
        danger
        onConfirm={async (password) => {
          await api("/auth/mfa/disable", { method: "POST", body: { password } });
          setEnabled(false);
          setDisabling(false);
          setStage({ kind: "idle" });
          router.refresh();
        }}
      />
    </SettingsCard>
  );
}
