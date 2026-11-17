import type { ApiError } from '@chartermission/contracts';

/** What a tool sees when the API says no: a message written for Claude to relay or act on. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Calls the Charter Mission API as the signed-in member (their OAuth access token). The API
 * enforces every rule (route allowlist, permissions, hourly limits); this only shapes errors.
 */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    /** Called when the API refuses the token (401), so the caller can forget it and challenge the client. */
    private readonly onUnauthorized?: () => void,
  ) {}

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const url = new URL(this.baseUrl + '/' + path.replace(/^\/+/, ''));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'x-cm-csrf': '1',
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ApiRequestError('Charter Mission could not be reached just now. Try again in a minute.', 503);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (res.status === 401) this.onUnauthorized?.();
    if (!res.ok) throw toApiError(res.status, json, res.headers.get('retry-after'));
    return json as T;
  }
}

/** Turns the API error envelope ({error:{code,message,fields,retryAfter}}) into one clear sentence or two. */
export function toApiError(status: number, json: unknown, retryAfterHeader?: string | null): ApiRequestError {
  const envelope = (json as Partial<ApiError> | undefined)?.error;
  const code = envelope?.code;
  const apiMessage = envelope?.message?.trim();

  if (status === 401) {
    return new ApiRequestError(
      'The Charter Mission sign-in expired. Retry the same request: the connection will be refreshed first.',
      401,
      code,
    );
  }
  if (status === 429) {
    const retryAfter = envelope?.retryAfter ?? (retryAfterHeader ? Number(retryAfterHeader) : undefined);
    const wait = retryAfter && Number.isFinite(retryAfter) ? ` Try again in about ${formatWait(retryAfter)}.` : '';
    return new ApiRequestError(`Limit reached: ${apiMessage || 'too many requests for now.'}${wait} Do not retry right away.`, 429, code);
  }
  if (status === 403) {
    return new ApiRequestError(
      `Not allowed: ${apiMessage || 'Claude cannot do this on Charter Mission for this member.'}`,
      403,
      code,
    );
  }
  if (status === 404) return new ApiRequestError(`Not found: ${apiMessage || 'it may have been deleted or is not visible to this member.'}`, 404, code);

  const fields = envelope?.fields
    ? ' ' + Object.entries(envelope.fields).map(([field, message]) => `${field}: ${message}.`).join(' ')
    : '';
  if (status === 400 || status === 409 || status === 422) {
    return new ApiRequestError(`${apiMessage || 'The request was not accepted.'}${fields}`, status, code);
  }
  if (status >= 500) return new ApiRequestError('Charter Mission had a problem handling this. Try again in a minute.', status, code);
  return new ApiRequestError(`${apiMessage || `Charter Mission answered with status ${status}.`}${fields}`, status, code);
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`;
}
