import "server-only";
import { getViewer, requireViewer } from "@/lib/api/server";
import { toViewer, type Viewer } from "./viewer";

/** The signed-in member for client components; redirects to sign in otherwise. */
export async function requireClientViewer(next?: string): Promise<Viewer> {
  return toViewer(await requireViewer(next));
}

export async function getClientViewer(): Promise<Viewer | null> {
  const viewer = await getViewer();
  return viewer ? toViewer(viewer) : null;
}

export type Settled<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** Await without try/catch around JSX (react-hooks/error-boundaries): branch on the result instead. */
export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}
