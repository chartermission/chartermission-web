import Link from "next/link";
import { Button, Icon, buttonClasses, type ButtonProps } from "@chartermission/ui";
import { absoluteDateTime } from "@/components/social/format";
import { activeUntil, type Viewer } from "@/components/social/viewer";
import { writeArticleHref } from "./write-article";

/** Why the viewer can't publish right now, if anything. */
export function articleBlockedReason(viewer: Viewer): string | null {
  if (!viewer.emailVerified) return "Verify your email address to publish articles.";
  if (viewer.status === "suspended") return "Your account is suspended, so you can’t publish.";
  const until = activeUntil(viewer.restrictions.postingUntil);
  return until ? `You can’t post until ${absoluteDateTime(until)}.` : null;
}

/** "Write an article": opens the writing page (/articles/new). Disabled, with the reason, when the viewer can't publish. */
export function WriteArticleButton({
  viewer,
  label = "Write an article",
  variant = "primary",
  size = "default",
}: {
  viewer: Viewer;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const blocked = articleBlockedReason(viewer);
  const content = (
    <>
      <Icon name="plus" size={size === "small" ? 16 : 18} />
      {label}
    </>
  );
  if (blocked) {
    return (
      <Button variant={variant} size={size} disabled title={blocked}>
        {content}
        <span className="sr-only"> ({blocked})</span>
      </Button>
    );
  }
  return (
    <Link href={writeArticleHref()} className={buttonClasses({ variant, size })}>
      {content}
    </Link>
  );
}
