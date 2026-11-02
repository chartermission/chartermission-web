import type { ReactNode } from "react";
import { TopNav } from "@/components/top-nav";
import { viewer } from "@/lib/mock-data";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopNav viewerName={viewer.name} />
      {children}
    </>
  );
}
