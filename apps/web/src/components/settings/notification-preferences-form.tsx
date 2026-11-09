"use client";

import { Fragment, useMemo, useState, type FormEvent } from "react";
import type { NotificationCategory, NotificationPreference, NotificationPreferences } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Switch } from "./controls";
import { SaveBar } from "./save-bar";

type Channel = "in_app" | "email";
type Matrix = Record<NotificationCategory, Record<Channel, boolean>>;

const channels: { id: Channel; label: string }[] = [
  { id: "in_app", label: "In-app" },
  { id: "email", label: "Email" },
];

const groups: {
  title: string;
  rows: { category: NotificationCategory; label: string; description: string; channels?: Channel[] }[];
}[] = [
  {
    title: "Activity on your posts",
    rows: [
      {
        category: "mentions_replies",
        label: "Mentions and replies",
        description: "Someone mentions you or replies to your comment.",
      },
      { category: "comments", label: "Comments", description: "Someone comments on your post." },
      { category: "reactions", label: "Reactions", description: "Grouped, e.g. “Amina and 4 others reacted”." },
    ],
  },
  {
    title: "Your network",
    rows: [
      { category: "connections", label: "Connection requests", description: "New requests and accepted requests." },
      { category: "follows", label: "New followers", description: "Someone starts following you." },
    ],
  },
  {
    title: "Topics",
    rows: [{ category: "trending", label: "Trending topics you follow", description: "A hashtag you follow starts trending." }],
  },
  {
    title: "Events",
    rows: [
      {
        category: "events",
        label: "Event reminders and changes",
        description: "Reminders 24 hours and 1 hour before events you registered for, and changes to their time or place. Confirmations and cancellations are always sent.",
      },
    ],
  },
  {
    title: "Opportunities",
    rows: [
      {
        category: "opportunities",
        label: "Applications",
        description: "Someone applies to a listing you posted, or a poster shortlists, accepts or declines your application.",
      },
    ],
  },
  {
    title: "Safety",
    rows: [
      {
        category: "moderation",
        label: "Reports and moderation",
        description: "Outcomes of your reports and appeals, and actions on your content.",
      },
    ],
  },
  {
    title: "Email digest",
    rows: [
      {
        category: "digest",
        label: "Weekly digest",
        description: "A summary of opportunities and activity.",
        channels: ["email"],
      },
    ],
  },
];

function toMatrix(preferences: NotificationPreference[]): Matrix {
  const matrix = {} as Matrix;
  for (const p of preferences) {
    if (p.channel === "push") continue;
    matrix[p.category] ??= { in_app: false, email: false };
    matrix[p.category][p.channel] = p.enabled;
  }
  return matrix;
}

function toPreferences(matrix: Matrix): NotificationPreference[] {
  return (Object.keys(matrix) as NotificationCategory[]).flatMap((category) =>
    channels.map((channel) => ({ category, channel: channel.id, enabled: matrix[category][channel.id] })),
  );
}

/** Per-category in-app and email preferences (CM-NTF-03). Security and account messages are always sent. */
export function NotificationPreferencesForm({ initial }: { initial: NotificationPreferences }) {
  const [saved, setSaved] = useState<Matrix>(() => toMatrix(initial.preferences));
  const [matrix, setMatrix] = useState<Matrix>(saved);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(saved), [matrix, saved]);

  function set(category: NotificationCategory, channel: Channel, enabled: boolean) {
    setMatrix((current) => ({ ...current, [category]: { ...current[category], [channel]: enabled } }));
    setJustSaved(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<NotificationPreferences>("/me/notification-preferences", {
        method: "PUT",
        body: { preferences: toPreferences(matrix) },
      });
      const next = toMatrix(updated.preferences);
      setSaved(next);
      setMatrix(next);
      setJustSaved(true);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Your preferences weren’t saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Notification preferences">
      <Panel className="flex flex-col px-5 py-2">
        <div className="flex items-center justify-between gap-4 py-3">
          <h2 className="text-h3 text-ink">What we notify you about</h2>
          <span className="flex" aria-hidden="true">
            {channels.map((channel) => (
              <span key={channel.id} className="w-[72px] text-center text-label text-secondary max-sm:w-14">
                {channel.label}
              </span>
            ))}
          </span>
        </div>
        <ul className="flex flex-col border-t border-line">
          {groups.map((group) => (
            <Fragment key={group.title}>
              <li className="pt-4 pb-1 text-label text-secondary uppercase" aria-hidden="true">
                {group.title}
              </li>
              {group.rows.map((row) => {
                const rowChannels = row.channels ?? channels.map((c) => c.id);
                const values = matrix[row.category] ?? { in_app: false, email: false };
                return (
                  <li
                    key={row.category}
                    role="group"
                    aria-labelledby={`notify-${row.category}`}
                    aria-describedby={`notify-${row.category}-description`}
                    className="flex items-center gap-2 border-b border-line py-3 last:border-b-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span id={`notify-${row.category}`} className="text-sm font-medium text-ink">
                        {row.label}
                      </span>
                      <span id={`notify-${row.category}-description`} className="text-xs text-secondary">
                        {row.description}
                      </span>
                    </span>
                    {channels.map((channel) => (
                      <span key={channel.id} className="flex w-[72px] justify-center max-sm:w-14">
                        {rowChannels.includes(channel.id) ? (
                          <Switch
                            label={`${row.label}: ${channel.label}`}
                            checked={values[channel.id]}
                            onChange={(checked) => set(row.category, channel.id, checked)}
                          />
                        ) : (
                          <span className="text-sm text-disabled" aria-hidden="true">
                            —
                          </span>
                        )}
                      </span>
                    ))}
                  </li>
                );
              })}
            </Fragment>
          ))}
          <li className="pt-4 pb-1 text-label text-secondary uppercase" aria-hidden="true">
            Always on
          </li>
          <li role="group" aria-labelledby="notify-security" className="flex items-center gap-2 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span id="notify-security" className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <Icon name="shield" size={14} className="text-secondary" />
                Security and account
              </span>
              <span className="text-xs text-secondary">
                Email verification, password resets, new sign-ins and account decisions. These can’t be turned off.
              </span>
            </span>
            {channels.map((channel) => (
              <span key={channel.id} className="flex w-[72px] justify-center max-sm:w-14">
                <Switch
                  label={`Security and account: ${channel.label} (always on)`}
                  checked
                  onChange={() => undefined}
                  disabled
                />
              </span>
            ))}
          </li>
        </ul>
      </Panel>
      <SaveBar
        dirty={dirty}
        saving={saving}
        justSaved={justSaved}
        error={error}
        onDiscard={() => {
          setMatrix(saved);
          setError(null);
        }}
      />
    </form>
  );
}
