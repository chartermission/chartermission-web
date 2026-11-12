import type { Dict } from "../translate";

// English singular forms for sentences that carry {count}.
export const en: Dict = {
  "Try again in {count} seconds.": { one: "Try again in {count} second.", other: "Try again in {count} seconds." },
  "Try again in {count} minutes.": { one: "Try again in {count} minute.", other: "Try again in {count} minutes." },
  "{count} files · {done} uploaded": { one: "{count} file · {done} uploaded", other: "{count} files · {done} uploaded" },
  "{count} posts are waiting for approval.": { one: "{count} post is waiting for approval.", other: "{count} posts are waiting for approval." },
  "This also takes it off {count} members. To hide it but keep who holds it, turn it off instead.": { one: "This also takes it off {count} member. To hide it but keep who holds it, turn it off instead.", other: "This also takes it off {count} members. To hide it but keep who holds it, turn it off instead." },
  "{count} uploads blocked by scanning": { one: "{count} upload blocked by scanning", other: "{count} uploads blocked by scanning" },
  "{count} previous reports · {actioned} actioned": { one: "{count} previous report · {actioned} actioned", other: "{count} previous reports · {actioned} actioned" },
  "{count} items hidden or removed": { one: "{count} item hidden or removed", other: "{count} items hidden or removed" },
  "{count} attachments": { one: "{count} attachment", other: "{count} attachments" },
  "This deletes the page with its {count} posts and {followers} followers. It can’t be undone. To hide a page and keep its content, suspend it instead.": { one: "This deletes the page with its {count} post and {followers} followers. It can’t be undone. To hide a page and keep its content, suspend it instead.", other: "This deletes the page with its {count} posts and {followers} followers. It can’t be undone. To hide a page and keep its content, suspend it instead." },
  "{count} reports": { one: "{count} report", other: "{count} reports" },
  "Stopped after {reached} of {count} stages": { one: "Stopped after {reached} of {count} stage", other: "Stopped after {reached} of {count} stages" },
  "{count} questions": { one: "{count} question", other: "{count} questions" },
  "{count} members took it · {passed} passed": { one: "{count} member took it · {passed} passed", other: "{count} members took it · {passed} passed" },
  "Members will find it under Exams and can start taking it straight away. It has {count} questions.": { one: "Members will find it under Exams and can start taking it straight away. It has {count} question.", other: "Members will find it under Exams and can start taking it straight away. It has {count} questions." },
  "{count} questions imported.": { one: "{count} question imported.", other: "{count} questions imported." },
  "Import {count} questions": { one: "Import {count} question", other: "Import {count} questions" },
  "{count} questions ready to import from {name}.": { one: "{count} question ready to import from {name}.", other: "{count} questions ready to import from {name}." },
  "{count} rows will be skipped:": { one: "{count} row will be skipped:", other: "{count} rows will be skipped:" },
  "Exam imported with {count} questions. Check it, then publish it.": { one: "Exam imported with {count} question. Check it, then publish it.", other: "Exam imported with {count} questions. Check it, then publish it." },
};
