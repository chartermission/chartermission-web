import Link from "next/link";
import { Icon, buttonClasses } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { SectionRail } from "./section-nav";

/** Friendly 404 for posts, profiles and topics. */
export function NotFoundPanel({ title, description, action }: { title: string; description: string; action: { href: string; label: string } }) {
  return (
    <PageColumns left={<SectionRail />}>
      <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
          <Icon name="search" size={26} />
        </span>
        <h1 className="text-h2 text-ink">{title}</h1>
        <p className="max-w-md text-md text-secondary">{description}</p>
        <Link href={action.href} className={buttonClasses({ className: "mt-2" })}>
          {action.label}
        </Link>
      </section>
    </PageColumns>
  );
}
