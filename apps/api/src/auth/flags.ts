import { env } from '../config/env.js';

/**
 * Boolean env flags read defensively: config/env.ts uses z.coerce.boolean(), which turns the
 * string "false" into true. Until that is fixed in core, an explicit "false"/"0"/"off" wins.
 */
export function flag(name: 'DEV_TOOLS' | 'HIBP_ENABLED'): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  if (raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes') return true;
  return env()[name];
}
