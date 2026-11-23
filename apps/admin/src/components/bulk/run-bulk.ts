"use client";

import { BULK_MAX, type BulkResult } from "@chartermission/contracts";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import type { Translate } from "@/i18n/translate";

/**
 * Sends a bulk request and reports the outcome in a toast: how many changed and, when some
 * couldn't be, the first reason. Returns the result (null when the whole request failed).
 * `t` is the console's translate function (useT()).
 */
export async function runBulk(
  path: string,
  body: Record<string, unknown>,
  t: Translate,
  done: string,
): Promise<BulkResult | null> {
  try {
    // More than one request takes: send them in turn, BULK_MAX at a time, and add up the outcome.
    const key = Array.isArray(body.ids) ? "ids" : Array.isArray(body.items) ? "items" : null;
    const all = key ? (body[key] as unknown[]) : [];
    const result: BulkResult = { done: [], failed: [] };
    for (let i = 0; i === 0 || i < all.length; i += BULK_MAX) {
      const part = await api<BulkResult>(path, { method: "POST", body: key ? { ...body, [key]: all.slice(i, i + BULK_MAX) } : body });
      result.done.push(...part.done);
      result.failed.push(...part.failed);
      if (!key) break;
    }
    if (result.failed.length === 0) toast(t(done, { count: result.done.length }));
    else
      toast(
        t("{done} changed, {failed} not: {reason}", { done: result.done.length, failed: result.failed.length, reason: result.failed[0]!.error }),
        result.done.length ? "info" : "error",
      );
    return result;
  } catch (e) {
    toast(errorMessage(e), "error");
    return null;
  }
}
