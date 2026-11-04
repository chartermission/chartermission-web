"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * /posts/[id] for an article: replace the URL with the article's reader page, carrying the
 * fragment (#comments, #comment-…) that a server redirect would drop.
 */
export function ArticleRedirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`${href}${window.location.hash}`);
  }, [href, router]);
  return (
    <p role="status" className="rounded-card border border-line bg-card px-5 py-8 text-center text-sm text-secondary">
      Opening the article…{" "}
      <Link href={href} className="font-medium text-primary-light hover:underline">
        Continue
      </Link>
    </p>
  );
}
