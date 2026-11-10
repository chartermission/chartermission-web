"use client";

import Link from "next/link";
import { Button, Icon, buttonClasses, type ButtonProps } from "@chartermission/ui";
import type { Viewer } from "@/components/social/viewer";
import { articleBlockedReason } from "./article-blocked";
import { writeArticleHref } from "./write-article";
import { useT, useIntlTag } from "@/i18n/client";


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
  const intl = useIntlTag();
  const t = useT();
  const blocked = articleBlockedReason(intl, t, viewer);
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
