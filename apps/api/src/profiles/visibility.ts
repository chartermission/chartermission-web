import { sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_FIELD_VISIBILITY,
  type FieldVisibility,
  type ProfileField,
  ProfileField as ProfileFieldEnum,
} from '@chartermission/contracts';
import type { AuthContext } from '../core/auth-context.js';
import { connections, memberProfiles } from '../db/schema.js';

/**
 * The viewer's relationship to a profile (spec 4.3 rules). Every profile response is
 * built from the allow-list for this relationship; nothing else is serialised.
 */
export type ViewerRelation = 'anonymous' | 'member' | 'connection' | 'self' | 'admin';

/** Which field-visibility levels each relationship may see (CM-PRF-02). */
const ALLOWED: Record<ViewerRelation, ReadonlySet<FieldVisibility>> = {
  anonymous: new Set(['public']),
  member: new Set(['public', 'members']),
  connection: new Set(['public', 'members', 'connections']),
  self: new Set(['public', 'members', 'connections', 'only_me']),
  admin: new Set(['public', 'members', 'connections', 'only_me']),
};

const LEVELS = new Set<string>(['public', 'members', 'connections', 'only_me']);

/** Stored map merged over the privacy defaults (spec 8.3: contact details hidden by default). */
export function effectiveVisibility(stored: Record<string, string> | null | undefined): Record<ProfileField, FieldVisibility> {
  const out = { ...DEFAULT_FIELD_VISIBILITY };
  for (const field of ProfileFieldEnum.options) {
    const v = stored?.[field];
    if (v && LEVELS.has(v)) out[field] = v as FieldVisibility;
  }
  return out;
}

export function canSeeField(relation: ViewerRelation, visibility: FieldVisibility): boolean {
  return ALLOWED[relation].has(visibility);
}

/** Admin console viewers: admin-audience, MFA-verified session with moderation access. */
export function isAdminViewer(ctx: AuthContext | undefined): boolean {
  return (
    !!ctx &&
    ctx.session.audience === 'admin' &&
    ctx.session.mfaVerified &&
    ctx.user.permissions.has('moderation.view')
  );
}

/**
 * SQL: true when `field` of the profile row in scope (member_profiles) is visible to a
 * signed-in member viewer. Used inside directory queries so hidden values are never
 * matched (spec 4.3 acceptance, 4.14 rules: permissions applied inside the query).
 */
export function fieldVisibleToMemberSql(field: ProfileField, viewerId: string): SQL {
  const level = sql`coalesce(${memberProfiles.fieldVisibility} ->> ${field}, ${DEFAULT_FIELD_VISIBILITY[field]})`;
  return sql`(
    ${memberProfiles.userId} = ${viewerId}
    or ${level} in ('public', 'members')
    or (${level} = 'connections' and exists (
      select 1 from ${connections} c
      where c.status = 'accepted'
        and ((c.requester_id = ${viewerId} and c.addressee_id = ${memberProfiles.userId})
          or (c.addressee_id = ${viewerId} and c.requester_id = ${memberProfiles.userId}))
    ))
  )`;
}
