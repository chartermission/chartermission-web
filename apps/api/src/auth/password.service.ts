import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { flag } from './flags.js';
import { Errors } from '../common/errors.js';
import { isCommonPassword } from './common-passwords.js';

const HIBP_TIMEOUT_MS = 5_000;

/**
 * Password hashing and policy (CM-AUTH-05): at least 12 characters (validated by the
 * contract), Argon2id (the @node-rs/argon2 default algorithm, OWASP parameters), never a
 * common or breached password, never containing the email's local part or the name.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger('Password');
  private dummyHash: string | undefined;

  async onModuleInit() {
    this.dummyHash = await hash('timing-equaliser-not-a-real-password');
  }

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spend the same time as a real verify when the account does not exist (enumeration safety). */
  async dummyVerify(password: string): Promise<void> {
    this.dummyHash ??= await hash('timing-equaliser-not-a-real-password');
    await this.verify(this.dummyHash, password);
  }

  /** Throws 422 with a field error when the password breaks a rule. */
  async assertAcceptable(password: string, ctx: { email: string; name?: string | null }, field = 'password'): Promise<void> {
    const problem = await this.problem(password, ctx);
    if (problem) throw Errors.validation({ [field]: problem });
  }

  async problem(password: string, ctx: { email: string; name?: string | null }): Promise<string | null> {
    if (password.length < 12) return 'Use at least 12 characters';
    const lower = password.toLowerCase();
    const squashed = lower.replace(/[^a-z0-9]/g, '');
    const local = ctx.email.split('@')[0]?.toLowerCase() ?? '';
    const localSquashed = local.replace(/[^a-z0-9]/g, '');
    if ((local.length >= 3 && lower.includes(local)) || (localSquashed.length >= 3 && squashed.includes(localSquashed))) {
      return 'Don’t use your email address in your password';
    }
    if (ctx.name) {
      const parts = ctx.name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length >= 3);
      const full = parts.join('');
      if ((full.length >= 3 && squashed.includes(full)) || parts.some((p) => p.length >= 4 && squashed.includes(p))) {
        return 'Don’t use your name in your password';
      }
    }
    if (isCommonPassword(password)) return 'This password is too common. Choose something harder to guess.';
    if (await this.breached(password)) {
      return 'This password has appeared in a data breach. Choose a different one.';
    }
    return null;
  }

  /**
   * Have I Been Pwned range API (k-anonymity: only the first 5 hex chars of the SHA-1 leave
   * the server). Fails open after 5 seconds or on any error so sign-up never depends on it.
   */
  private async breached(password: string): Promise<boolean> {
    if (!flag('HIBP_ENABLED')) return false;
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'charter-mission-api' },
        signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      });
      if (!res.ok) return false;
      const body = await res.text();
      for (const line of body.split('\n')) {
        const [s, count] = line.trim().split(':');
        if (s === suffix && Number(count) > 0) return true;
      }
      return false;
    } catch (err) {
      this.logger.warn(`HIBP check skipped: ${String(err)}`);
      return false;
    }
  }
}
