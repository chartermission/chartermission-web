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

export const HealthResponse = z.object({ status: z.literal("ok"), service: z.string(), time: z.string() });
export type HealthResponse = z.infer<typeof HealthResponse>;
