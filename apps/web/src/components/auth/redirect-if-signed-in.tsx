import { redirect } from "next/navigation";
import { getViewer } from "@/lib/api/server";

/**
 * Sends signed-in visitors away from the sign-in and sign-up screens. Render it inside a
 * <Suspense fallback={null}> so the form itself stays in the static shell.
 */
export async function RedirectIfSignedIn({ to = "/feed" }: { to?: string }) {
  const viewer = await getViewer().catch(() => null);
  if (viewer) redirect(to);
  return null;
}
