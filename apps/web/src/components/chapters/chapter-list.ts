"use client";

import { useEffect, useState } from "react";
import type { ChapterSummary } from "@chartermission/contracts";
import { api } from "@/lib/api/client";

/*
 * Every active chapter (GET /chapters), fetched once per visit and shared by every chapter picker
 * on the site. Joining or leaving a chapter calls forgetChapters() so "Your chapters" stays right.
 */

let cached: Promise<ChapterSummary[]> | null = null;

export function loadChapters(): Promise<ChapterSummary[]> {
  cached ??= api<ChapterSummary[]>("/chapters").catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** Drop the cached list: the next picker to open fetches it again. */
export function forgetChapters() {
  cached = null;
}

/** The chapter list for a picker: null while it loads; `retry` after an error. */
export function useChapterList(): { chapters: ChapterSummary[] | null; error: unknown; retry: () => void } {
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadChapters().then(
      (list) => alive && setChapters(list),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  return {
    chapters,
    error,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}
