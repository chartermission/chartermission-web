import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Avatar, Chip, Icon, Panel, type IconName } from "@chartermission/ui";
import type { FieldVisibility } from "@chartermission/contracts";
import { PageColumns } from "@/components/page-columns";
import { SectionRail } from "@/components/social/section-nav";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { memberHandles, members, type ContactField, type MemberProfile } from "@/lib/mock/members";
import { viewer } from "@/lib/mock-data";
import { ConnectButton, ProfileActions } from "./profile-actions";

export function generateStaticParams() {
  return memberHandles.map((handle) => ({ handle }));
}

export async function generateMetadata({ params }: PageProps<"/members/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const member = members[handle];
  return member ? { title: member.name, description: member.headline } : { title: "Member not found" };
}

const contactMeta: Record<ContactField["kind"], { label: string; icon: IconName }> = {
  email: { label: "Email", icon: "mail" },
  website: { label: "Website", icon: "link" },
  phone: { label: "Phone", icon: "at" },
};

const visibilityMeta: Record<FieldVisibility, { label: string; icon: IconName }> = {
  public: { label: "Public", icon: "globe" },
  members: { label: "Visible to members", icon: "users" },
  connections: { label: "Visible to connections", icon: "users" },
  only_me: { label: "Only me", icon: "eye-off" },
};

function ProfileHeader({ member, isViewer }: { member: MemberProfile; isViewer: boolean }) {
  const facts: { icon: IconName; text: string }[] = [
    { icon: "map-pin", text: member.location },
    ...(member.diasporaLink ? [{ icon: "globe" as const, text: `Diaspora link: ${member.diasporaLink}` }] : []),
    { icon: "users", text: `${member.connections} connections` },
  ];
  return (
    <Panel className="flex flex-col overflow-hidden">
      <div className="h-[132px] w-full bg-gradient-to-r from-primary-dark via-primary-light via-65% to-accent" aria-hidden="true" />
      <div className="flex flex-col gap-3 px-6 pb-6">
        <div className="flex items-end justify-between gap-4">
          <Avatar name={member.name} size={96} tone={member.tone} className="border-4 border-card" />
          <ProfileActions name={member.name} isViewer={isViewer} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <h1 className="text-h2 text-ink">{member.name}</h1>
          {member.verified && <Icon name="verified" size={20} className="text-primary-light" label="Verified" />}
          {member.role && <Chip>{member.role}</Chip>}
        </div>
        <p className="text-md text-body">{member.headline}</p>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {facts.map((fact) => (
            <li key={fact.text} className="flex items-center gap-1.5 text-sm text-secondary">
              <Icon name={fact.icon} size={16} />
              {fact.text}
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-2" aria-label="Interests">
          {member.interests.map((interest) => (
            <li key={interest}>
              <Chip>{interest}</Chip>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function ContactCard({ contact }: { contact: ContactField[] }) {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">Contact</h2>
        <p className="text-xs text-secondary">You choose who sees each field</p>
      </div>
      <dl className="flex flex-col gap-3">
        {contact.map((field) => {
          const meta = contactMeta[field.kind];
          const visibility = visibilityMeta[field.visibility];
          return (
            <div key={field.kind} className="flex items-center gap-2.5">
              <dt className="flex flex-1 items-center gap-2.5 text-sm font-medium text-ink">
                <Icon name={meta.icon} size={18} className="text-secondary" />
                {meta.label}
              </dt>
              <dd className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-body">
                <Icon name={visibility.icon} size={14} className="text-secondary" />
                {field.value && field.visibility === "public" ? `${field.value} · ${visibility.label}` : visibility.label}
              </dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}

function RightRail({ member }: { member: MemberProfile }) {
  const alsoViewed = member.alsoViewed.map((handle) => members[handle]).filter(Boolean);
  return (
    <>
      {member.initiatives.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">Initiatives</h2>
          <ul className="flex flex-col gap-3">
            {member.initiatives.map((item) => (
              <li key={item.slug}>
                <Link href={`/initiatives/${item.slug}`} className="group flex flex-col gap-1.5 rounded-[10px] bg-surface p-3 hover:bg-primary-tint-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink group-hover:underline">{item.name}</span>
                    <Chip tone={item.statusTone}>{item.status}</Chip>
                  </span>
                  <span className="text-xs text-secondary">{item.meta}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {member.chapters.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">Chapters</h2>
          <ul className="flex flex-col gap-3">
            {member.chapters.map((chapter) => (
              <li key={chapter.slug}>
                <Link href={`/chapters/${chapter.slug}`} className="group flex items-center gap-2.5">
                  <Icon name="globe" size={20} className="shrink-0 text-primary-light" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-ink group-hover:underline">{chapter.name}</span>
                    <span className="text-xs text-secondary">{chapter.meta}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {alsoViewed.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">People also viewed</h2>
          <ul className="flex flex-col gap-3">
            {alsoViewed.map((person) => (
              <li key={person.handle} className="flex items-center gap-2.5">
                <Avatar name={person.name} size={32} tone={person.tone} />
                <Link href={`/members/${person.handle}`} className="group flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-ink group-hover:underline">{person.name}</span>
                  <span className="text-xs text-secondary">{person.shortHeadline}</span>
                </Link>
                <ConnectButton name={person.name} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

async function ProfileMain({ params }: Pick<PageProps<"/members/[handle]">, "params">) {
  const { handle } = await params;
  const member = members[handle];
  if (!member) notFound();

  return (
    <>
      <ProfileHeader member={member} isViewer={member.handle === viewer.handle} />

      <Panel className="flex flex-col gap-2.5 p-5">
        <h2 className="text-h3 text-ink">About</h2>
        <p className="text-md text-body">{member.about}</p>
      </Panel>

      <Panel className="flex flex-col gap-4 p-5">
        <h2 className="text-h3 text-ink">Experience</h2>
        <ul className="flex flex-col gap-4">
          {member.experience.map((role) => (
            <li key={`${role.title}-${role.organisation}`} className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
                <Icon name="building" size={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-md font-medium text-ink">{role.title}</span>
                <span className="text-sm text-body">{role.organisation}</span>
                <span className="text-xs text-secondary">{role.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <ContactCard contact={member.contact} />
    </>
  );
}

async function ProfileRightRail({ params }: Pick<PageProps<"/members/[handle]">, "params">) {
  const { handle } = await params;
  const member = members[handle];
  return member ? <RightRail member={member} /> : null;
}

/** Member profile — Figma "Web / Member profile" (node 9:860, body 9:913). */
export default function MemberProfilePage({ params }: PageProps<"/members/[handle]">) {
  return (
    <PageColumns
      left={<SectionRail active="/network" />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton lines={4} />}>
            <ProfileRightRail params={params} />
          </Suspense>
        </aside>
      }
    >
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading profile" />
            <PanelSkeleton className="h-[420px]" lines={5} />
            <PanelSkeleton lines={4} />
          </>
        }
      >
        <ProfileMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
