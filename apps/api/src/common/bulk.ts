import type { BulkResult } from '@chartermission/contracts';
import { AppError } from './errors.js';

/**
 * Runs one change per id, one after another, and reports each outcome (contracts BulkResult). A
 * failing id never stops the rest; its message is the API error's, or a generic one for anything
 * unexpected (which is also logged by the caller's logger when given).
 */
export async function runEach(
  ids: readonly string[],
  change: (id: string) => Promise<unknown>,
  log?: { warn: (message: string) => void },
): Promise<BulkResult> {
  const result: BulkResult = { done: [], failed: [] };
  for (const id of [...new Set(ids)]) {
    try {
      await change(id);
      result.done.push(id);
    } catch (e) {
      if (e instanceof AppError) result.failed.push({ id, error: Object.values(e.fields ?? {})[0] ?? e.message });
      else {
        log?.warn(`bulk change failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
        result.failed.push({ id, error: 'Something went wrong with this one' });
      }
    }
  }
  return result;
}
