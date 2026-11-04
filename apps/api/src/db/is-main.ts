import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when this module is the script being run (`tsx src/db/seed.ts`), including paths with spaces or symlinks. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}
