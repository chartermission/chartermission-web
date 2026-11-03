import type { Metadata } from "next";
import { Suspense } from "react";
import type { BlockView, MuteView } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { BlockedList, MutedList } from "@/components/settings/blocked-muted";
import { SettingsCardSkeleton, SettingsHeader } from "@/components/settings/settings-card";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Blocked & muted" };

async function Blocks() {
  const result = await settle(apiGet<BlockView[]>("/me/blocks"));
  if (!result.ok) return <LoadError title="Your blocked members didn’t load" message={result.error.message} />;
  return <BlockedList initial={result.data} />;
}

async function Mutes() {
  const result = await settle(apiGet<MuteView[]>("/me/mutes"));
  if (!result.ok) return <LoadError title="Your muted list didn’t load" message={result.error.message} />;
  return <MutedList initial={result.data} />;
}

export default function BlockedSettingsPage() {
  return (
    <>
      <SettingsHeader title="Blocked & muted" description="People and topics you’ve chosen not to see or hear from." />
      <Suspense fallback={<SettingsCardSkeleton rows={2} />}>
        <Blocks />
      </Suspense>
      <Suspense fallback={<SettingsCardSkeleton rows={2} />}>
        <Mutes />
      </Suspense>
    </>
  );
}
