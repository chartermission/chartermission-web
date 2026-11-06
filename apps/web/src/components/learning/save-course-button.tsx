"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Icon, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { pop } from "@/components/motion";
import { toast } from "@/components/social/toast";

/*
 * Saved state per course, shared by every button on the page (a featured tile and the same
 * course in the grid stay in step). Starts from the server's CourseSummary.saved.
 */
const saved = new Map<string, boolean>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function setSaved(id: string, value: boolean) {
  saved.set(id, value);
  listeners.forEach((listener) => listener());
}

export function useCourseSaved(id: string, initial: boolean) {
  return useSyncExternalStore(
    subscribe,
    () => saved.get(id) ?? initial,
    () => initial,
  );
}

/**
 * Save / Saved toggle for a course (PUT / DELETE /bookmarks, targetType "course"). Optimistic,
 * with a toast and rollback on error.
 *  - overlay: round icon button on a thumbnail.
 *  - button: secondary button with a label (course page).
 *  - icon: quiet icon button for list rows.
 */
export function SaveCourseButton({
  course,
  variant = "button",
  size = "default",
  className,
}: {
  course: { id: string; title: string; saved: boolean };
  variant?: "overlay" | "button" | "icon";
  size?: "default" | "small";
  className?: string;
}) {
  const isSaved = useCourseSaved(course.id, course.saved);
  const [busy, setBusy] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);

  async function toggle() {
    if (busy) return;
    const next = !isSaved;
    setSaved(course.id, next);
    if (next) pop(iconRef.current, { scale: 1.25, duration: 380 });
    setBusy(true);
    try {
      await api("/bookmarks", { method: next ? "PUT" : "DELETE", body: { targetType: "course", targetId: course.id } });
      toast.success(next ? "Course saved. Find it under Saved on Learning." : "Removed from your saved courses");
    } catch (e) {
      setSaved(course.id, !next);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const icon = (px: number) => (
    <span ref={iconRef} className="flex">
      <Icon name="bookmark" size={px} fill={isSaved ? "currentColor" : "none"} className="transition-[fill] duration-200" />
    </span>
  );

  if (variant === "overlay" || variant === "icon") {
    return (
      <button
        type="button"
        aria-pressed={isSaved}
        aria-label={`Save ${course.title}`}
        title={isSaved ? "Saved" : "Save course"}
        onClick={toggle}
        className={cn(
          "flex size-9 items-center justify-center rounded-full transition-colors",
          variant === "overlay"
            ? cn("bg-card/95 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.12)] backdrop-blur hover:bg-card", isSaved ? "text-primary" : "text-body hover:text-primary")
            : cn("hover:bg-muted", isSaved ? "text-primary" : "text-secondary hover:text-primary"),
          className,
        )}
      >
        {icon(18)}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={isSaved}
      onClick={toggle}
      className={buttonClasses({ variant: "secondary", size, className: cn(isSaved && "text-primary", className) })}
    >
      {icon(size === "small" ? 16 : 18)}
      {isSaved ? "Saved" : "Save"}
      <span className="sr-only"> {course.title}</span>
    </button>
  );
}
