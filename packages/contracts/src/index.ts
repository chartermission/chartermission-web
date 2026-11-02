import { z } from "zod";

/*
 * Shared contracts for web, admin, API and (later) mobile.
 * Enumerations follow the Charter Mission technical specification.
 */

export const PublishStatus = z.enum([
  "draft",
  "pending_review",
  "changes_requested",
  "published",
  "rejected",
  "unpublished",
  "archived",
]);
export type PublishStatus = z.infer<typeof PublishStatus>;

export const OpportunityType = z.enum([
  "employment",
  "internship",
  "fellowship",
  "scholarship",
  "grant",
  "training",
  "mentorship",
  "volunteering",
  "competition",
  "call_for_proposals",
]);
export type OpportunityType = z.infer<typeof OpportunityType>;

export const RemoteMode = z.enum(["remote", "in_person", "hybrid"]);
export type RemoteMode = z.infer<typeof RemoteMode>;

export const InitiativeStatus = z.enum(["idea", "recruiting", "active", "paused", "completed", "archived"]);
export type InitiativeStatus = z.infer<typeof InitiativeStatus>;

export const EventFormat = z.enum(["online", "in_person", "hybrid"]);
export type EventFormat = z.infer<typeof EventFormat>;

export const ReportStatus = z.enum(["open", "in_review", "actioned", "dismissed", "appealed", "upheld", "overturned"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const FieldVisibility = z.enum(["public", "members", "connections", "only_me"]);
export type FieldVisibility = z.infer<typeof FieldVisibility>;

export const MemberSummary = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  headline: z.string(),
  location: z.string(),
  verified: z.boolean().default(false),
});
export type MemberSummary = z.infer<typeof MemberSummary>;

export const SignUpInput = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(12, "Use at least 12 characters"),
  country: z.string().min(2, "Choose a country"),
  acceptTerms: z.literal(true, { message: "You must accept the terms to continue" }),
});
export type SignUpInput = z.infer<typeof SignUpInput>;

export const HealthResponse = z.object({ status: z.literal("ok"), service: z.string(), time: z.string() });
export type HealthResponse = z.infer<typeof HealthResponse>;
