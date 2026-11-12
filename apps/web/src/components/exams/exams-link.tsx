import Link from "next/link";
import { Icon } from "@chartermission/ui";

/** A way from Learning into Exams (shown on the Learning page, and on its locked screen: exams have their own access). */
export function ExamsLink() {
  return (
    <Link
      href="/exams"
      className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-card px-5 py-4 transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0px_8px_20px_-8px_rgba(25,37,80,0.25)]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-tint-2 text-primary-light">
        <Icon name="clipboard" size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-md font-semibold text-ink group-hover:text-primary-light">Take an exam</span>
        <span className="text-sm text-secondary">Practice exams and course exams, marked as soon as you finish.</span>
      </span>
      <span className="flex items-center gap-1 text-sm font-medium text-primary-light">
        See exams
        <Icon name="chevron-right" size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none rtl:rotate-180" />
      </span>
    </Link>
  );
}
