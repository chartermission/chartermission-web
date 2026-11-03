import { z } from "zod";
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
 * Login result. Member sessions are complete on "ok".
 * Admin sessions return "mfa_required" or "mfa_setup_required" until a TOTP code is verified.
 */
export const SignInResult = z.object({
  status: z.enum(["ok", "mfa_required", "mfa_setup_required"]),
});
export type SignInResult = z.infer<typeof SignInResult>;

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

/** POST /auth/mfa/setup → secret to show once and an otpauth:// URL for QR codes. */
export const MfaSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string(), qrSvg: z.string() });
export type MfaSetupResponse = z.infer<typeof MfaSetupResponse>;

/** POST /auth/mfa/verify (and /auth/mfa/enable to finish setup) */
export const MfaCodeInput = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
export type MfaCodeInput = z.infer<typeof MfaCodeInput>;

export const PolicyVersions = z.object({ terms: z.string(), privacy: z.string(), guidelines: z.string() });
export type PolicyVersions = z.infer<typeof PolicyVersions>;

export const ConsentRecordView = z.object({ policyType: PolicyType, policyVersion: z.string(), acceptedAt: z.string() });
export type ConsentRecordView = z.infer<typeof ConsentRecordView>;

/** GET /me — the signed-in account. 401 UNAUTHENTICATED when there is no session. */
export const SessionUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  emailVerified: z.boolean(),
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
  mfa: z.object({ enabled: z.boolean(), verifiedThisSession: z.boolean() }),
  /** True when a policy version changed since the member last accepted (spec 4.2 rules). */
  needsPolicyReaccept: z.boolean(),
  restrictions: z.object({ postingUntil: z.string().nullable(), connectingUntil: z.string().nullable() }),
  sessionAudience: z.enum(["member", "admin"]),
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
