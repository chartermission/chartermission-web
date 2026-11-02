import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@chartermission/ui";
import { ModerationQueue } from "@/components/moderation/moderation-queue";
import { StatCard } from "@/components/moderation/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { moderationStats, queueItems } from "@/lib/mock/moderation";

export const metadata: Metadata = { title: "Moderation" };

/** Moderation queue — Figma "Web / Admin — Moderation queue" (node 12:1546). */
export default function ModerationPage() {
  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports, appeals and hidden content. Every action is written to the audit log."
        actions={
          <Link href="/audit-log?export=csv" className={buttonClasses({ variant: "secondary", size: "small" })}>
            Export audit log
          </Link>
        }
      />
      <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {moderationStats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </dl>
      <ModerationQueue initialItems={queueItems} />
    </>
  );
}
