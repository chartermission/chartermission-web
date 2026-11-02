import type { ReactNode } from "react";
import { AdminBar } from "@/components/shell/admin-bar";
import { AdminSidebar } from "@/components/shell/admin-sidebar";

/** Admin console shell: admin bar over sidebar + main column (Figma nodes 12:1547 / 12:1569). */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AdminBar />
      <div className="flex flex-1 items-stretch">
        <AdminSidebar />
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-5 px-7 pt-7 pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
