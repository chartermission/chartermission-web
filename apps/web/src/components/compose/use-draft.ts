"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftPayload, DraftView, PostView } from "@chartermission/contracts";
import { api } from "@/lib/api/client";

export const AUTOSAVE_DELAY_MS = 1500;

export type DraftStatus = "idle" | "saving" | "saved" | "error";

/**
 * Keeps the composer in sync with a server draft: POST /me/drafts the first time there
 * is content, then PATCH /me/drafts/{id}, debounced. Saves run one at a time, so a
 * PATCH never races the POST that created the draft.
 */
export function useDraftSync({
  draft,
  payload,
  autosave,
  valid,
  onDraftChange,
}: {
  draft?: DraftView;
  payload: DraftPayload;
  /** False while there is nothing to keep, while posting, or while a scheduled post is incomplete. */
  autosave: boolean;
  /** Whether the composer would pass validation; scheduled posts only autosave when it does. */
  valid: boolean;
  onDraftChange?: (draft: DraftView | null) => void;
}) {
  const key = JSON.stringify(payload);
  const [view, setView] = useState<DraftView | null>(draft ?? null);
  const [savedKey, setSavedKey] = useState<string | null>(draft ? key : null);
  const [status, setStatus] = useState<DraftStatus>(draft ? "saved" : "idle");
  const [error, setError] = useState<unknown>(null);

  const latest = useRef({ payload, key, onDraftChange });
  const viewRef = useRef<DraftView | null>(draft ?? null);
  const savedRef = useRef<string | null>(savedKey);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<number | null>(null);
  useEffect(() => {
    latest.current = { payload, key, onDraftChange };
  });

  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  /** Save the latest composer state now; `scheduledFor` schedules (ISO) or unschedules (null). */
  const save = useCallback((extra?: { scheduledFor?: string | null }) => {
    cancelTimer();
    const run = async (): Promise<DraftView> => {
      const { payload: body, key: bodyKey } = latest.current;
      const current = viewRef.current;
      const input: { payload: DraftPayload; scheduledFor?: string | null } = { payload: body };
      if (extra && "scheduledFor" in extra) input.scheduledFor = extra.scheduledFor;
      // Editing a post that failed to publish turns it back into a draft rather than retrying at once.
      else if (current?.status === "failed") input.scheduledFor = null;
      setStatus("saving");
      try {
        const result = current
          ? await api<DraftView>(`/me/drafts/${current.id}`, { method: "PATCH", body: input })
          : await api<DraftView>("/me/drafts", { method: "POST", body: input });
        viewRef.current = result;
        savedRef.current = bodyKey;
        setView(result);
        setSavedKey(bodyKey);
        setStatus("saved");
        setError(null);
        latest.current.onDraftChange?.(result);
        return result;
      } catch (e) {
        setStatus("error");
        setError(e);
        throw e;
      }
    };
    const next = chain.current.then(run, run);
    chain.current = next.catch(() => undefined);
    return next;
  }, []);

  const enabled = autosave && (view?.status !== "scheduled" || valid);
  useEffect(() => {
    if (!enabled || key === savedKey) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      save().catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
    return cancelTimer;
  }, [enabled, key, savedKey, save]);

  /** Wait for saves in flight; save pending changes too when `withChanges`. */
  const flush = useCallback(
    async (withChanges = true): Promise<DraftView | null> => {
      cancelTimer();
      if (withChanges && latest.current.key !== savedRef.current) return save();
      await chain.current;
      return viewRef.current;
    },
    [save],
  );

  /** Publish the draft now (POST /me/drafts/{id}/publish), after saving the latest state. */
  const publish = useCallback(async (): Promise<PostView> => {
    const saved = await flush();
    if (!saved) throw new Error("No draft to publish");
    const post = await api<PostView>(`/me/drafts/${saved.id}/publish`, { method: "POST" });
    viewRef.current = null;
    setView(null);
    latest.current.onDraftChange?.(null);
    return post;
  }, [flush]);

  /** Delete the draft (after any save in flight). */
  const remove = useCallback(async () => {
    cancelTimer();
    await chain.current;
    const current = viewRef.current;
    if (!current) return;
    await api(`/me/drafts/${current.id}`, { method: "DELETE" });
    viewRef.current = null;
    setView(null);
    latest.current.onDraftChange?.(null);
  }, []);

  /** Current draft after pending saves settle, without saving more. */
  const settle = useCallback(() => flush(false), [flush]);

  return { view, status, error, dirty: key !== savedKey, save, flush, settle, publish, remove, cancel: cancelTimer };
}
