import Link from "next/link";
import { buttonClasses } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { EmptyState } from "@/components/social/skeletons";

export default function ExamNotFound() {
  return (
    <PageShell className="max-sm:px-4">
      <EmptyState
        icon="search"
        title="This exam isn’t available"
        className="py-16"
        actions={
          <Link href="/exams" className={buttonClasses({ size: "small" })}>
            See all exams
          </Link>
        }
      >
        It may not be open yet, or it has closed. Check the link, or look at the exams that are open now.
      </EmptyState>
    </PageShell>
  );
}
