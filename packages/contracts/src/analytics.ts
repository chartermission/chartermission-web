import { z } from "zod";

/*
 * First-party analytics (spec 4.16). The set is fixed and disclosed in the privacy notice:
 * nothing outside this list is collected, there are no third-party trackers, and rows carry
 * only a pseudonymous member id, a country code and (for some events) the id of the thing acted on.
 */
export const AnalyticsEventName = z.enum([
  "account_registered",
  "email_verified",
  "onboarding_completed",
  "post_created",
  "comment_created",
  "report_created",
  "report_resolved",
  "connection_requested",
  "connection_accepted",
  /** An event went live (approved by review, or published directly by staff). Subject: event id. */
  "event_published",
  /** A member registered or joined the waitlist for an internal-registration event. Subject: event id. */
  "event_registered",
  /** A published event was called off by its host or staff. Subject: event id. */
  "event_cancelled",
  /** "Start learning" opened a Charter Center course (CM-LRN-04). Subject: course id. */
  "charter_center_click",
]);
export type AnalyticsEventName = z.infer<typeof AnalyticsEventName>;
