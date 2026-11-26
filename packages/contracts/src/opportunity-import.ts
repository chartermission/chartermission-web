import { z } from "zod";
import { BulkIds } from "./admin-ops.js";
import type { MemberRef, PageRef } from "./common.js";
import { OpportunityType, RemoteMode } from "./listings.js";
import type { OpportunityInputParsed } from "./opportunities.js";

/*
 * Opportunities in the admin console: every listing (members' and imported ones) with staff actions,
 * and the import from pasted text. Staff paste WhatsApp or forum messages, copy a prompt into Claude,
 * and bring back the CSV Claude writes (OPPORTUNITY_CSV_COLUMNS). The console reads the CSV and sends
 * its rows to POST /admin/opportunities/import: first with dryRun to review the normalised values,
 * errors, warnings and possible duplicates, then for real, posting each listing as one of Charter
 * Mission's official pages and (by default) sharing it to the feed. The server is the source of truth
 * for normalisation (types by key or label, country names, sector names, dates, apply links).
 */

/** The CSV Claude returns, in this order (the prompt's header line and the importer's columns). */
export const OPPORTUNITY_CSV_COLUMNS = [
  "type",
  "title",
  "organisation",
  "summary",
  "description",
  "remote_mode",
  "country",
  "city",
  "sector",
  "deadline",
  "compensation",
  "apply_link",
  "more_info_url",
] as const;
export type OpportunityCsvColumn = (typeof OPPORTUNITY_CSV_COLUMNS)[number];

/** Columns the CSV must have (their cells may still be blank in a row, which is then an error). */
export const OPPORTUNITY_CSV_REQUIRED: readonly OpportunityCsvColumn[] = ["type", "title", "organisation", "description", "apply_link"];

/** Most rows one import request may carry. */
export const OPPORTUNITY_IMPORT_MAX_ROWS = 100;

/** Values the CSV's remote_mode column uses (the importer also accepts "in person", "onsite" and the like). */
export const CSV_REMOTE_MODES: Record<RemoteMode, string> = { remote: "remote", in_person: "on_site", hybrid: "hybrid" };

/** One CSV row: its spreadsheet row number (header = row 1) and the cells by column name. */
export const OpportunityImportRow = z.object({
  row: z.number().int().min(1).max(1_000_000),
  values: z.record(z.string().max(60), z.string().max(12_000)),
});
export type OpportunityImportRow = z.infer<typeof OpportunityImportRow>;

/** POST /admin/opportunities/import (opportunity.manage). */
export const OpportunityImportInput = z.object({
  /** Check only: normalise and validate every row, write nothing. */
  dryRun: z.boolean().default(false),
  /** Post as this page: one of Charter Mission's active official pages. Required unless dryRun. */
  pageId: z.string().uuid().optional(),
  /** Also share each new listing to the feed as a post from the page (on by default). */
  shareToFeed: z.boolean().default(true),
  rows: z
    .array(OpportunityImportRow)
    .min(1, "Add at least one row")
    .max(OPPORTUNITY_IMPORT_MAX_ROWS, `Import up to ${OPPORTUNITY_IMPORT_MAX_ROWS} opportunities at a time`),
});
export type OpportunityImportInput = z.input<typeof OpportunityImportInput>;

/** An open listing the row looks like (same organisation and title, or the same apply link). */
export type OpportunityImportDuplicate = { id: string; slug: string; title: string; organisation: string };

/** The listing a row would become (OpportunityInput, parsed), without shareToFeed. */
export type OpportunityImportValues = Omit<OpportunityInputParsed, "shareToFeed">;

export type OpportunityImportRowResult = {
  row: number;
  /** The normalised listing; null when the row has errors. */
  input: OpportunityImportValues | null;
  /** Problems that stop the row, by CSV column (or "row" for the row as a whole). */
  errors: Partial<Record<OpportunityCsvColumn | "row", string>>;
  /** Things to check that don't stop the row (no deadline, sector left out, possible duplicate…). */
  warnings: string[];
  /** Open listings this row may repeat. */
  duplicates: OpportunityImportDuplicate[];
  /** An earlier row of the same import with the same opportunity. */
  duplicateOfRow: number | null;
};

export type OpportunityImportResult = {
  /** True when nothing was written. */
  dryRun: boolean;
  rows: OpportunityImportRowResult[];
  /** Listings created (empty for a dry run). */
  created: { row: number; id: string; slug: string; title: string }[];
};

/* ------------------------------ The list ------------------------------ */

/** Where a listing stands for staff: open, closed (by its poster or staff), past its deadline, or taken down. */
export const AdminOpportunityState = z.enum(["open", "closed", "expired", "hidden", "removed"]);
export type AdminOpportunityState = z.infer<typeof AdminOpportunityState>;

/** GET /admin/opportunities (opportunity.manage): newest first, keyset cursor. */
export const AdminOpportunitiesQuery = z.object({
  /** Title or organisation. */
  q: z.string().trim().max(100).optional(),
  type: OpportunityType.optional(),
  /** open: open and not past the deadline; closed: closed or past the deadline; removed: removed or hidden by staff. */
  status: z.enum(["all", "open", "closed", "removed"]).default("all"),
  source: z.enum(["member", "import"]).optional(),
  /** Posted as a page, or by a member as themselves. */
  postedAs: z.enum(["page", "member"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminOpportunitiesQuery = z.infer<typeof AdminOpportunitiesQuery>;

export type AdminOpportunityRow = {
  id: string;
  slug: string;
  type: OpportunityType;
  title: string;
  organisation: string;
  remoteMode: RemoteMode;
  country: { code: string; name: string } | null;
  city: string | null;
  /** The member who posted it (for page listings, the staff member who did); null if the account is gone. */
  poster: MemberRef | null;
  /** Posted as this page. */
  page: PageRef | null;
  source: "member" | "import";
  deadline: string | null;
  /** Applications happen here instead of in Charter Mission (https link or mailto:). */
  applyUrl: string | null;
  applicationCount: number;
  state: AdminOpportunityState;
  createdAt: string;
};

export type AdminOpportunitiesPage = {
  items: AdminOpportunityRow[];
  nextCursor: string | null;
  /** Under the other filters (search, type, source, posted as). */
  counts: { all: number; open: number; closed: number; removed: number };
};

/** POST /admin/opportunities/{id} and /admin/opportunities/bulk (opportunity.manage); every change is audited. */
export const AdminOpportunityActionKind = z.enum(["close", "reopen", "remove", "restore"]);
export type AdminOpportunityActionKind = z.infer<typeof AdminOpportunityActionKind>;

export const AdminOpportunityAction = z.object({ action: AdminOpportunityActionKind });
export type AdminOpportunityAction = z.infer<typeof AdminOpportunityAction>;

/** POST /admin/opportunities/bulk → BulkResult. */
export const AdminOpportunitiesBulkInput = z.object({ ids: BulkIds, action: AdminOpportunityActionKind });
export type AdminOpportunitiesBulkInput = z.infer<typeof AdminOpportunitiesBulkInput>;

/** GET /admin/opportunities/pages (opportunity.manage): the active official pages staff can post as, oldest first. */
export type AdminOpportunityPages = { items: PageRef[] };
