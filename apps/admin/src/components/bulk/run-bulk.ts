"use client";

import type { BulkResult } from "@chartermission/contracts";
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
    const result = await api<BulkResult>(path, { method: "POST", body });
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
