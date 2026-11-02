import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { DirectoryMemberCard } from "@/components/network/directory-member-card";
import { directoryMembers } from "@/lib/mock/network";
import { NetworkBrowser } from "./network-browser";

export const metadata: Metadata = { title: "Network" };

/** Network directory — Figma "Web / Network directory" (node 17:1602). */
export default function NetworkPage() {
  return (
    <PageShell>
      <PageHeader
        title="Network"
        description="Find people by country, sector and skill. Connections see more of each other’s profiles."
        actions={
          <Link href="/network/invite" className={buttonClasses({ variant: "secondary" })}>
            Invite colleagues
          </Link>
        }
      />
      <NetworkBrowser entries={directoryMembers.map((member) => ({ member, card: <DirectoryMemberCard member={member} /> }))} />
    </PageShell>
  );
}
