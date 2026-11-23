import { z } from "zod";

/*
 * Shared shapes for batch operations in the admin console. Every bulk route takes the ids picked
 * in a list (at most BULK_MAX), applies the action to each one on its own and reports what
 * happened per id, so one failure never hides the rest. Every change is written to the audit log.
 */

/** Most rows one bulk request may touch. */
export const BULK_MAX = 500;

export const BulkIds = z.array(z.string().min(1).max(200)).min(1, "Choose at least one").max(BULK_MAX, `Choose up to ${BULK_MAX} at a time`);

/** What a bulk request did: the ids it changed and, for the rest, why not. */
export type BulkResult = {
  done: string[];
  failed: { id: string; error: string }[];
};

/** How a CSV import went: rows created, updated and left alone, and the rows that couldn't be used. */
export type CsvImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  problems: { row: number; message: string }[];
  /** True when nothing was written (a preview: the request asked for dryRun). */
  dryRun: boolean;
};
