import { Injectable } from '@nestjs/common';
import { MailService } from '../infra/mail.service.js';
import { renderEmail, webUrl } from '../infra/mail-layout.js';

type To = { email: string; userId: string | null };

/** Transactional account emails (CM-NTF-02: always sent; verification, reset, security alerts). */
@Injectable()
export class AuthMailer {
  constructor(private readonly mail: MailService) {}

  private async send(
    to: To,
    template: string,
    subject: string,
    body: { heading: string; paragraphs: string[]; button?: { label: string; url: string } },
  ) {
    const { text, html } = renderEmail({
      ...body,
      footer: 'You received this email because of activity on your Charter Mission account.',
    });
    await this.mail.send({ to: to.email, userId: to.userId, template, subject, text, html, transactional: true });
  }

  verification(to: To, name: string, token: string) {
    return this.send(to, 'auth.verify', 'Confirm your email for Charter Mission', {
      heading: `Welcome, ${name.split(' ')[0]}`,
      paragraphs: [
        'Confirm your email address to start posting, connecting and joining conversations.',
        'This link works once and expires in 24 hours.',
      ],
      button: { label: 'Confirm email', url: webUrl(`/verify-email?token=${token}`) },
    });
  }

  /** Sent instead of a verification email when someone registers with an existing address. */
  alreadyRegistered(to: To) {
    return this.send(to, 'auth.already_registered', 'Someone tried to create an account with your email', {
      heading: 'You already have an account',
      paragraphs: [
        'Someone tried to register on Charter Mission with this email address. If it was you, sign in or reset your password.',
        'If it wasn’t you, you can ignore this email. Your account is unchanged.',
      ],
      button: { label: 'Sign in', url: webUrl('/sign-in') },
    });
  }

  passwordReset(to: To, token: string) {
    return this.send(to, 'auth.reset', 'Reset your Charter Mission password', {
      heading: 'Reset your password',
      paragraphs: [
        'We received a request to reset your password. This link works once and expires in 60 minutes.',
        'If you didn’t ask for this, you can ignore this email.',
      ],
      button: { label: 'Choose a new password', url: webUrl(`/reset-password?token=${token}`) },
    });
  }

  security(to: To, template: string, subject: string, paragraphs: string[]) {
    return this.send(to, `security.${template}`, subject, {
      heading: subject,
      paragraphs: [...paragraphs, 'If this wasn’t you, reset your password now and review your active sessions.'],
      button: { label: 'Review security settings', url: webUrl('/settings/security') },
    });
  }

  newSignIn(to: To, userAgent: string | null, at: Date) {
    return this.security(to, 'new_sign_in', 'New sign-in to your account', [
      `Your Charter Mission account was signed in to on ${at.toUTCString()} from a device we haven’t seen before.`,
      `Device: ${userAgent?.slice(0, 120) || 'unknown browser'}`,
    ]);
  }

  deletionRequested(to: To) {
    return this.send(to, 'account.deletion_requested', 'We received your account deletion request', {
      heading: 'Your deletion request is in the queue',
      paragraphs: [
        'We received a request to delete your Charter Mission account. You have been signed out everywhere.',
        'An administrator will process the request. Your personal data is erased within 30 days of approval.',
        'If you didn’t ask for this, contact support straight away.',
      ],
    });
  }
}
