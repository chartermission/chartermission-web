import { Injectable } from '@nestjs/common';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { hashIp } from '../common/crypto.js';

const REDACT = /password|token|secret|mfa|email$|phone|ip$/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

/**
 * Append-only audit log (spec 5.4, CM-ADM-05/09). Never pass raw secrets;
 * keys that look sensitive are redacted anyway.
 */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async record(
    entry: {
      actorId: string | null;
      action: string;
      targetType?: string;
      targetId?: string;
      before?: unknown;
      after?: unknown;
      ip?: string | null;
    },
    tx?: Tx,
  ) {
    await (tx ?? this.db).insert(auditLog).values({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: entry.before === undefined ? null : redact(entry.before),
      after: entry.after === undefined ? null : redact(entry.after),
      ipHash: hashIp(entry.ip),
    });
  }
}
