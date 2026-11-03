import type { SessionUser } from "@chartermission/contracts";

/** The signed-in member as client components need it (passed down from the server). */
export type Viewer = Pick<
  SessionUser,
  "id" | "handle" | "name" | "headline" | "avatarUrl" | "tone" | "emailVerified" | "status" | "countryCode" | "permissions" | "restrictions"
>;

export function toViewer(user: SessionUser): Viewer {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    headline: user.headline,
    avatarUrl: user.avatarUrl,
    tone: user.tone,
    emailVerified: user.emailVerified,
    status: user.status,
    countryCode: user.countryCode,
    permissions: user.permissions,
    restrictions: user.restrictions,
  };
}

export const can = (viewer: Viewer | null | undefined, permission: string) => !!viewer?.permissions.includes(permission);

/** Restriction end, if an active restriction applies now. */
export function activeUntil(iso: string | null): string | null {
  return iso && new Date(iso).getTime() > Date.now() ? iso : null;
}
