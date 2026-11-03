import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SessionUser } from "@chartermission/contracts";
import { ApiError } from "./errors";

/** Where the Next server reaches the API (internal network address in production). */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000/api/v1";

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}

/**
 * Server-side GET against the API, forwarding the visitor's cookies. Reads the request, so call it
 * from a component inside a <Suspense> boundary (cacheComponents). Mutations go through the
 * browser (lib/api/client.ts) so cookies, CSRF and Origin checks apply.
 */
export async function apiGet<T>(path: string, query?: Query): Promise<T> {
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);
  const forwarded = hdrs.get("x-forwarded-for") ?? undefined;
  const res = await fetch(`${API_INTERNAL_URL}${withQuery(path, query)}`, {
    headers: {
      cookie: jar.toString(),
      accept: "application/json",
      "x-cm-audience": "admin",
      ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
      "user-agent": hdrs.get("user-agent") ?? "chartermission-web",
    },
    cache: "no-store",
  }).catch(() => {
    throw new ApiError(503, "NETWORK_ERROR", "The service is unavailable. Please try again shortly.");
  });
  if (!res.ok) throw await ApiError.from(res);
  return (await res.json()) as T;
}

/** GET that maps 404 to null (e.g. a profile or post that doesn't exist or is hidden). */
export async function apiGetOrNull<T>(path: string, query?: Query): Promise<T | null> {
  try {
    return await apiGet<T>(path, query);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The signed-in admin (admin-audience session), or null. Deduplicated per request. */
export const getViewer = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  if (!jar.has("cm_admin_session")) return null;
  try {
    return await apiGet<SessionUser>("/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});

/**
 * The signed-in admin with MFA verified this session; otherwise redirects to sign in or to the
 * MFA step. Admin routes on the API return 403 until MFA is verified.
 */
export async function requireViewer(next?: string): Promise<SessionUser> {
  const viewer = await getViewer();
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  if (!viewer) redirect(`/signin${q}`);
  if (!viewer.mfa.enabled) redirect(`/signin/mfa-setup${q}`);
  if (!viewer.mfa.verifiedThisSession) redirect(`/signin/mfa${q}`);
  return viewer;
}
