import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@chartermission/ui";
import { InitiativeDirectory } from "@/components/initiatives/initiative-directory";
import { toInitiativeSummary } from "@/components/initiatives/initiative-tile";
import { initiativeCountries, initiativeThemes, initiatives } from "@/lib/mock/initiatives";

export const metadata: Metadata = { title: "Initiatives" };

/** Initiatives directory — Figma "Web / Initiatives" (node 17:1868, content 17:1921). */
export default function InitiativesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pb-12 pt-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 text-ink">Initiatives</h1>
          <p className="text-md text-secondary">
            Projects members are running across Africa and the diaspora. Join one, or start your own.
          </p>
        </div>
        <Link href="/initiatives/new" className={buttonClasses({ variant: "accent" })}>
          Start an initiative
        </Link>
      </header>
      <InitiativeDirectory
        initiatives={initiatives.map(toInitiativeSummary)}
        themes={initiativeThemes}
        countries={initiativeCountries}
      />
    </main>
  );
}
