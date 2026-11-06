import Link from "next/link";
import { buttonClasses } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { EmptyState } from "@/components/social/skeletons";

export default function PathNotFound() {
  return (
    <PageShell className="max-sm:px-4">
      <EmptyState
        icon="search"
        title="This learning path isn’t available"
        className="py-16"
        actions={
          <Link href="/learning" className={buttonClasses({ size: "small" })}>
            See all learning paths
          </Link>
        }
      >
        It may have been retired on Charter Center, or none of its courses are listed right now.
      </EmptyState>
    </PageShell>
  );
}
