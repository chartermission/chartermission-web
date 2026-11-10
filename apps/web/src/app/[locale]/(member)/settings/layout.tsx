import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";

/** Settings section layout — Figma "Web / Settings" (node 20:3056): section nav + 760px column. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1064px] flex-col items-start gap-8 px-4 pt-8 pb-12 max-lg:gap-5 max-sm:pt-5 lg:flex-row lg:justify-center">
      <SettingsNav />
      <main id="main" className="flex w-full min-w-0 flex-col gap-5 lg:w-[760px]">
        {children}
      </main>
    </div>
  );
}
