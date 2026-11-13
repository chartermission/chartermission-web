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
          <Link href="/learning" className={buttonClasses({ size: "small" })}>
            Go to Learning
          </Link>
        }
      >
        It may have closed, or it wasn’t shared with you. Exams open from the invitation link you were sent; yours are on your Learning page.
      </EmptyState>
    </PageShell>
  );
}
