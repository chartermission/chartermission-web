import {
  OPPORTUNITY_CSV_COLUMNS,
  OPPORTUNITY_CSV_REQUIRED,
  OPPORTUNITY_IMPORT_MAX_ROWS,
  OPPORTUNITY_LIMITS,
  OPPORTUNITY_TYPE_LABELS,
  type OpportunityCsvColumn,
} from "@chartermission/contracts";
import { csvRecords } from "./csv";

/*
 * The import of opportunities from pasted text (WhatsApp groups, forums): the prompt staff copy into
 * Claude, the CSV template, and reading the CSV Claude gives back. The prompt is always English
 * (Claude's instructions, not console text). The API normalises and validates every row again.
 */

/** A CSV row, and the page to post it as when it isn't the batch's default (null: the default). */
export type ImportRecord = { row: number; values: Partial<Record<OpportunityCsvColumn, string>>; pageId?: string | null };

/** Today in the admin's own time zone, YYYY-MM-DD, with the weekday (for resolving "next Friday"). */
export function localToday(now = new Date()): { iso: string; weekday: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    iso: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    weekday: now.toLocaleDateString("en-GB", { weekday: "long" }),
  };
}

export const PROMPT_BEGIN = "<<<BEGIN MESSAGES>>>";
export const PROMPT_END = "<<<END MESSAGES>>>";

/** The full prompt for Claude: the task, the exact CSV header, every column's rules, then the pasted text. */
export function buildPrompt(pasted: string, sectors: readonly string[], today = localToday()): string {
  const types = Object.entries(OPPORTUNITY_TYPE_LABELS)
    .map(([key, label]) => `${key} (${label})`)
    .join(", ");
  const sectorList = sectors.length ? sectors.join("; ") : "(none set up yet: leave sector blank)";
  return [
    "You are helping the Charter Mission team post opportunities on Charter Mission, a professional network for Africa and the diaspora.",
    "",
    "Between the markers at the end are messages pasted from WhatsApp groups and online forums. They may hold one or many opportunities (jobs, internships, fellowships, scholarships, grants, trainings, calls for proposals and the like), mixed with chatter such as greetings, reactions, questions and replies.",
    "",
    "TASK",
    "Extract every distinct opportunity from the messages into a CSV for Charter Mission's importer.",
    "",
    "OUTPUT FORMAT",
    "- Reply with the CSV only, inside a single ```csv code block. Write nothing before or after the code block.",
    "- The first line is exactly this header, in this order:",
    OPPORTUNITY_CSV_COLUMNS.join(","),
    `- Then one line per opportunity, each with all ${OPPORTUNITY_CSV_COLUMNS.length} columns (leave a cell empty rather than dropping it).`,
    '- Quote fields as RFC 4180 says: put double quotes around any field that contains a comma, a line break or a double quote, and write each double quote inside such a field as two double quotes ("").',
    "",
    "COLUMNS",
    `1. type (required): exactly one of these keys (its label is in brackets): ${types}. Use employment for any job, full-time, part-time or contract role.`,
    `2. title (required): the role or programme name, ${5}–${OPPORTUNITY_LIMITS.title} characters, e.g. "Data Analyst" or "Mandela Washington Fellowship 2027", not "We're hiring!".`,
    `3. organisation (required): who offers it, ${2}–${OPPORTUNITY_LIMITS.organisation} characters.`,
    `4. summary (required): one line of at most ${OPPORTUNITY_LIMITS.summary} characters saying what it is and who it is for.`,
    `5. description (required): ${30}–${OPPORTUNITY_LIMITS.description.toLocaleString("en-GB")} characters of clear English with every useful detail from the messages: the role or programme, eligibility, benefits or funding, where it takes place, how to apply, and contacts. Line breaks are fine inside the quoted field. No emojis needed.`,
    "6. remote_mode: remote, on_site or hybrid. Use remote when it can be done from anywhere (most grants, online trainings and remote jobs). Leave it blank if the messages don't say.",
    "7. country: the ISO 3166-1 alpha-2 code of the country where it takes place (e.g. NG, KE, ZA, GH, GB, US). Needed for on_site and hybrid. Leave it blank when it is remote and no single country applies.",
    "8. city: the city, if the messages give one.",
    `9. sector: exactly one of these names, or blank if none fits: ${sectorList}.`,
    `10. deadline: the last day to apply, as YYYY-MM-DD. Today is ${today.weekday}, ${today.iso}: resolve relative dates such as "next Friday" or "end of this month" against today, and give a date written without a year ("15th December") its next occurrence from today. Leave it blank if there is no deadline.`,
    '11. compensation: the salary, stipend or award as written (e.g. "USD 2,000 a month", "Fully funded"), or blank.',
    "12. apply_link (optional): the web link or email address where people apply, exactly as written. Leave it blank when the messages give no web link or email address: people then apply on Charter Mission. Phone and WhatsApp numbers never go in apply_link; put them in the description.",
    "13. more_info_url: a web page with more details, if there is one besides apply_link; otherwise blank.",
    "",
    "RULES",
    "- Don't invent facts. Leave a cell blank when the messages don't say.",
    "- Skip messages that aren't opportunities.",
    "- Merge duplicates: when the same opportunity appears more than once, output it once with the most complete details.",
    "- Translate messages that aren't in English into English.",
    "- Keep links and email addresses exactly as they appear.",
    "",
    "MESSAGES",
    PROMPT_BEGIN,
    pasted.trim(),
    PROMPT_END,
  ].join("\n");
}

/** Header and one example row, for the downloadable template. */
export function templateRows(today = localToday()): string[][] {
  const deadline = new Date(`${today.iso}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + 30);
  const example: Record<OpportunityCsvColumn, string> = {
    type: "employment",
    title: "Data Analyst, Mobile Money",
    organisation: "Savanna Pay",
    summary: "Turn payments data into decisions for a fast-growing mobile wallet in Nairobi.",
    description:
      "Savanna Pay is hiring a data analyst to build dashboards, run experiments and work with product teams.\nRequirements: 2+ years of SQL and a degree in a quantitative field.\nBenefits: medical cover and a learning budget.\nTo apply, send your CV to careers@savannapay.example.",
    remote_mode: "on_site",
    country: "KE",
    city: "Nairobi",
    sector: "Finance & fintech",
    deadline: deadline.toISOString().slice(0, 10),
    compensation: "KES 250,000 a month",
    apply_link: "careers@savannapay.example",
    more_info_url: "https://savannapay.example/careers/data-analyst",
  };
  // A second row without an apply link: members apply on Charter Mission and staff review them in the console.
  const inApp: Record<OpportunityCsvColumn, string> = {
    type: "fellowship",
    title: "Young Leaders Policy Fellowship 2027",
    organisation: "Baobab Institute",
    summary: "A year of mentoring and research support for early-career policy researchers.",
    description:
      "The Baobab Institute is taking applications for a one-year fellowship for researchers under 30 working on trade and regional integration.\nFellows get a monthly stipend, a mentor and two policy workshops.\nQuestions: WhatsApp +233 20 000 0000.",
    remote_mode: "remote",
    country: "",
    city: "",
    sector: "",
    deadline: deadline.toISOString().slice(0, 10),
    compensation: "Monthly stipend",
    apply_link: "",
    more_info_url: "",
  };
  return [[...OPPORTUNITY_CSV_COLUMNS], OPPORTUNITY_CSV_COLUMNS.map((c) => example[c]), OPPORTUNITY_CSV_COLUMNS.map((c) => inApp[c])];
}

/** The CSV inside Claude's reply: the ```csv fence's contents, or the text from the header line on. */
export function extractCsv(text: string): string {
  const fenced = /```[ \t]*(?:csv)?[ \t]*\r?\n([\s\S]*?)```/i.exec(text);
  if (fenced) return fenced[1]!.trim();
  const source = text.replace(/^﻿/, "");
  const header = /^[ \t]*"?type"?[ \t]*[,;\t]/im.exec(source);
  return (header ? source.slice(header.index) : source).trim();
}

export type ReadCsvResult = { ok: true; records: ImportRecord[]; ignored: string[] } | { ok: false; error: string; vars?: Record<string, string | number> };

/** Reads the CSV (pasted or from a file): columns matched loosely, required ones checked. */
export function readImportCsv(text: string): ReadCsvResult {
  const csv = extractCsv(text);
  if (!csv) return { ok: false, error: "Paste the CSV Claude gave you, or choose the file." };
  let parsed: ReturnType<typeof csvRecords>;
  try {
    parsed = csvRecords(csv);
  } catch {
    return { ok: false, error: "That CSV couldn’t be read. Copy Claude’s whole code block and try again." };
  }
  const header = parsed.header;
  const missing = OPPORTUNITY_CSV_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length === OPPORTUNITY_CSV_REQUIRED.length) {
    return { ok: false, error: "The first line must be the header Claude was asked for, starting with type,title,organisation." };
  }
  if (missing.length) return { ok: false, error: "The CSV is missing these columns: {columns}.", vars: { columns: missing.join(", ") } };
  const records = parsed.records
    .map((r) => {
      const values: ImportRecord["values"] = {};
      for (const c of OPPORTUNITY_CSV_COLUMNS) if (r.values[c] !== undefined) values[c] = r.values[c];
      return { row: r.row, values };
    })
    .filter((r) => Object.values(r.values).some((v) => v && v.trim()));
  if (!records.length) return { ok: false, error: "The CSV has no rows under the header." };
  if (records.length > OPPORTUNITY_IMPORT_MAX_ROWS) {
    return { ok: false, error: "The CSV has {count} rows. Import up to {max} at a time: split the messages and run them in parts.", vars: { count: records.length, max: OPPORTUNITY_IMPORT_MAX_ROWS } };
  }
  const known = new Set<string>(OPPORTUNITY_CSV_COLUMNS);
  return { ok: true, records, ignored: header.filter((h) => h && !known.has(h)) };
}

/** "acme.org" for a link, the address for an email (what the review shows of an apply link). */
export function applyHost(url: string | null): string {
  if (!url) return "";
  if (url.startsWith("mailto:")) return url.slice(7);
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
