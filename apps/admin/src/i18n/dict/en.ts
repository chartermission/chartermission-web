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
};
