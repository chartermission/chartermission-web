import { Injectable } from '@nestjs/common';
import { MailService } from '../infra/mail.service.js';
import { adminUrl, webUrl } from '../infra/mail-layout.js';

type To = { email: string; userId: string | null };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Ambassador programme emails: onboarding invitations, certification and manager access. */
@Injectable()
export class AmbassadorMailer {
  constructor(private readonly mail: MailService) {}

  private async send(
    to: To,
    template: string,
    subject: string,
    body: {
      heading: string;
      paragraphs: string[];
      button?: { label: string; url: string };
    },
    footer = 'You received this email because the Charter Mission community team is working with you on the Ambassador programme.',
  ) {
    await this.mail.compose({
      to: to.email,
      userId: to.userId,
      template,
      subject,
      ...body,
      footer,
      transactional: true,
    });
  }

  /** Sent when a lead enters onboarding (and again from "Resend invitation"). */
  onboardingInvite(
    to: To,
    opts: {
      name: string;
      country: string;
      hasAccount: boolean;
      courses: { title: string; url: string }[];
    },
  ) {
    const steps = [
      'Sign the Ambassador Agreement and Code of Conduct on the Ambassador programme page in the app.',
      opts.hasAccount
        ? 'Complete your member profile: photo, short bio and your vision for the chapter.'
        : 'Create your Charter Mission account with this email address, then complete your profile.',
      opts.courses.length
        ? `Complete the training on Charter Center: ${opts.courses.map((c) => c.title).join('; ')}.`
        : 'Complete the Ambassador training we share with you.',
      'Join a 30-minute orientation call with the community team.',
      'Set a date for your first chapter event.',
    ];
    return this.send(
      to,
      'ambassador.onboarding_invite',
      `Welcome to the Charter Mission Ambassador programme`,
      {
        heading: `Congratulations, ${firstName(opts.name)}`,
        paragraphs: [
          `You have been selected to lead the ${opts.country} chapter as a Charter Mission Ambassador. Before your badge goes live, there are a few onboarding steps:`,
          ...steps.map((s, i) => `${i + 1}. ${s}`),
          ...(opts.courses.length
            ? [
                'Course links:',
                ...opts.courses.map((c) => `${c.title}: ${c.url}`),
              ]
            : []),
          'Your community manager will follow up with you. Reply to this email if you have any questions.',
        ],
        button: opts.hasAccount
          ? { label: 'Start onboarding', url: webUrl('/ambassadors') }
          : { label: 'Create your account', url: webUrl('/signup') },
      },
    );
  }

  /** Sent to someone a member nominated (only for new leads; repeat nominations stay silent). */
  nominated(
    to: To,
    opts: {
      name: string;
      nominator: string;
      country: string;
      hasAccount: boolean;
    },
  ) {
    return this.send(
      to,
      'ambassador.nominated',
      `${opts.nominator} nominated you as a Charter Mission Ambassador`,
      {
        heading: `Hello ${firstName(opts.name)}`,
        paragraphs: [
          `${opts.nominator} thinks you would make a great Charter Mission Ambassador for ${opts.country}. Ambassadors lead their country's chapter: welcoming members, hosting events and representing the community.`,
          'If you are interested, apply from the Ambassador programme page. It takes about five minutes. If not, you can ignore this email; we will not contact you again about this nomination.',
        ],
        button: opts.hasAccount
          ? { label: 'Apply to be an Ambassador', url: webUrl('/ambassadors') }
          : { label: 'Join and apply', url: webUrl('/signup') },
      },
      'You received this email because a Charter Mission member nominated you for the Ambassador programme.',
    );
  }

  certified(
    to: To,
    opts: { name: string; country: string; founding: boolean },
  ) {
    const title = opts.founding ? 'Founding Ambassador' : 'Ambassador';
    return this.send(
      to,
      'ambassador.certified',
      `You are now the Charter Mission ${title} for ${opts.country}`,
      {
        heading: `Your ${title} badge is live`,
        paragraphs: [
          `Welcome aboard, ${firstName(opts.name)}. You are now the Charter Mission ${title} for ${opts.country}, and your badge shows on your profile.`,
          'Your community manager will be in touch about the chapter tools and your first event.',
        ],
        button: { label: 'Open Charter Mission', url: webUrl('/feed') },
      },
    );
  }

  /** New staff account: set a password, then sign in to the admin console (MFA set-up follows). */
  managerInvite(
    to: To,
    opts: { name: string; invitedBy: string; token: string },
  ) {
    return this.send(
      to,
      'ambassador.manager_invite',
      'You have been invited to manage Charter Mission Ambassadors',
      {
        heading: `Hello ${firstName(opts.name)}`,
        paragraphs: [
          `${opts.invitedBy} has given you access to the Charter Mission admin console as an Ambassador Manager. You will be able to add ambassador leads, move them through the qualification pipeline and onboard them.`,
          'First, choose a password. This link works once and expires in 60 minutes; ask for a new invitation if it runs out.',
          `Then sign in at ${adminUrl('/signin')}. The first sign-in asks you to set up an authenticator app for two-step verification.`,
        ],
        button: {
          label: 'Choose a password',
          url: webUrl(`/reset-password?token=${opts.token}`),
        },
      },
      'You received this email because a Charter Mission administrator invited you to the admin console.',
    );
  }

  /** Existing account given manager access. */
  managerAdded(to: To, opts: { name: string; invitedBy: string }) {
    return this.send(
      to,
      'ambassador.manager_added',
      'You can now manage Charter Mission Ambassadors',
      {
        heading: `Hello ${firstName(opts.name)}`,
        paragraphs: [
          `${opts.invitedBy} has given your Charter Mission account Ambassador Manager access in the admin console.`,
          'Sign in with your usual email and password. If you haven’t used the admin console before, you will be asked to set up two-step verification.',
        ],
        button: { label: 'Open the admin console', url: adminUrl('/signin') },
      },
      'You received this email because a Charter Mission administrator changed your access.',
    );
  }
}
