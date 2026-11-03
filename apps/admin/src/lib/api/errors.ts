import type { ErrorCode } from "@chartermission/contracts";

/** An error response from the API: `{ error: { code, message, fields?, retryAfter? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK_ERROR" | "UNKNOWN",
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async from(res: Response): Promise<ApiError> {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; fields?: Record<string, string>; retryAfter?: number };
    } | null;
    const e = body?.error;
    return new ApiError(
      res.status,
      (e?.code as ApiError["code"]) ?? "UNKNOWN",
      e?.message ?? `Request failed (${res.status})`,
      e?.fields,
      e?.retryAfter,
    );
  }
}

export function isApiError(e: unknown, code?: ApiError["code"]): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}
