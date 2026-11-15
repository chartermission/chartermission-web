import Link from "next/link";
import type { ReactNode } from "react";
import type { PageDetail } from "@chartermission/contracts";
import { Chip, Icon, Panel, buttonClasses, type IconName } from "@chartermission/ui";
import { NoTranslate } from "@/i18n/auto";
import { T } from "@/i18n/client";
import { SOCIAL_NETWORKS, TEAM_SIZE_LABELS, displayUrl, telHref, whatsappHref } from "./page-ref";

type AboutPage = Pick<
  PageDetail,
  | "name"
  | "about"
  | "website"
  | "contactEmail"
  | "contactPhone"
  | "whatsapp"
  | "address"
  | "hours"
  | "foundedYear"
  | "teamSize"
  | "sectors"
  | "specialties"
  | "socialLinks"
>;

/** True when the page has anything to show in its About tab. */
export function hasAboutContent(page: AboutPage): boolean {
  return !!(
    page.about ||
    page.website ||
    page.contactEmail ||
    page.contactPhone ||
    page.whatsapp ||
    page.address ||
    page.hours ||
    page.foundedYear ||
    page.teamSize ||
    page.sectors.length ||
    page.specialties.length ||
    SOCIAL_NETWORKS.some(({ key }) => page.socialLinks[key])
  );
}

/** A generic handset glyph (the UI kit has no phone icon). */
function PhoneGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  );
}

function ContactLink({ href, icon, children, external = false }: { href: string; icon: IconName | "phone"; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
      className={buttonClasses({ variant: "secondary", size: "small", className: "max-w-full" })}
    >
      {icon === "phone" ? <PhoneGlyph /> : <Icon name={icon} size={16} className="shrink-0" />}
      <span className="truncate">{children}</span>
    </a>
  );
}

function Fact({ icon, label, children }: { icon: IconName; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 text-secondary" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-secondary">{label}</dt>
        <dd className="text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/**
 * The page's About tab: what it does, how to get in touch (email, phone, WhatsApp, website,
 * social links), its sectors and specialties, and the facts (founded, team size, hours, address).
 */
export function PageAbout({ page, since, canEdit, editHref }: { page: AboutPage; since: string; canEdit: boolean; editHref: string }) {
  const social = SOCIAL_NETWORKS.filter(({ key }) => page.socialLinks[key]);
  const hasContact = !!(page.contactEmail || page.contactPhone || page.whatsapp || page.website || social.length);
  const hasFacts = !!(page.foundedYear || page.teamSize || page.hours || page.address);
  const empty = !hasAboutContent(page);

  return (
    <>
      <Panel className="flex flex-col gap-3 p-5">
        <h2 className="text-h3 text-ink">About</h2>
        {page.about ? (
          <p className="whitespace-pre-line text-md text-body">
            <NoTranslate>{page.about}</NoTranslate>
          </p>
        ) : (
          canEdit && <p className="text-sm text-secondary">Tell members who you are and what you work on.</p>
        )}
        {(page.sectors.length > 0 || page.specialties.length > 0) && (
          <div className="flex flex-col gap-3 pt-1">
            {page.sectors.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium text-secondary">Sectors</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {page.sectors.map((sector) => (
                    <li key={sector.id}>
                      <Chip tone="info">{sector.name}</Chip>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {page.specialties.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium text-secondary">Specialties</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {page.specialties.map((phrase) => (
                    <li key={phrase}>
                      <Chip tone="filter">
                        <NoTranslate>{phrase}</NoTranslate>
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-secondary">
          <T vars={{ date: since }}>{"On Charter Mission since {date}"}</T>
        </p>
        {canEdit && empty && (
          <Link href={editHref} className="w-fit text-sm font-medium text-primary-light hover:underline">
            Add contact details and more
          </Link>
        )}
      </Panel>

      {hasContact && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">Get in touch</h2>
          <ul className="flex flex-wrap gap-2">
            {page.contactEmail && (
              <li className="max-w-full">
                <ContactLink href={`mailto:${page.contactEmail}`} icon="mail">
                  {page.contactEmail}
                </ContactLink>
              </li>
            )}
            {page.contactPhone && (
              <li className="max-w-full">
                <ContactLink href={telHref(page.contactPhone)} icon="phone">
                  <span dir="ltr">{page.contactPhone}</span>
                </ContactLink>
              </li>
            )}
            {page.whatsapp && (
              <li className="max-w-full">
                <ContactLink href={whatsappHref(page.whatsapp)} icon="message" external>
                  WhatsApp
                </ContactLink>
              </li>
            )}
            {page.website && (
              <li className="max-w-full">
                <ContactLink href={page.website} icon="globe" external>
                  {displayUrl(page.website)}
                </ContactLink>
              </li>
            )}
          </ul>
          {social.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-secondary">Elsewhere</h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {social.map(({ key, label }) => (
                  <li key={key}>
                    <a
                      href={page.socialLinks[key]!}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="flex items-center gap-1.5 text-sm font-medium text-primary-light hover:underline"
                    >
                      <Icon name="link" size={16} />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {hasFacts && (
        <Panel className="p-5">
          <h2 className="sr-only">Details</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {page.foundedYear && (
              <Fact icon="flag" label="Founded">
                {page.foundedYear}
              </Fact>
            )}
            {page.teamSize && (
              <Fact icon="users" label="Team size">
                <T>{TEAM_SIZE_LABELS[page.teamSize]}</T>
              </Fact>
            )}
            {page.hours && (
              <Fact icon="clock" label="Opening hours">
                <NoTranslate>{page.hours}</NoTranslate>
              </Fact>
            )}
            {page.address && (
              <Fact icon="map-pin" label="Address">
                <span className="whitespace-pre-line">
                  <NoTranslate>{page.address}</NoTranslate>
                </span>
              </Fact>
            )}
          </dl>
        </Panel>
      )}
    </>
  );
}
