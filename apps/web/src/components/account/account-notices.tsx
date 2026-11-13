"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "@/i18n/client";
import { useEffect, useState, type ReactNode } from "react";
import type { SessionUser } from "@chartermission/contracts";
import { Button, Icon, cn, type IconName } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ResendVerification } from "@/components/auth/resend-verification";
import { formatDateTime } from "./format";
import { PasswordConfirmDialog } from "./password-confirm-dialog";

export type AccountNoticeViewer = Pick<
  SessionUser,
  "email" | "emailVerified" | "status" | "restrictions" | "needsPolicyReaccept" | "onboarding" | "mfa"
>;

function Banner({
  tone,
  icon,
  children,
  actions,
}: {
  tone: "warning" | "error" | "info";
  icon: IconName;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const toneClass = {
    warning: "bg-warning-light border-warning/30",
    error: "bg-error-light border-error/30",
    info: "bg-info-light border-info/30",
  }[tone];
  const iconClass = { warning: "text-warning", error: "text-error", info: "text-info" }[tone];
  return (
    <div className={cn("border-b", toneClass)}>
      <div className="mx-auto flex max-w-[1256px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 max-sm:px-4">
        <Icon name={icon} size={18} className={cn("shrink-0", iconClass)} />
        <div className="min-w-0 flex-1 text-sm text-body">{children}</div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const linkClasses = "font-medium text-primary underline underline-offset-2 hover:text-primary-light";

function ReactivateBanner() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Banner
      tone="warning"
      icon="eye-off"
      actions={
        <Button size="small" onClick={() => setOpen(true)}>
          Reactivate account
        </Button>
      }
    >
      <strong className="font-medium text-ink">Your account is deactivated.</strong> Your profile and posts are hidden from other
      members until you reactivate it.
      <PasswordConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reactivate your account?"
        description="Your profile, posts and connections become visible again straight away."
        confirmLabel="Reactivate"
        onConfirm={async (password) => {
          await api("/me/reactivate", { method: "POST", body: { password } });
          setOpen(false);
          router.refresh();
        }}
      />
    </Banner>
  );
}

/** Persistent account banners shown under the top nav (spec 4.2 account states, 4.15 actions). */
export function AccountBanners({ viewer }: { viewer: AccountNoticeViewer }) {
  const banners: ReactNode[] = [];
  if (viewer.status === "deactivated") banners.push(<ReactivateBanner key="deactivated" />);
  if (viewer.status === "suspended") {
    banners.push(
      <Banner key="suspended" tone="error" icon="shield">
        <strong className="font-medium text-ink">Your account is suspended.</strong> You can read your settings and appeal the
        decision.{" "}
        <Link href="/settings/moderation" className={linkClasses}>
          See details and appeal
        </Link>
      </Banner>,
    );
  }
  const { postingUntil, connectingUntil } = viewer.restrictions;
  if (viewer.status !== "suspended" && (postingUntil || connectingUntil)) {
    const parts = [
      postingUntil && `posting until ${formatDateTime(postingUntil)}`,
      connectingUntil && `sending connection requests until ${formatDateTime(connectingUntil)}`,
    ].filter(Boolean);
    banners.push(
      <Banner key="restricted" tone="warning" icon="shield">
        <strong className="font-medium text-ink">Your account is restricted</strong> from {parts.join(" and ")}.{" "}
        <Link href="/settings/moderation" className={linkClasses}>
          See details and appeal
        </Link>
      </Banner>,
    );
  }
  if (!viewer.emailVerified && viewer.status !== "deactivated") {
    banners.push(
      <Banner
        key="verify"
        tone="info"
        icon="mail"
        actions={<ResendVerification size="small" label="Resend email" className="items-end max-sm:items-start" />}
      >
        <strong className="font-medium text-ink">Verify your email to post, comment and connect.</strong> We sent a link to{" "}
        <span className="break-all">{viewer.email}</span>.
      </Banner>,
    );
  }
  if (banners.length === 0) return null;
  return (
    <div aria-label="Account notices" role="region">
      {banners}
    </div>
  );
}

/**
 * Pages that must stay reachable while onboarding is unfinished. Exams too: people who sign up from
 * an exam invitation link go straight to the exam and finish their profile afterwards.
 */
const onboardingExempt = ["/onboarding", "/settings", "/appeals", "/exams"];
/** A member who doesn't accept the new policies can still leave (deactivate, delete, export). */
const policyExempt = ["/settings/data"];

const under = (pathname: string, paths: string[]) => paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Sends members to the step they must finish first: changed policies (any page), then onboarding
 * (except on onboarding, settings, appeals and exams). Client-side so the page shell never waits on it.
 */
export function AccountGate({ viewer }: { viewer: AccountNoticeViewer }) {
  const pathname = usePathname();
  const router = useRouter();
  const canOnboard = viewer.status === "active" || viewer.status === "unverified";
  const mfaPending = viewer.mfa.enabled && !viewer.mfa.verifiedThisSession;
  const mfaSetup = viewer.mfa.required && !viewer.mfa.enabled;
  const target = mfaPending
    ? "/signin/mfa"
    : mfaSetup
      ? "/signin/mfa-setup"
      : viewer.needsPolicyReaccept && !under(pathname, policyExempt)
      ? "/policies/accept"
      : canOnboard && !viewer.onboarding.completed && !under(pathname, onboardingExempt)
        ? "/onboarding"
        : null;

  useEffect(() => {
    if (!target) return;
    if (target === "/policies/accept" || target === "/signin/mfa" || target === "/signin/mfa-setup") {
      const here = pathname + window.location.search;
      router.replace(`${target}?next=${encodeURIComponent(here)}`);
    } else {
      router.replace(target);
    }
  }, [target, pathname, router]);

  if (!target) return null;
  return (
    <div role="status" className="fixed inset-0 top-16 z-20 flex items-start justify-center bg-surface pt-24">
      <p className="text-md text-secondary">
        {target === "/onboarding"
          ? "Taking you to finish setting up your profile…"
          : target === "/signin/mfa"
            ? "Enter your verification code to continue…"
            : target === "/signin/mfa-setup"
              ? "Staff accounts need two-step verification. Taking you to set it up…"
              : "Our policies have changed. Taking you to review them…"}
      </p>
    </div>
  );
}
