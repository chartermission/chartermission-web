import { cookies, headers } from "next/headers";
import { API_INTERNAL_URL } from "@/lib/api/server";

/**
 * GET /groups/{id}/members/export?status=&role=&q= — streams GET /admin/groups/{id}/members/export.csv
 * as a download. A plain browser link can't send the admin-audience header the API needs, so the
 * console forwards the request with the admin's cookies. The API checks members.manage or
 * groups.manage and audits the export.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const qs = new URLSearchParams();
  for (const key of ["q", "status", "role"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) qs.set(key, value);
  }
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);
  const forwarded = hdrs.get("x-forwarded-for");
  const res = await fetch(`${API_INTERNAL_URL}/admin/groups/${encodeURIComponent(id)}/members/export.csv${qs.size ? `?${qs}` : ""}`, {
    headers: {
      cookie: jar.toString(),
      accept: "text/csv",
      "x-cm-audience": "admin",
      "user-agent": hdrs.get("user-agent") ?? "chartermission-admin",
      ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
    },
    cache: "no-store",
  }).catch(() => null);
  if (!res) return new Response("The service is unavailable. Please try again shortly.", { status: 503 });
  if (!res.ok) {
    if (res.status === 401) return Response.redirect(new URL(`/signin?expired=1&next=${encodeURIComponent(`/groups/${id}`)}`, url), 303);
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return new Response(body?.error?.message ?? `Export failed (${res.status})`, {
      status: res.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="group-members.csv"',
      "cache-control": "no-store",
    },
  });
}
