import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, cn, type IconName } from "@chartermission/ui";

const number = new Intl.NumberFormat("en-GB");
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

export const formatCount = (n: number) => (n >= 10_000 ? compact.format(n) : number.format(n));
export const formatRate = (rate: number) => `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`;

/** "+12%" against the period before, or null when there is nothing to compare with. */
export function change(current: number, previous: number): { text: string; up: boolean } | null {
  if (!previous) return current ? { text: "New this period", up: true } : null;
  const delta = (current - previous) / previous;
  if (Math.abs(delta) < 0.005) return { text: "No change", up: true };
  return { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(0)}% vs the period before`, up: delta > 0 };
}

/** One headline number with its label and an optional note (how it is counted, or the change). */
export function StatTile({ label, value, note, icon, trend }: { label: string; value: string; note?: ReactNode; icon: IconName; trend?: { text: string; up: boolean } | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-secondary">
        <Icon name={icon} size={14} />
        {label}
      </p>
      <p className="text-h1 text-ink tabular-nums max-sm:text-h2">{value}</p>
      {trend ? (
        <p className="flex items-center gap-1 text-xs text-secondary">
          <span aria-hidden="true" className={trend.up ? "text-success" : "text-error"}>
            {trend.up ? "▲" : "▼"}
          </span>
          {trend.text}
        </p>
      ) : (
        note && <p className="text-xs text-secondary">{note}</p>
      )}
    </div>
  );
}

const RANGES = [7, 28, 90] as const;

/** 7 / 28 / 90 day switch; each option is a link, so the choice is in the address. */
export function RangeTabs({ days, hrefFor }: { days: number; hrefFor: (days: number) => string }) {
  return (
    <nav aria-label="Period" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
      {RANGES.map((value) => (
        <Link
          key={value}
          href={hrefFor(value)}
          aria-current={days === value ? "page" : undefined}
          scroll={false}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium",
            days === value ? "bg-card text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
          )}
        >
          {value} days
        </Link>
      ))}
    </nav>
  );
}

/*
 * Audience colours: a fixed order (connections, followers, everyone else), checked for
 * colour-blind separation and 3:1 contrast on white. Each segment is also labelled in the
 * legend with its number, so colour never carries the meaning alone.
 */
const AUDIENCE = [
  { key: "connections", label: "Your connections", color: "#046d35" },
  { key: "followers", label: "Followers", color: "#d97400" },
  { key: "others", label: "Other members", color: "#4a63b8" },
] as const;

/** Who saw it, as one split bar with a labelled legend. */
export function AudienceSplit({ connections, followers, others, forPage }: { connections: number; followers: number; others: number; forPage: boolean }) {
  const values = { connections, followers, others };
  const parts = AUDIENCE.filter((part) => !(forPage && part.key === "connections"));
  const total = parts.reduce((sum, part) => sum + values[part.key], 0);
  if (!total) return <p className="text-sm text-secondary">Nobody has seen this yet. The split appears after the first views.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {parts.map((part) => values[part.key] > 0 && <span key={part.key} style={{ width: `${(values[part.key] / total) * 100}%`, backgroundColor: part.color }} className="min-w-1.5" />)}
      </div>
      <ul className="flex flex-col gap-1.5">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: part.color }} />
            <span className="flex-1 text-body">{part.key === "followers" && forPage ? "Followers of the page" : part.label}</span>
            <span className="font-medium text-ink tabular-nums">{number.format(values[part.key])}</span>
            <span className="w-10 text-right text-secondary tabular-nums">{Math.round((values[part.key] / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Members reached by country: one hue, longest bar first, the number at the end of each row. */
export function CountryBars({ countries }: { countries: { code: string | null; name: string; viewers: number }[] }) {
  const max = Math.max(...countries.map((c) => c.viewers), 1);
  if (!countries.length) return <p className="text-sm text-secondary">Countries appear after the first views.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {countries.map((country) => (
        <li key={country.code ?? "other"} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-body">{country.name}</span>
            <span className="font-medium text-ink tabular-nums">{number.format(country.viewers)}</span>
          </span>
          <span className="block h-2 w-full rounded-full bg-muted" aria-hidden="true">
            <span className={cn("block h-full rounded-full", country.code ? "bg-primary-light" : "bg-line-strong")} style={{ width: `${Math.max(2, (country.viewers / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
