import { z } from "zod";
import { BulkIds } from "./admin-ops.js";

/*
 * Profile options: the lists members pick from on their profile (skills, sectors, interests,
 * languages) and hosts pick from for events (event categories). Managed in the admin console under
 * /admin/profile-options/{kind} (settings.manage). Hidden options leave every picker but stay on the
 * profiles and events that already have them. Changes apply straight away.
 */

export const PROFILE_OPTION_KINDS = ["skills", "sectors", "interests", "languages", "event-categories"] as const;
export const ProfileOptionKind = z.enum(PROFILE_OPTION_KINDS);
export type ProfileOptionKind = z.infer<typeof ProfileOptionKind>;

/** active = offered in pickers; hidden = kept where already chosen, no longer offered. */
export const ProfileOptionStatus = z.enum(["active", "hidden"]);
export type ProfileOptionStatus = z.infer<typeof ProfileOptionStatus>;

/** Most rows a list returns (the lists are small; this is a safety cap). */
export const PROFILE_OPTIONS_MAX = 5000;
/** Most rows one import may carry. */
export const PROFILE_OPTIONS_IMPORT_MAX = 2000;
export const PROFILE_OPTION_NAME_MAX = 80;

export const ProfileOptionName = z.string().trim().min(1, "Enter a name").max(PROFILE_OPTION_NAME_MAX, `Use up to ${PROFILE_OPTION_NAME_MAX} characters`);
/** Lower-case letters, numbers and single hyphens ("public-speaking"). */
export const ProfileOptionSlug = z
  .string()
  .trim()
  .toLowerCase()
  .max(PROFILE_OPTION_NAME_MAX)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, numbers and hyphens");

/** GET /admin/profile-options/{kind} */
export const ProfileOptionsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "hidden"]).default("all"),
  /** position = the order members see; usage = most used first. */
  sort: z.enum(["position", "name", "usage"]).default("position"),
});
export type ProfileOptionsQuery = z.infer<typeof ProfileOptionsQuery>;

export type ProfileOptionRow = {
  id: string;
  slug: string;
  name: string;
  position: number;
  status: ProfileOptionStatus;
  /** Members who have it on their profile; for event categories, events that use it. */
  usage: number;
  createdAt: string;
};

export type ProfileOptionCounts = { all: number; active: number; hidden: number };

export type ProfileOptionsList = {
  kind: ProfileOptionKind;
  items: ProfileOptionRow[];
  /** Counts per status for the whole list (not just the rows matching the search). */
  counts: ProfileOptionCounts;
  /** True when more than PROFILE_OPTIONS_MAX rows matched and the rest were left out. */
  truncated: boolean;
};

/** GET /admin/profile-options: counts per kind, for the tabs. */
export type ProfileOptionsSummary = Record<ProfileOptionKind, ProfileOptionCounts>;

/** POST /admin/profile-options/{kind}. The slug is made from the name when not given. */
export const ProfileOptionCreateInput = z.object({
  name: ProfileOptionName,
  slug: ProfileOptionSlug.optional(),
});
export type ProfileOptionCreateInput = z.infer<typeof ProfileOptionCreateInput>;

/** PATCH /admin/profile-options/{kind}/{id} */
export const ProfileOptionUpdateInput = z
  .object({ name: ProfileOptionName, slug: ProfileOptionSlug, status: ProfileOptionStatus })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type ProfileOptionUpdateInput = z.infer<typeof ProfileOptionUpdateInput>;

/** POST /admin/profile-options/{kind}/reorder: the ids in their new order (others keep theirs, after these). */
export const ProfileOptionReorderInput = z.object({
  ids: z.array(z.string().uuid()).min(1, "Choose at least one").max(PROFILE_OPTIONS_MAX),
});
export type ProfileOptionReorderInput = z.infer<typeof ProfileOptionReorderInput>;

/** POST /admin/profile-options/{kind}/{id}/merge: members (or events) move to intoId; this option is deleted. */
export const ProfileOptionMergeInput = z.object({ intoId: z.string().uuid("Choose an option to merge into") });
export type ProfileOptionMergeInput = z.infer<typeof ProfileOptionMergeInput>;

export type ProfileOptionMergeResult = {
  into: ProfileOptionRow;
  /** Links moved to the target; links the member (or page) already had to the target are dropped instead. */
  moved: number;
  dropped: number;
};

/** POST /admin/profile-options/{kind}/bulk → BulkResult. merge: every id into intoId. */
export const ProfileOptionBulkInput = z
  .object({
    ids: BulkIds,
    action: z.enum(["hide", "show", "delete", "merge"]),
    intoId: z.string().uuid().optional(),
  })
  .refine((v) => v.action !== "merge" || !!v.intoId, { message: "Choose an option to merge into", path: ["intoId"] });
export type ProfileOptionBulkInput = z.infer<typeof ProfileOptionBulkInput>;

/**
 * One spreadsheet row. Values are checked by the API row by row (bad rows are reported by `row`,
 * the spreadsheet row number, and skipped), so they are loosely typed here.
 */
export const ProfileOptionImportRow = z.object({
  row: z.number().int().min(1),
  name: z.string().max(1000).default(""),
  slug: z.string().max(200).optional(),
  position: z.union([z.number(), z.string().max(20)]).optional(),
  status: z.string().max(40).optional(),
});
export type ProfileOptionImportRow = z.infer<typeof ProfileOptionImportRow>;

/**
 * POST /admin/profile-options/{kind}/import → CsvImportResult. Rows match existing options by slug,
 * else by name ignoring case. add: only creates the missing ones; upsert: also updates name,
 * position and status.
 */
export const ProfileOptionImportInput = z.object({
  rows: z.array(ProfileOptionImportRow).min(1, "The file has no rows").max(PROFILE_OPTIONS_IMPORT_MAX, `Import up to ${PROFILE_OPTIONS_IMPORT_MAX} rows at a time`),
  mode: z.enum(["add", "upsert"]).default("add"),
  dryRun: z.boolean().default(false),
});
export type ProfileOptionImportInput = z.infer<typeof ProfileOptionImportInput>;
