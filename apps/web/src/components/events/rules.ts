import type { EventDetail } from "@chartermission/contracts";

const EDITABLE = new Set<EventDetail["status"]>(["draft", "changes_requested", "rejected", "unpublished", "published"]);

/** Whether the host may still edit the event (contract: PATCH is refused once cancelled or past, and while in review). */
export const canEditEvent = (event: Pick<EventDetail, "status" | "cancelledAt" | "past">) => EDITABLE.has(event.status) && !event.cancelledAt && !event.past;
