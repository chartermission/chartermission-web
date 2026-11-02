/*
 * Events placeholder content (Figma "Web / Events", node 10:1242).
 * Dates are ISO strings so the list and calendar views share one source.
 */

/** Reference "today" for the mock data ("This week" is relative to it). */
export const eventsToday = "2026-11-02";

export type EventFormatLabel = "Online" | "In person" | "Hybrid";

export type CharterEvent = {
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Local start time with zone, e.g. "17:00 EAT". */
  time: string;
  where: string;
  /** Short place used in compact lists ("Accra & online"). */
  shortWhere?: string;
  format: EventFormatLabel;
  going: number;
  /** Hosted by one of the viewer's chapters. */
  myChapter?: boolean;
  summary?: string;
  featured?: boolean;
  registered?: boolean;
};

export const events: CharterEvent[] = [
  {
    slug: "diaspora-investment-forum-2026",
    title: "Diaspora Investment Forum 2026",
    date: "2026-11-21",
    time: "14:00 GMT",
    where: "Accra, Ghana & online",
    shortWhere: "Accra & online",
    format: "Hybrid",
    going: 312,
    featured: true,
    registered: true,
    summary:
      "Founders, investors and policymakers on making it easier to invest back home. Keynotes, deal rooms and chapter meet-ups.",
  },
  {
    slug: "founders-office-hours-fundraising-2027",
    title: "Founders’ Office Hours: Fundraising in 2027",
    date: "2026-11-24",
    time: "17:00 EAT",
    where: "Online",
    format: "Online",
    going: 128,
  },
  {
    slug: "clean-cooking-hackathon",
    title: "Clean Cooking Hackathon",
    date: "2026-11-28",
    time: "09:00 EAT",
    where: "Nairobi, Kenya",
    format: "In person",
    going: 64,
    myChapter: true,
  },
  {
    slug: "women-in-leadership-circle",
    title: "Women in Leadership Circle",
    date: "2026-12-03",
    time: "18:00 WAT",
    where: "Lagos & online",
    format: "Hybrid",
    going: 210,
  },
  {
    slug: "afcfta-rules-of-origin-explained",
    title: "AfCFTA Rules of Origin Explained",
    date: "2026-12-05",
    time: "12:00 GMT",
    where: "Online",
    format: "Online",
    going: 402,
    registered: true,
  },
  {
    slug: "johannesburg-chapter-mixer",
    title: "Johannesburg Chapter Mixer",
    date: "2026-12-09",
    time: "18:30 SAST",
    where: "Johannesburg, South Africa",
    format: "In person",
    going: 88,
  },
  {
    slug: "learning-sprint-data-for-development",
    title: "Learning Sprint: Data for Development",
    date: "2026-12-12",
    time: "10:00 GMT",
    where: "Online · Charter Center",
    format: "Online",
    going: 156,
  },
];
