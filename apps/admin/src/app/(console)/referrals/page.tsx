import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminReferrals, MemberRef } from "@chartermission/contracts";
import { Avatar } from "@chartermission/ui";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, NoAccess } from "@/components/states";
import { DateTime } from "@/components/time";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { webHref } from "@/lib/navigation";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Referrals" };

const KIND: Record<AdminReferrals["recent"][number]["kind"], string> = {
  member: "Personal invitation",
  chapter: "Chapter invitation",
  event: "Event invitation",
};

function Person({ member }: { member: MemberRef }) {
  return (
    <a href={webHref(`/${member.handle}`)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 hover:underline">
      <Avatar name={member.name} size={32} src={member.avatarUrl ?? undefined} tone={member.tone} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-ink">{member.name}</span>
        <span className="truncate text-xs text-secondary">@{member.handle}</span>
      </span>
    </a>
  );
}

async function Referrals() {
  const viewer = await requireViewer("/referrals");
  if (!can(viewer, PERM.membersManage)) return <NoAccess section="referrals" />;
  let data: AdminReferrals;
  try {
    data = await apiGet<AdminReferrals>("/admin/referrals");
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "Referrals couldn’t be loaded."} />
      </div>
    );
  }
  if (!data.total) {
    return (
      <div className="rounded-card border border-line bg-card">
        <EmptyState icon="user-plus" title="No one has joined through an invitation yet">
          When someone signs up with a member’s invitation link, it shows here.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section aria-labelledby="leaders-heading" className="flex flex-col rounded-card border border-line bg-card">
        <h2 id="leaders-heading" className="border-b border-line px-5 py-4 text-h3 text-ink">
          Top inviters <span className="text-secondary">· {data.total} joined in all</span>
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-secondary">
              <th className="px-5 py-2 text-start font-medium">Member</th>
              <th className="px-3 py-2 text-end font-medium">Joined</th>
              <th className="px-5 py-2 text-end font-medium">Confirmed email</th>
            </tr>
          </thead>
          <tbody>
            {data.leaders.map((row) => (
              <tr key={row.inviter.id} className="border-t border-line">
                <td className="px-5 py-2.5">
                  <Person member={row.inviter} />
                </td>
                <td className="px-3 py-2.5 text-end font-semibold text-ink">{row.joined}</td>
                <td className="px-5 py-2.5 text-end text-secondary">{row.verified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="recent-heading" className="flex flex-col rounded-card border border-line bg-card">
        <h2 id="recent-heading" className="border-b border-line px-5 py-4 text-h3 text-ink">
          Latest sign-ups through invitations
        </h2>
        <ul>
          {data.recent.map((row) => (
            <li key={row.invitee.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-3 first:border-t-0">
              <div className="min-w-[180px] flex-1">
                <Person member={row.invitee} />
              </div>
              <div className="flex min-w-[180px] flex-1 items-center gap-2 text-xs text-secondary">
                <span>invited by</span>
                <Person member={row.inviter} />
              </div>
              <div className="flex w-[180px] flex-col text-xs text-secondary">
                <span className="text-ink">
                  {KIND[row.kind]}
                  {row.slug ? ` · ${row.slug}` : ""}
                </span>
                <span>
                  <DateTime iso={row.joinedAt} /> · {row.verified ? "email confirmed" : "email not confirmed yet"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Who invited whom: every member who joined through an invitation link. */
export default function ReferralsPage() {
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Members who joined through someone’s invitation link (personal, chapter or event), and who brought the most people."
      />
      <Suspense fallback={<div className="h-[320px] animate-pulse rounded-card border border-line bg-card" />}>
        <Referrals />
      </Suspense>
    </>
  );
}
