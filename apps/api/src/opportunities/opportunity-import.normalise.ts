import {
  OPPORTUNITY_CSV_COLUMNS,
  OPPORTUNITY_LIMITS,
  OPPORTUNITY_TYPE_LABELS,
  OpportunityInput,
  OpportunityType,
  normalizeApplyUrl,
  type OpportunityCsvColumn,
  type OpportunityImportRowResult,
  type OpportunityImportValues,
  type RemoteMode,
} from '@chartermission/contracts';

/*
 * Turns one CSV row (as Claude writes it from pasted WhatsApp or forum messages) into an opportunity
 * listing: types by key or label, work modes in everyday words, countries by code or name, sectors by
 * name or slug, dates as YYYY-MM-DD (an ISO date-time is cut to its date), apply links as an https link
 * or an email address (or none: applications then happen in Charter Mission). Errors are keyed by CSV
 * column; warnings never stop a row.
 */

export type ImportReference = {
  countries: { code: string; name: string }[];
  /** Active sectors only. */
  sectors: { id: string; slug: string; name: string }[];
  /** Today's date (UTC), YYYY-MM-DD. */
  today: string;
  /** The latest deadline allowed (today + 366 days). */
  latestDeadline: string;
};

type Normalised = Pick<OpportunityImportRowResult, 'input' | 'errors' | 'warnings'>;

/** Header names compared loosely: "Apply Link", "apply-link" and "apply_link" are one column. */
export const columnKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Lowercase, accents dropped, punctuation turned to single spaces: "Côte d’Ivoire" → "cote d ivoire". */
const fold = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Everyday words for each type (folded); keys and labels are matched too. */
const TYPE_WORDS: Record<string, OpportunityType> = {
  job: 'employment',
  jobs: 'employment',
  employment: 'employment',
  vacancy: 'employment',
  vacancies: 'employment',
  role: 'employment',
  position: 'employment',
  hiring: 'employment',
  'full time': 'employment',
  'part time': 'employment',
  contract: 'employment',
  consultancy: 'employment',
  internships: 'internship',
  'graduate trainee': 'internship',
  attachment: 'internship',
  fellowships: 'fellowship',
  scholarships: 'scholarship',
  bursary: 'scholarship',
  bursaries: 'scholarship',
  grants: 'grant',
  funding: 'grant',
  'seed funding': 'grant',
  trainings: 'training',
  course: 'training',
  courses: 'training',
  workshop: 'training',
  bootcamp: 'training',
  masterclass: 'training',
  mentoring: 'mentorship',
  mentor: 'mentorship',
  mentorships: 'mentorship',
  volunteer: 'volunteering',
  volunteers: 'volunteering',
  competitions: 'competition',
  contest: 'competition',
  challenge: 'competition',
  hackathon: 'competition',
  award: 'competition',
  awards: 'competition',
  prize: 'competition',
  'call for proposals': 'call_for_proposals',
  'calls for proposals': 'call_for_proposals',
  'call for proposal': 'call_for_proposals',
  'request for proposals': 'call_for_proposals',
  rfp: 'call_for_proposals',
  cfp: 'call_for_proposals',
  tender: 'call_for_proposals',
};

export function parseType(raw: string): OpportunityType | null {
  const v = fold(raw);
  if (!v) return null;
  const key = v.replace(/ /g, '_');
  if (OpportunityType.safeParse(key).success) return key as OpportunityType;
  for (const [type, label] of Object.entries(OPPORTUNITY_TYPE_LABELS)) if (fold(label) === v) return type as OpportunityType;
  return TYPE_WORDS[v] ?? null;
}

const REMOTE_WORDS: Record<string, RemoteMode> = {
  remote: 'remote',
  'fully remote': 'remote',
  online: 'remote',
  virtual: 'remote',
  'work from home': 'remote',
  wfh: 'remote',
  'on site': 'in_person',
  onsite: 'in_person',
  'in person': 'in_person',
  inperson: 'in_person',
  office: 'in_person',
  'in office': 'in_person',
  physical: 'in_person',
  hybrid: 'hybrid',
};

export function parseRemoteMode(raw: string): RemoteMode | null {
  const v = fold(raw);
  return REMOTE_WORDS[v] ?? null;
}

/** Other names people use for countries in the table (folded name → code). */
const COUNTRY_ALIASES: Record<string, string> = {
  drc: 'CD',
  'dr congo': 'CD',
  'd r congo': 'CD',
  'democratic republic of the congo': 'CD',
  'democratic republic of congo': 'CD',
  'congo kinshasa': 'CD',
  'republic of the congo': 'CG',
  'republic of congo': 'CG',
  'congo brazzaville': 'CG',
  'ivory coast': 'CI',
  'cape verde': 'CV',
  'the gambia': 'GM',
  swaziland: 'SZ',
  'sao tome': 'ST',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  usa: 'US',
  us: 'US',
  'u s': 'US',
  'u s a': 'US',
  america: 'US',
  'united states of america': 'US',
  uae: 'AE',
  'u a e': 'AE',
  dubai: 'AE',
  turkey: 'TR',
  'south korea': 'KR',
  korea: 'KR',
  holland: 'NL',
  'the netherlands': 'NL',
  'czech republic': 'CZ',
  russia: 'RU',
};

export function parseCountry(raw: string, countries: ImportReference['countries']): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^[a-z]{2}$/i.test(v)) {
    const code = v.toUpperCase();
    return countries.some((c) => c.code === code) ? code : null;
  }
  const f = fold(v);
  const byName = countries.find((c) => fold(c.name) === f);
  if (byName) return byName.code;
  const alias = COUNTRY_ALIASES[f];
  return alias && countries.some((c) => c.code === alias) ? alias : null;
}

export function parseSector(raw: string, sectors: ImportReference['sectors']): { id: string; name: string } | null {
  const f = fold(raw);
  if (!f) return null;
  const hit = sectors.find((s) => fold(s.name) === f || fold(s.slug) === f);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** "2026-12-31", or the date part of an ISO date-time ("2026-12-31T17:00:00Z"); null when it's neither. */
export function parseDeadline(raw: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw.trim());
  if (!m) return null;
  const date = m[1]!;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date ? date : null;
}

/** A link written without its scheme ("www.acme.org/jobs", "acme.org/apply") gets https:// in front. */
function withScheme(v: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.includes('@') || /\s/.test(v)) return v;
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i.test(v) ? `https://${v}` : v;
}

export function parseApplyLink(raw: string): string | null {
  const v = raw.trim().replace(/^<|>$/g, '');
  return v ? normalizeApplyUrl(withScheme(v)) : null;
}

/** Where zod puts a problem → the CSV column it came from. */
const FIELD_COLUMN: Record<string, OpportunityCsvColumn> = {
  type: 'type',
  title: 'title',
  organisation: 'organisation',
  summary: 'summary',
  description: 'description',
  remoteMode: 'remote_mode',
  countryCode: 'country',
  city: 'city',
  sectorId: 'sector',
  deadline: 'deadline',
  compensation: 'compensation',
  moreInfoUrl: 'more_info_url',
  applyUrl: 'apply_link',
};

export const columnOfField = (field: string): OpportunityCsvColumn | 'row' => FIELD_COLUMN[field] ?? 'row';

/** The first sentence of the description, cut to fit a summary. */
function summaryFrom(description: string): string {
  const flat = description.replace(/\s+/g, ' ').trim();
  const sentence = /^(.{10,}?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return cut(sentence, OPPORTUNITY_LIMITS.summary);
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One CSV row → the listing it would become, or the problems that stop it. */
export function normaliseRow(rawValues: Record<string, string>, ref: ImportReference): Normalised {
  const cells: Partial<Record<OpportunityCsvColumn, string>> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    const key = columnKey(k) as OpportunityCsvColumn;
    if ((OPPORTUNITY_CSV_COLUMNS as readonly string[]).includes(key)) cells[key] = (v ?? '').trim();
  }
  const cell = (c: OpportunityCsvColumn) => cells[c] ?? '';
  const errors: Normalised['errors'] = {};
  const warnings: string[] = [];

  if (OPPORTUNITY_CSV_COLUMNS.every((c) => !cell(c))) return { input: null, errors: { row: 'This row is empty' }, warnings };

  // Type
  let type: OpportunityType | null = null;
  if (!cell('type')) errors.type = 'Add the type of opportunity';
  else {
    type = parseType(cell('type'));
    if (!type) errors.type = `“${cut(cell('type'), 40)}” isn’t a type we know. Use one of: ${Object.values(OPPORTUNITY_TYPE_LABELS).join(', ')}`;
  }

  // Country, then work mode (a blank mode is filled from the country, with a warning).
  let countryCode: string | null = null;
  if (cell('country')) {
    countryCode = parseCountry(cell('country'), ref.countries);
    if (!countryCode) errors.country = `“${cut(cell('country'), 40)}” isn’t a country we know. Use a two-letter code like NG or a country name`;
  }
  let remoteMode: RemoteMode | null = null;
  if (cell('remote_mode')) {
    remoteMode = parseRemoteMode(cell('remote_mode'));
    if (!remoteMode) errors.remote_mode = 'Use remote, on_site or hybrid';
  } else if (countryCode || errors.country) {
    remoteMode = 'in_person';
    warnings.push('Work mode wasn’t given, so it’s set to on-site. Change it if the opportunity is remote or hybrid.');
  } else {
    remoteMode = 'remote';
    warnings.push('Work mode and country weren’t given, so it’s set to remote. Change it if it happens in one place.');
  }
  // A remote listing doesn't need a country: an unknown one is left out instead of stopping the row.
  if (errors.country && remoteMode === 'remote') {
    warnings.push(`Country “${cut(cell('country'), 40)}” wasn’t recognised and is left out.`);
    delete errors.country;
  }

  if (remoteMode !== 'remote' && !countryCode && !errors.country && !errors.remote_mode) {
    errors.country = 'Add the country (needed for on-site and hybrid opportunities)';
  }

  // Sector: unknown ones are left out.
  let sectorId: string | null = null;
  if (cell('sector')) {
    const sector = parseSector(cell('sector'), ref.sectors);
    if (sector) sectorId = sector.id;
    else warnings.push(`Sector “${cut(cell('sector'), 40)}” isn’t one of ours, so it’s left out.`);
  }

  // Deadline
  let deadline: string | null = null;
  if (cell('deadline')) {
    deadline = parseDeadline(cell('deadline'));
    if (!deadline) errors.deadline = 'Use a date like 2026-12-31';
    else if (deadline < ref.today) errors.deadline = `The deadline (${deadline}) has passed`;
    else if (deadline > ref.latestDeadline) errors.deadline = 'Choose a deadline within the next year';
  } else warnings.push('No deadline: the listing stays open until someone closes it.');

  // Apply link: where people apply on the organisation's side. Blank: the listing takes applications
  // in Charter Mission (the application form), reviewed in the admin console under the listing.
  let applyUrl: string | null = null;
  if (cell('apply_link')) {
    applyUrl = parseApplyLink(cell('apply_link'));
    if (!applyUrl) errors.apply_link = 'Use a link starting with https:// or an email address, or leave it empty to take applications in Charter Mission';
  }

  let moreInfoUrl: string | null = null;
  if (cell('more_info_url')) {
    const link = parseApplyLink(cell('more_info_url'));
    if (link && /^https?:/.test(link)) moreInfoUrl = link;
    else warnings.push('The more-info link isn’t a web link, so it’s left out.');
  }

  // Summary: taken from the description when blank, shortened when too long.
  let summary = cell('summary').replace(/\s+/g, ' ');
  if (!summary && cell('description')) {
    summary = summaryFrom(cell('description'));
    if (summary) warnings.push('No summary was given, so the first sentence of the description is used.');
  } else if (summary.length > OPPORTUNITY_LIMITS.summary) {
    summary = cut(summary, OPPORTUNITY_LIMITS.summary);
    warnings.push(`The summary was longer than ${OPPORTUNITY_LIMITS.summary} characters and has been shortened.`);
  }

  const parsed = OpportunityInput.safeParse({
    type: type ?? 'employment',
    title: cell('title'),
    organisation: cell('organisation'),
    summary,
    description: cell('description'),
    remoteMode: remoteMode ?? 'remote',
    countryCode,
    city: cell('city') || null,
    sectorId,
    deadline,
    compensation: cell('compensation') || null,
    moreInfoUrl,
    applyUrl: applyUrl ?? null,
    shareToFeed: true,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const column = columnOfField(String(issue.path[0] ?? ''));
      // Our own message (above) wins over zod's for the same column.
      if (!errors[column]) errors[column] = blankAware(column, cell, issue.message);
    }
  }
  if (Object.keys(errors).length || !parsed.success) return { input: null, errors, warnings };
  const { shareToFeed: _share, ...input } = parsed.data;
  return { input: input satisfies OpportunityImportValues, errors, warnings };
}

/** "Add the title" reads better than a length rule when the cell is blank. */
function blankAware(column: OpportunityCsvColumn | 'row', cell: (c: OpportunityCsvColumn) => string, message: string): string {
  if (column === 'row' || cell(column)) return message;
  const blank: Partial<Record<OpportunityCsvColumn, string>> = {
    title: 'Add a title',
    organisation: 'Add the organisation',
    description: 'Add a description',
    summary: 'Add a one-line summary',
    country: 'Add the country (needed for on-site and hybrid opportunities)',
  };
  return blank[column] ?? message;
}
