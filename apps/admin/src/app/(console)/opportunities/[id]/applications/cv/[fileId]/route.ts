import { cookies, headers } from "next/headers";
import { API_INTERNAL_URL } from "@/lib/api/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /opportunities/{id}/applications/cv/{fileId} — opens an applicant's CV (an application_cv PDF)
 * in the browser. CVs aren't public: GET /media/{fileId} serves them only to the applicant, the
 * listing's poster and staff with opportunity.manage, and a plain link from the console can't send
 * the admin-audience header, so the console forwards the request with the admin's cookies. PDFs are
 * shown inline (in a new tab) instead of downloaded; storage redirects are passed on.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  if (!UUID.test(fileId)) return new Response("Not found", { status: 404 });
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);
  const forwarded = hdrs.get("x-forwarded-for");
  const res = await fetch(`${API_INTERNAL_URL}/media/${fileId}`, {
    headers: {
      cookie: jar.toString(),
      "x-cm-audience": "admin",
      "user-agent": hdrs.get("user-agent") ?? "chartermission-admin",
      ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
    },
    redirect: "manual",
    cache: "no-store",
  }).catch(() => null);
  if (!res) return new Response("The service is unavailable. Please try again shortly.", { status: 503 });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) return Response.redirect(location, 302);
  if (!res.ok) {
    if (res.status === 401) return Response.redirect(new URL(`/signin?expired=1&next=${encodeURIComponent(`/opportunities/${id}/applications`)}`, request.url), 303);
    return new Response(res.status === 404 ? "This CV isn’t available." : `The CV couldn’t be opened (${res.status}).`, {
      status: res.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const type = res.headers.get("content-type") ?? "application/pdf";
  const disposition = (res.headers.get("content-disposition") ?? 'attachment; filename="CV.pdf"').replace(/^attachment/, type === "application/pdf" ? "inline" : "attachment");
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": type,
      "content-disposition": disposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
