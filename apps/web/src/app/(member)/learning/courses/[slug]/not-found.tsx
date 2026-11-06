import Link from "next/link";
import { buttonClasses } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { EmptyState } from "@/components/social/skeletons";

export default function CourseNotFound() {
  return (
    <PageShell className="max-sm:px-4">
      <EmptyState
        icon="search"
        title="This course isn’t available"
        className="py-16"
        actions={
          <Link href="/learning" className={buttonClasses({ size: "small" })}>
            Browse courses
          </Link>
        }
      >
        It may have been removed from Charter Center or taken off the Learning page. Other courses on the same topic are a search away.
      </EmptyState>
    </PageShell>
  );
}
