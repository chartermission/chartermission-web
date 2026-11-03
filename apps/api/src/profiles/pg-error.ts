/** Postgres error fields, unwrapping drizzle's DrizzleQueryError (the driver error is its `cause`). */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e.code === 'string') return { code: e.code, constraint: e.constraint };
    e = e.cause as typeof e;
  }
  return {};
}

export const isUniqueViolation = (err: unknown, constraint?: string) => {
  const e = pgError(err);
  return e.code === '23505' && (!constraint || e.constraint === constraint);
};
