import { z } from "zod";
import { InviteRef } from "./invites.js";
import { CountryCode } from "./common.js";

/*
 * Registration, sign-in, verification, password reset, sessions and MFA
 * (spec 4.2 CM-AUTH-01..09, section 8).
 */

export const AccountStatus = z.enum(["unverified", "active", "deactivated", "suspended", "deletion_pending", "deleted"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const PolicyType = z.enum(["terms", "privacy", "guidelines"]);
export type PolicyType = z.infer<typeof PolicyType>;

export const Password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use 128 characters or fewer");

/** POST /auth/register — four fields plus consent to Terms, Privacy Policy and Community Guidelines. */
export const SignUpInput = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: Password,
  country: CountryCode,
  acceptTerms: z.literal(true, { message: "You must accept the terms to continue" }),
  /** The invitation they came through, so the inviter is credited. */
  invite: InviteRef.optional(),
});
export type SignUpInput = z.infer<typeof SignUpInput>;

/** POST /auth/login */
export const SignInInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(128),
  /** "admin" asks for an admin console session (privileged roles, shorter lifetime, MFA). */
  audience: z.enum(["member", "admin"]).default("member"),
});
export type SignInInput = z.infer<typeof SignInInput>;

/**
 * Login result. Member sessions are complete on "ok"; members with two-step verification get "mfa_required".
 * Admin sessions, and staff accounts on either side, return "mfa_required" or "mfa_setup_required" until a TOTP code is verified.
 */
export const SignInResult = z.object({
  status: z.enum(["ok", "mfa_required", "mfa_setup_required"]),
});
export type SignInResult = z.infer<typeof SignInResult>;

/**
 * Single sign-on from the member site into the admin console:
 *   GET  /auth/admin/sso/start?next=   on the member site: redirects to {admin}/sso?code=… for a
 *                                      signed-in team member, else to the console's sign-in form.
 *   POST /auth/admin/sso { code }      from the console: SignInResult (the one-time code lasts 60 seconds).
 */
export const AdminSsoInput = z.object({ code: z.string().min(20).max(200) });
export type AdminSsoInput = z.infer<typeof AdminSsoInput>;

/** POST /auth/verify */
export const VerifyEmailInput = z.object({ token: z.string().min(16).max(200) });
export type VerifyEmailInput = z.infer<typeof VerifyEmailInput>;

/** POST /auth/resend — uses the session if signed in, otherwise the email (identical response either way). */
export const ResendVerificationInput = z.object({ email: z.string().trim().toLowerCase().email().optional() });
export type ResendVerificationInput = z.infer<typeof ResendVerificationInput>;

/** POST /auth/password/forgot */
export const ForgotPasswordInput = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address") });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

/** POST /auth/password/reset */
export const ResetPasswordInput = z.object({ token: z.string().min(16).max(200), password: Password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/** POST /me/password — change while signed in. */
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: Password });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

/*
 * Changing the account's email address.
 *
 *   POST   /me/email           { email, password } → EmailChangeResult
 *       Confirmed accounts: the new address gets a link (24 hours) and the current one a heads-up; the
 *       current address keeps working until the link is opened. Accounts that never confirmed their
 *       address (usually a typo at sign-up) switch straight away and the verification link goes to the
 *       new address.
 *   POST   /me/email/resend    sends the pending link again
 *   DELETE /me/email           cancels a pending change
 *   POST   /auth/email/confirm { token } → Ok (opened from the email; no session needed)
 *   POST   /auth/email/correct { email, password, newEmail } → Ok
 *       From the "check your email" page after sign-up, before signing in: fixes a mistyped address
 *       on an account that hasn't confirmed it yet.
 */
const NewEmail = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const ChangeEmailInput = z.object({ email: NewEmail, password: z.string().min(1, "Enter your password").max(128) });
export type ChangeEmailInput = z.infer<typeof ChangeEmailInput>;
export const EmailChangeResult = z.object({
  /** "pending": waiting for the link sent to `email`; "changed": the address was switched (unconfirmed accounts). */
  status: z.enum(["pending", "changed"]),
  email: z.string(),
});
export type EmailChangeResult = z.infer<typeof EmailChangeResult>;
export const ConfirmEmailChangeInput = z.object({ token: z.string().min(16).max(200) });
export type ConfirmEmailChangeInput = z.infer<typeof ConfirmEmailChangeInput>;
export const CorrectEmailInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(128),
  newEmail: NewEmail,
});
export type CorrectEmailInput = z.infer<typeof CorrectEmailInput>;

/** POST /auth/mfa/setup → secret to show once and an otpauth:// URL for QR codes. */
export const MfaSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string(), qrSvg: z.string() });
export type MfaSetupResponse = z.infer<typeof MfaSetupResponse>;

/** POST /auth/mfa/verify (and /auth/mfa/enable to finish setup) */
export const MfaCodeInput = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
export type MfaCodeInput = z.infer<typeof MfaCodeInput>;

/*
 * Two-step devices. An account with two-step verification on has one or more authenticator apps
 * ("devices"), each with its own secret; a code from any of them signs in. All of these need a
 * session that has already passed two-step verification.
 *
 *  GET  /auth/mfa/devices               MfaDeviceView[] (the confirmed ones, oldest first).
 *  POST /auth/mfa/devices               AddMfaDeviceInput → MfaDeviceSetup. Needs a code from a device already
 *                                       on the account. The new device waits until it is confirmed.
 *  POST /auth/mfa/devices/:id/confirm   MfaCodeInput (a code from the NEW device) → MfaDeviceView.
 *  POST /auth/mfa/devices/:id/remove    MfaCodeInput (a code from any device on the account) → MfaDeviceView[].
 *                                       The last device can't be removed.
 */
export const MFA_MAX_DEVICES = 5;
export const MFA_DEVICE_NAME_MAX = 40;
/** The name the first device gets: setup at sign-in doesn't ask for one. */
export const MFA_DEFAULT_DEVICE_NAME = "Authenticator app";

export const MfaDeviceView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  addedAt: z.string(),
  /** The last time a code from this device was accepted; null if it never has been since it was added. */
  lastUsedAt: z.string().nullable(),
});
export type MfaDeviceView = z.infer<typeof MfaDeviceView>;

export const AddMfaDeviceInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the device a name")
    .max(MFA_DEVICE_NAME_MAX, `Names can be up to ${MFA_DEVICE_NAME_MAX} characters`),
  /** From a device already on the account. */
  code: MfaCodeInput.shape.code,
});
export type AddMfaDeviceInput = z.infer<typeof AddMfaDeviceInput>;

/** The new device's secret, shown once, and the id to confirm it with. */
export const MfaDeviceSetup = MfaSetupResponse.extend({ deviceId: z.string().uuid() });
export type MfaDeviceSetup = z.infer<typeof MfaDeviceSetup>;

export const PolicyVersions = z.object({ terms: z.string(), privacy: z.string(), guidelines: z.string() });
export type PolicyVersions = z.infer<typeof PolicyVersions>;

export const ConsentRecordView = z.object({ policyType: PolicyType, policyVersion: z.string(), acceptedAt: z.string() });
export type ConsentRecordView = z.infer<typeof ConsentRecordView>;

/** GET /me — the signed-in account. 401 UNAUTHENTICATED when there is no session. */
/** Interface languages. Arabic is laid out right to left. */
export const Locale = z.enum(["en", "fr", "ar"]);
export type Locale = z.infer<typeof Locale>;

/** PUT /me/locale */
export const SetLocaleInput = z.object({ locale: Locale });
export type SetLocaleInput = z.infer<typeof SetLocaleInput>;

export const SessionUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  emailVerified: z.boolean(),
  /** A new address waiting for its confirmation link (POST /me/email); the current `email` works until then. */
  pendingEmail: z.string().nullable().optional(),
  status: AccountStatus,
  handle: z.string(),
  name: z.string(),
  headline: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tone: z.enum(["tint", "primary", "accent", "success", "warning", "info"]),
  countryCode: z.string().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  onboarding: z.object({ step: z.number().int(), completed: z.boolean() }),
  /** `required`: staff accounts must use two-step verification in the admin console and the member app. */
  mfa: z.object({ enabled: z.boolean(), verifiedThisSession: z.boolean(), required: z.boolean() }),
  /** True when a policy version changed since the member last accepted (spec 4.2 rules). */
  needsPolicyReaccept: z.boolean(),
  restrictions: z.object({ postingUntil: z.string().nullable(), connectingUntil: z.string().nullable() }),
  sessionAudience: z.enum(["member", "admin"]),
  /** For team members who may open the admin console: its address (single sign-on at {url}/sso). Null for everyone else. */
  adminConsoleUrl: z.string().nullable(),
  /** Interface language the member chose (Settings); null follows the browser. */
  locale: Locale.nullable(),
});
export type SessionUser = z.infer<typeof SessionUser>;

/** POST /me/consents — re-accept the current policy versions. */
export const AcceptPoliciesInput = z.object({ accept: z.literal(true) });
export type AcceptPoliciesInput = z.infer<typeof AcceptPoliciesInput>;

/** POST /me/deactivate and /me/reactivate need the password again. */
export const ConfirmPasswordInput = z.object({ password: z.string().min(1).max(128) });
export type ConfirmPasswordInput = z.infer<typeof ConfirmPasswordInput>;

/** POST /me/deletion-request */
export const DeletionRequestInput = z.object({ password: z.string().min(1).max(128), reason: z.string().max(500).optional() });
export type DeletionRequestInput = z.infer<typeof DeletionRequestInput>;

export const SessionView = z.object({
  id: z.string().uuid(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
});
export type SessionView = z.infer<typeof SessionView>;

/** GET /dev/mailbox?to= — development only (DEV_TOOLS); 404 otherwise. */
export const DevMailboxQuery = z.object({ to: z.string().trim().toLowerCase().email() });
export type DevMailboxQuery = z.infer<typeof DevMailboxQuery>;

export const DevMailboxEntry = z.object({ subject: z.string(), text: z.string().nullable(), createdAt: z.string() });
export type DevMailboxEntry = z.infer<typeof DevMailboxEntry>;

export const DevMailbox = z.object({ items: z.array(DevMailboxEntry) });
export type DevMailbox = z.infer<typeof DevMailbox>;
