import Link from "next/link";
import type { PostView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { postHref } from "../links";

/** "Answered/Unanswered" status shown above a question's text (the card header already says "Question"). */
export function QuestionLabel({ question }: { question: NonNullable<PostView["question"]> }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-label",
          question.answered ? "bg-success-light text-success" : "bg-muted text-secondary",
        )}
      >
        <Icon name={question.answered ? "check" : "clock"} size={13} />
        {question.answered ? "Answered" : "Unanswered"}
      </span>
    </p>
  );
}

/** Answered questions point to the accepted answer; open ones invite an answer. */
export function QuestionFooterNote({ post, detail }: { post: PostView; detail: boolean }) {
  const question = post.question;
  if (!question) return null;
  const answers = post.counts.comments;
  if (question.answered) {
    return (
      <Link
        href={detail ? "#comments" : `${postHref(post.id)}#comments`}
        className="flex w-full items-center gap-2 rounded-lg border border-success/30 bg-success-light px-3 py-2 text-sm text-ink hover:border-success/60"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-inverse">
          <Icon name="check" size={12} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-medium">Answered</span>
          <span className="text-secondary"> · see best answer</span>
        </span>
        <Icon name="chevron-right" size={16} className="shrink-0 text-secondary" />
      </Link>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-secondary">
      <Icon name="message" size={14} />
      {answers === 0 ? "No answers yet — share what you know." : "No best answer chosen yet"}
    </p>
  );
}
