import type { Metadata } from "next";
import { PrivacySettingsForm } from "@/components/settings/privacy-settings-form";
import { SettingsNav } from "@/components/settings/settings-nav";

export const metadata: Metadata = { title: "Privacy & visibility settings" };

/** Settings — Figma "Web / Settings — privacy & notifications" (node 20:3056, body 20:3109). */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1064px] flex-col items-start gap-8 px-4 pb-12 pt-8 lg:flex-row lg:justify-center">
      <SettingsNav />
      <main id="main" className="flex w-full min-w-0 lg:w-[760px]">
        <PrivacySettingsForm />
      </main>
    </div>
  );
}
