/*
 * Roles and permissions (spec 4.17). Permissions are named strings bundled into
 * roles; the seed writes these to the roles / permissions tables and the
 * session loader reads them back. One policy function, can(), answers checks.
 */

export const PERMISSIONS = {
  'post.create': 'Publish posts',
  'post.announce': 'Publish and pin platform announcements',
  'comment.create': 'Comment and reply',
  'reaction.create': 'React to posts and comments',
  'connection.create': 'Send connection requests',
  'follow.create': 'Follow members, topics and chapters',
  'report.create': 'Report content and members',
  'appeal.create': 'Appeal moderation actions',
  'admin.console': 'Open the admin console',
  'moderation.view': 'View report queues and moderation history',
  'moderation.act': 'Hide, remove, warn, restrict and suspend',
  'appeal.decide': 'Decide appeals',
  'trending.manage': 'Pin and suppress trending topics; edit trending rules',
  'audit.view': 'View the audit log',
  'audit.export': 'Export the audit log as CSV',
  'members.manage': 'Verify members and handle deletion requests',
  'roles.manage': 'Assign roles below Super Admin',
  'settings.manage': 'Change platform settings and policy versions',
  'superadmin.assign': 'Assign Platform Admins and Super Admins',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const MEMBER: Permission[] = [
  'post.create',
  'comment.create',
  'reaction.create',
  'connection.create',
  'follow.create',
  'report.create',
  'appeal.create',
];

const MODERATOR: Permission[] = [
  'admin.console',
  'moderation.view',
  'moderation.act',
  'appeal.decide',
  'trending.manage',
  'audit.view',
];

const PLATFORM_ADMIN: Permission[] = [
  ...MODERATOR,
  'post.announce',
  'audit.export',
  'members.manage',
  'roles.manage',
  'settings.manage',
];

export const ROLES: Record<string, { name: string; requiresMfa: boolean; permissions: Permission[] }> = {
  member: { name: 'Registered Member', requiresMfa: false, permissions: MEMBER },
  moderator: { name: 'Moderator', requiresMfa: true, permissions: MODERATOR },
  platform_admin: { name: 'Platform Admin', requiresMfa: true, permissions: PLATFORM_ADMIN },
  super_admin: {
    name: 'Super Admin',
    requiresMfa: true,
    permissions: [...PLATFORM_ADMIN, 'superadmin.assign'],
  },
};

/** Roles that may open an admin session; all require MFA (CM-AUTH-09). */
export const PRIVILEGED_ROLES = ['moderator', 'platform_admin', 'super_admin'];
