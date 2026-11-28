import { z } from "zod";
import { BulkIds } from "./admin-ops.js";
import type { MemberRef, PageRef } from "./common.js";
import { OpportunityType, RemoteMode } from "./listings.js";
import { ApplicationStatus, type ApplicationView, type OpportunityInputParsed } from "./opportunities.js";
import { PageInput } from "./pages.js";

/*
 * Opportunities in the admin console: every listing (members' and imported ones) with staff actions,
 * and the import from pasted text. Staff paste WhatsApp or forum messages, copy a prompt into Claude,
 * and bring back the CSV Claude writes (OPPORTUNITY_CSV_COLUMNS). The console reads the CSV and sends
 * its rows to POST /admin/opportunities/import: first with dryRun to review the normalised values,
 * errors, warnings and possible duplicates, then for real, posting each listing as Charter Mission's
 * official page (the batch default) or, row by row, as an organisation page staff look after, and (by
 * default) sharing it to the feed. The server is the source of truth for normalisation (types by key
 * or label, country names, sector names, dates, apply links).
 *
 * A row without an apply link takes applications in Charter Mission: members apply with the
 * application form, and staff review the applications in the admin console under the listing
 * (GET /admin/opportunities/{id}/applications), with a CSV export.
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

/**
 * Columns the CSV must have (their cells may still be blank in a row, which is then an error).
 * apply_link may be left out or blank: the listing then takes applications in Charter Mission.
 */
export const OPPORTUNITY_CSV_REQUIRED: readonly OpportunityCsvColumn[] = ["type", "title", "organisation", "description"];

/** Most rows one import request may carry. */
export const OPPORTUNITY_IMPORT_MAX_ROWS = 100;

/** Values the CSV's remote_mode column uses (the importer also accepts "in person", "onsite" and the like). */
export const CSV_REMOTE_MODES: Record<RemoteMode, string> = { remote: "remote", in_person: "on_site", hybrid: "hybrid" };

/**
 * One CSV row: its spreadsheet row number (header = row 1) and the cells by column name, and the page
 * to post it as when that isn't the batch's page (an official page, or an active page staff look
 * after: pages.staff_managed).
 */
export const OpportunityImportRow = z.object({
  row: z.number().int().min(1).max(1_000_000),
  values: z.record(z.string().max(60), z.string().max(12_000)),
  pageId: z.string().uuid().nullable().optional(),
});
export type OpportunityImportRow = z.infer<typeof OpportunityImportRow>;

/** POST /admin/opportunities/import (opportunity.manage). */
export const OpportunityImportInput = z.object({
  /** Check only: normalise and validate every row, write nothing. */
  dryRun: z.boolean().default(false),
  /**
   * Post as this page (rows without their own pageId): one of Charter Mission's active official pages.
   * Required unless dryRun. A row posted as an organisation page is shared to the feed from this page,
   * so every member still sees it.
   */
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

/** Where a row's problem is: a CSV column, the row as a whole, or the page it's posted as. */
export type OpportunityImportErrorKey = OpportunityCsvColumn | "row" | "page";

export type OpportunityImportRowResult = {
  row: number;
  /** The normalised listing; null when the row has errors. */
  input: OpportunityImportValues | null;
  /** Problems that stop the row, by CSV column ("row" for the row as a whole, "page" for its Post as). */
  errors: Partial<Record<OpportunityImportErrorKey, string>>;
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
  /** Listings created (empty for a dry run), with the page each is posted as. */
  created: { row: number; id: string; slug: string; title: string; pageId: string }[];
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
  /** Applications not withdrawn. */
  applicationCount: number;
  /** Applications nobody has decided on yet (status submitted). */
  newApplicationCount: number;
  /**
   * Imported listings that take applications in Charter Mission (no applyUrl): staff review their
   * applications in the admin console. Members' own listings are reviewed by their poster.
   */
  reviewedInConsole: boolean;
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

/**
 * GET /admin/opportunities/pages (opportunity.manage): the pages imported listings can be posted as.
 * Charter Mission's active official pages first (the one named "Charter Mission" first, then oldest
 * first: the default), then the active organisation pages staff look after (pages.staff_managed), A–Z.
 * `official` tells the two apart.
 */
export type AdminOpportunityPages = { items: PageRef[] };

/**
 * POST /admin/opportunities/organisations (opportunity.manage) → PageRef: "Create organisation" in
 * the import. A live page with basic details, run by Charter Mission staff (staff_managed, not
 * official), owned by the staff member who creates it. Same rules as the admin console's page form.
 */
export const AdminOrganisationInput = PageInput.pick({
  name: true,
  category: true,
  website: true,
  countryCode: true,
  city: true,
  tagline: true,
  about: true,
  logoFileId: true,
});
export type AdminOrganisationInput = z.infer<typeof AdminOrganisationInput>;

/* ------------------------- Applications (imported listings) ------------------------- */

/**
 * GET /admin/opportunities/{id}/applications (opportunity.manage): applications to an imported
 * listing that takes applications in Charter Mission, newest first. No status: every application
 * except withdrawn ones (like the poster's list on the member site).
 */
export const AdminApplicationsQuery = z.object({
  status: ApplicationStatus.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminApplicationsQuery = z.infer<typeof AdminApplicationsQuery>;

/** GET /admin/opportunities/{id}/applications/export: the same filter, every row, as a CSV download. */
export const AdminApplicationsExportQuery = z.object({ status: ApplicationStatus.optional() });
export type AdminApplicationsExportQuery = z.infer<typeof AdminApplicationsExportQuery>;

/** An application as staff see it: the poster's view plus the applicant's email address. */
/** ApplicationView (which now carries the applicant's email) as the admin console shows it. */
export type AdminApplicationView = ApplicationView;

export type AdminApplicationsPage = {
  items: AdminApplicationView[];
  nextCursor: string | null;
  /** Every application to the listing, by status. */
  counts: Record<ApplicationStatus, number>;
};

/** Columns of the applications CSV export, in order. */
export const ADMIN_APPLICATION_CSV_COLUMNS = [
  "applied_at",
  "status",
  "name",
  "email",
  "phone",
  "headline",
  "country",
  "profile_url",
  "link",
  "cv_url",
  "note",
] as const;

/** GET /admin/opportunities/applications/new-count: undecided applications to imported listings (the sidebar badge). */
export type AdminNewApplicationsCount = { count: number };
