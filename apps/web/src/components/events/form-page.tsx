import "server-only";
import Link from "next/link";
import type { ReactNode } from "react";
import type { EventCategory, EventDetail, EventHostOptions } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { requireViewer, apiGet } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";
import { EmptyState } from "@/components/social/skeletons";
import { EventForm } from "./event-form";

/** Shell for /events/new and /events/[slug]/edit: back link, heading, then the form. */
export function FormShell({ back, title, description, children }: { back: { href: string; label: string }; title: string; description: string; children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-6 pt-6 max-sm:gap-4 max-sm:px-3 max-sm:pt-4">
      <Link href={back.href} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        {back.label}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-ink max-sm:text-h2">{title}</h1>
        <p className="text-md text-secondary">{description}</p>
      </header>
      {children}
    </main>
  );
}

/** Loads what the form needs (host options, categories, countries) and renders it, or explains why the viewer can't host. */
export async function EventFormLoader({ mode, event, next }: { mode: "create" | "edit"; event?: EventDetail; next: string }) {
  const viewer = await requireViewer(next);
  const [hostOptions, categories, taxonomies] = await Promise.all([
    apiGet<EventHostOptions>("/events/host-options"),
    apiGet<EventCategory[]>("/events/categories").catch(() => []),
    getTaxonomies(),
  ]);
  if (mode === "create" && !hostOptions.canHostAsMember && hostOptions.chapters.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        title="Hosting is open to Event Hosts and chapter leads"
        actions={
          <Link href="/events" className={buttonClasses({ variant: "secondary", size: "small" })}>
            Browse events
          </Link>
        }
      >
        To run an event on Charter Mission, ask your chapter lead or the Charter Mission team to make you an Event Host.
      </EmptyState>
    );
  }
  return (
    <EventForm
      mode={mode}
      event={event}
      viewer={{ name: viewer.name, avatarUrl: viewer.avatarUrl, tone: viewer.tone }}
      hostOptions={hostOptions}
      categories={categories}
      countryGroups={groupCountries(taxonomies.countries)}
    />
  );
}
