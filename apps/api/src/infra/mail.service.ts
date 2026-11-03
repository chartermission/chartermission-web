import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { emailOutbox, emailSuppressions } from '../db/schema.js';
import { env, isProd } from '../config/env.js';
import { QueueService } from './queue.service.js';

export interface OutgoingEmail {
  to: string;
  userId?: string | null;
  template: string;
  subject: string;
  text: string;
  html: string;
  /** Transactional mail (verification, reset, security) ignores preferences but not hard suppressions. */
  transactional?: boolean;
  /** List-Unsubscribe URL for non-essential mail (CM-NTF-04). */
  unsubscribeUrl?: string;
}

/**
 * Email through an outbox table and the "email" queue. MAIL_DRIVER=log (dev)
 * prints the message and keeps it for GET /dev/mailbox; MAIL_DRIVER=resend sends it.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('Mail');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    this.queue.process('email', async (name, data: { id: string; unsubscribeUrl?: string }) => {
      if (name === 'send') await this.deliver(data.id, data.unsubscribeUrl);
    });
  }

  async send(mail: OutgoingEmail): Promise<void> {
    const to = mail.to.trim().toLowerCase();
    const [suppressed] = await this.db.select().from(emailSuppressions).where(eq(emailSuppressions.email, to)).limit(1);
    const [row] = await this.db
      .insert(emailOutbox)
      .values({
        userId: mail.userId ?? null,
        toAddress: to,
        template: mail.template,
        subject: mail.subject,
        textBody: mail.text,
        htmlBody: mail.html,
        status: suppressed ? 'suppressed' : 'queued',
      })
      .returning({ id: emailOutbox.id });
    if (!suppressed) await this.queue.add('email', 'send', { id: row!.id, unsubscribeUrl: mail.unsubscribeUrl });
  }

  private async deliver(id: string, unsubscribeUrl?: string) {
    const [mail] = await this.db.select().from(emailOutbox).where(eq(emailOutbox.id, id)).limit(1);
    if (!mail || mail.status !== 'queued') return;
    let providerMessageId: string | null = null;
    if (env().MAIL_DRIVER === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env().MAIL_FROM,
          to: [mail.toAddress],
          subject: mail.subject,
          text: mail.textBody,
          html: mail.htmlBody,
          headers: unsubscribeUrl
            ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        await this.db.update(emailOutbox).set({ error: err.slice(0, 500) }).where(eq(emailOutbox.id, id));
        throw new Error(`Resend ${res.status}`);
      }
      providerMessageId = ((await res.json()) as { id?: string }).id ?? null;
    } else {
      this.logger.log(`[mail:${mail.template}] to ${mail.toAddress}: ${mail.subject}\n${mail.textBody ?? ''}`);
    }
    await this.db
      .update(emailOutbox)
      .set({
        status: 'sent',
        sentAt: new Date(),
        providerMessageId,
        // Links with tokens are not kept once sent (spec 8.3).
        ...(isProd() ? { textBody: null, htmlBody: null } : {}),
      })
      .where(eq(emailOutbox.id, id));
  }
}
