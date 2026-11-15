import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { AvailabilityView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { AvailabilityEditor } from "@/components/services/availability-editor";
import { SettingsCardSkeleton, SettingsHeader } from "@/components/settings/settings-card";
import { requireClientViewer } from "@/components/social/data";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Availability") };
}

async function Editor() {
  const viewer = await requireClientViewer("/settings/availability");
  const result = await settle(apiGet<AvailabilityView>("/availability", { host: "member" }));
  return (
    <>
      <Panel className="flex flex-col gap-2 p-5">
        <h2 className="text-h3 text-ink">How booking works</h2>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-body">
          <li>These hours apply to every free consultation you offer.</li>
          <li>People see open times in their own time zone, after your notice period and up to how far ahead you allow.</li>
          <li>A time stops being offered as soon as someone books it, and you get a notification.</li>
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
          <Link href={`/${viewer.handle}#services`} className="flex items-center gap-1.5 font-medium text-primary-light hover:underline">
            <Icon name="briefcase" size={16} />
            Manage your services
          </Link>
          <Link href="/bookings?role=host" className="flex items-center gap-1.5 font-medium text-primary-light hover:underline">
            <Icon name="calendar" size={16} />
            See your bookings
          </Link>
        </div>
      </Panel>
      {result.ok ? (
        <AvailabilityEditor host={{ type: "member" }} initial={result.data} />
      ) : (
        <LoadError title="Your availability didn’t load" message={result.error.message} />
      )}
    </>
  );
}

/** When members can be booked for free consultations (GET/PUT /availability?host=member). */
export default function AvailabilitySettingsPage() {
  return (
    <>
      <SettingsHeader title="Availability" description="The hours people can book a free consultation with you." />
      <Suspense
        fallback={
          <>
            <SettingsCardSkeleton rows={2} />
            <SettingsCardSkeleton rows={7} />
          </>
        }
      >
        <Editor />
      </Suspense>
    </>
  );
}
