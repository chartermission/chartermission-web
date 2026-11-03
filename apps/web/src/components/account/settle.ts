import { ApiError, isApiError } from "@/lib/api/errors";

export type Settled<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Await a server read and keep API errors as values, so pages can render an error state without
 * wrapping JSX in try/catch. Non-API errors (bugs, redirects) are rethrown.
 */
export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    if (isApiError(error)) return { ok: false, error };
    throw error;
  }
}
