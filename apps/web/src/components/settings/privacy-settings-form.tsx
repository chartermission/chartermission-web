"use client";

import { useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { FieldVisibility } from "@chartermission/contracts";
import { Button, Icon, Panel, chipClasses, cn } from "@chartermission/ui";
import { Modal } from "@/components/initiatives/modal";
import {
  accountEmail,
  connectionRequestOptions,
  discoverabilitySettings,
  followedTopicSettings,
  notificationChannels,
  notificationSettings,
  profileFieldSettings,
  type ConnectionRequestPolicy,
  type NotificationChannel,
} from "@/lib/mock/settings";
import { SettingsSelect, Switch, VisibilitySelect } from "./controls";

type SettingsState = {
  visibility: Record<string, FieldVisibility>;
  discoverability: typeof discoverabilitySettings;
  notifications: Record<string, Record<NotificationChannel, boolean>>;
  topics: string[];
};

const initialState: SettingsState = {
  visibility: Object.fromEntries(profileFieldSettings.map((field) => [field.id, field.visibility])),
  discoverability: discoverabilitySettings,
  notifications: Object.fromEntries(notificationSettings.map((row) => [row.id, row.channels])),
  topics: followedTopicSettings,
};

const TOPIC_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,39}$/;

/** Body of "Web / Settings — privacy & notifications" (Figma 20:3109), right column. */
export function PrivacySettingsForm() {
  const [state, setState] = useState<SettingsState>(initialState);
  const [saved, setSaved] = useState<SettingsState>(initialState);
  const [justSaved, setJustSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(saved), [state, saved]);

  function update(next: (current: SettingsState) => SettingsState) {
    setState(next);
    setJustSaved(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = Object.entries(state.visibility).find(([, value]) => !FieldVisibility.safeParse(value).success);
    if (invalid) {
      setFormError(`Choose who can see your ${invalid[0]}.`);
      return;
    }
    setFormError(null);
    // No backend yet: PATCH /me/settings would be called here.
    setSaved(state);
    setJustSaved(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full min-w-0 flex-col gap-5" aria-labelledby="settings-title">
      <header className="flex flex-col gap-1">
        <h1 id="settings-title" className="text-h1 text-ink">
          Privacy &amp; visibility
        </h1>
        <p className="text-md text-secondary">
          You decide who sees each part of your profile. The platform enforces these settings everywhere — profile, search
          and the API.
        </p>
      </header>

      <SettingsCard
        id="profile-fields"
        title="Profile fields"
        aside={<span className="text-label text-secondary">Who can see it</span>}
      >
        {profileFieldSettings.map((field) => (
          <li key={field.id} className="flex items-center gap-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor={`visibility-${field.id}`} className="text-sm font-medium text-ink">
                {field.label}
              </label>
              <p id={`visibility-${field.id}-value`} className="text-xs text-secondary">
                {field.value}
              </p>
            </div>
            <VisibilitySelect
              id={`visibility-${field.id}`}
              name={`visibility.${field.id}`}
              aria-describedby={`visibility-${field.id}-value`}
              value={state.visibility[field.id]}
              onChange={(value) =>
                update((current) => ({ ...current, visibility: { ...current.visibility, [field.id]: value } }))
              }
            />
          </li>
        ))}
      </SettingsCard>

      <SettingsCard id="discoverability" title="Discoverability">
        <ToggleRow
          label="Show me in the member directory"
          description="Members can find you by country, sector and skills."
          checked={state.discoverability.directory}
          onChange={(directory) =>
            update((current) => ({ ...current, discoverability: { ...current.discoverability, directory } }))
          }
        />
        <ToggleRow
          label="Let people find me by email address"
          description="Only people who already know your email."
          checked={state.discoverability.findByEmail}
          onChange={(findByEmail) =>
            update((current) => ({ ...current, discoverability: { ...current.discoverability, findByEmail } }))
          }
        />
        <li className="flex items-center gap-4 py-3.5">
          <label htmlFor="connection-requests" className="min-w-0 flex-1 text-sm font-medium text-ink">
            Who can send me connection requests
          </label>
          <SettingsSelect
            id="connection-requests"
            name="connectionRequests"
            options={connectionRequestOptions}
            value={state.discoverability.connectionRequests}
            onChange={(event) =>
              update((current) => ({
                ...current,
                discoverability: {
                  ...current.discoverability,
                  connectionRequests: event.target.value as ConnectionRequestPolicy,
                },
              }))
            }
          />
        </li>
        <ToggleRow
          label="Show my activity in “People to follow”"
          checked={state.discoverability.activityInSuggestions}
          onChange={(activityInSuggestions) =>
            update((current) => ({
              ...current,
              discoverability: { ...current.discoverability, activityInSuggestions },
            }))
          }
        />
      </SettingsCard>

      <SettingsCard
        id="notifications"
        title="Notifications"
        headerClassName="py-3"
        aside={
          <span className="flex" aria-hidden="true">
            {notificationChannels.map((channel) => (
              <span key={channel.id} className="w-[72px] text-center text-label text-secondary">
                {channel.label}
              </span>
            ))}
          </span>
        }
      >
        {notificationSettings.map((row) => (
          <li key={row.id} className="flex items-center py-3" role="group" aria-labelledby={`notify-${row.id}`}>
            <span id={`notify-${row.id}`} className="min-w-0 flex-1 text-sm text-ink">
              {row.label}
            </span>
            {notificationChannels.map((channel) => (
              <span key={channel.id} className="flex w-[72px] justify-center">
                <Switch
                  label={`${row.label}: ${channel.label}`}
                  checked={state.notifications[row.id][channel.id]}
                  onChange={(checked) =>
                    update((current) => ({
                      ...current,
                      notifications: {
                        ...current.notifications,
                        [row.id]: { ...current.notifications[row.id], [channel.id]: checked },
                      },
                    }))
                  }
                />
              </span>
            ))}
          </li>
        ))}
      </SettingsCard>

      <TopicsCard
        topics={state.topics}
        onChange={(topics) => update((current) => ({ ...current, topics }))}
      />

      <YourData />

      <div
        className={cn(
          "z-10 flex items-center justify-between gap-4 rounded-card border border-line bg-card px-5 py-3",
          // Pin the bar to the viewport only while there is something to save.
          dirty && "sticky bottom-4 shadow-[0px_4px_16px_0px_rgba(26,32,44,0.08)]",
        )}
      >
        <p role="status" className={cn("flex items-center gap-2 text-sm", formError ? "text-error" : "text-secondary")}>
          {formError ? (
            formError
          ) : justSaved ? (
            <>
              <span className="flex size-5 items-center justify-center rounded-full bg-success text-inverse">
                <Icon name="check" size={12} />
              </span>
              <span className="text-ink">Your settings have been saved.</span>
            </>
          ) : dirty ? (
            "You have unsaved changes."
          ) : (
            "All changes saved."
          )}
        </p>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setState(saved);
                setFormError(null);
              }}
            >
              Discard
            </Button>
          )}
          <Button type="submit" disabled={!dirty}>
            {justSaved && !dirty ? (
              <>
                <Icon name="check" size={16} />
                Saved
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SettingsCard({
  id,
  title,
  description,
  aside,
  headerClassName,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  headerClassName?: string;
  children: ReactNode;
}) {
  return (
    <Panel id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-24 flex-col px-5 py-2">
      <div className={cn("flex items-center justify-between gap-4 py-3", headerClassName)}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={`${id}-heading`} className="text-h3 text-ink">
            {title}
          </h2>
          {description && <p className="text-xs text-secondary">{description}</p>}
        </div>
        {aside}
      </div>
      <ul className="flex flex-col divide-y divide-line border-t border-line">{children}</ul>
    </Panel>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </span>
        {description && (
          <span id={`${id}-description`} className="text-xs text-secondary">
            {description}
          </span>
        )}
      </div>
      <Switch
        label={label}
        describedBy={description ? `${id}-description` : undefined}
        checked={checked}
        onChange={onChange}
      />
    </li>
  );
}

/** Followed hashtags — target of the "Manage" link in the feed's left rail (/settings#topics). */
function TopicsCard({ topics, onChange }: { topics: string[]; onChange: (topics: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const tag = draft.trim().replace(/^#/, "");
    if (!TOPIC_PATTERN.test(tag)) {
      setError("Use 2–40 letters or numbers, starting with a letter (no spaces).");
      return;
    }
    if (topics.some((topic) => topic.toLowerCase() === tag.toLowerCase())) {
      setError(`You already follow #${tag}.`);
      return;
    }
    onChange([...topics, tag]);
    setDraft("");
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Add the topic instead of submitting the whole settings form.
      event.preventDefault();
      add();
    }
  }

  return (
    <SettingsCard id="topics" title="Topics you follow" description="Hashtags shape your feed and your trending-topic alerts.">
      <li className="py-3.5">
        {topics.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Followed hashtags">
            {topics.map((topic) => (
              <li key={topic} className={chipClasses("hashtag", "gap-1 pr-1.5")}>
                #{topic}
                <button
                  type="button"
                  onClick={() => onChange(topics.filter((item) => item !== topic))}
                  aria-label={`Unfollow #${topic}`}
                  className="rounded-full p-0.5 hover:bg-accent/15"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">You don’t follow any hashtags yet.</p>
        )}
      </li>
      <li className="flex flex-col gap-1.5 py-3.5">
        <label htmlFor="add-topic" className="text-sm font-medium text-ink">
          Follow a hashtag
        </label>
        <div className="flex gap-2">
          <span className="relative flex w-[280px] max-w-full">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-secondary">
              #
            </span>
            <input
              id="add-topic"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={onKeyDown}
              placeholder="e.g. CleanEnergy"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "add-topic-error" : undefined}
              className={cn(
                "w-full rounded-lg border bg-card py-2 pl-7 pr-3 text-sm text-ink placeholder:text-disabled hover:border-line-strong focus:border-primary-light focus:outline-none",
                error ? "border-error" : "border-line",
              )}
            />
          </span>
          <Button variant="secondary" size="small" onClick={add}>
            Follow
          </Button>
        </div>
        {error && (
          <p id="add-topic-error" className="text-xs text-error">
            {error}
          </p>
        )}
      </li>
    </SettingsCard>
  );
}

type DataAction = "deactivate" | "delete";

const dataActionCopy: Record<DataAction, { title: string; body: string; confirm: string; done: string }> = {
  deactivate: {
    title: "Deactivate your account?",
    body: "Your profile, posts and connections will be hidden until you sign in again. You can reactivate at any time.",
    confirm: "Deactivate account",
    done: "Your account will be deactivated when you sign out.",
  },
  delete: {
    title: "Request account deletion?",
    body: "Deletion requests are processed within 30 days. Content you posted in public threads is removed or anonymised. You can cancel the request until then.",
    confirm: "Request deletion",
    done: "Deletion requested. We’ve emailed you a link to cancel within 30 days.",
  },
};

/** "Your data" card (Figma 20:3362). */
function YourData() {
  const [pending, setPending] = useState<DataAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Panel id="your-data" aria-labelledby="your-data-heading" className="flex scroll-mt-24 flex-col gap-3 p-5">
      <h2 id="your-data-heading" className="text-h3 text-ink">
        Your data
      </h2>
      <div className="flex flex-wrap gap-2.5">
        <Button
          variant="secondary"
          onClick={() => setMessage(`Preparing your export — we’ll email ${accountEmail} when it’s ready.`)}
        >
          Download my data
        </Button>
        <Button variant="secondary" onClick={() => setPending("deactivate")}>
          Deactivate account
        </Button>
        <Button variant="secondary" className="text-error!" onClick={() => setPending("delete")}>
          Request account deletion
        </Button>
      </div>
      <p role="status" className={cn("text-sm text-ink", !message && "sr-only")}>
        {message ?? ""}
      </p>
      <p className="text-xs text-secondary">
        Deletion requests are processed within 30 days. Content you posted in public threads is removed or anonymised.
      </p>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? dataActionCopy[pending].title : ""}
        description={pending ? dataActionCopy[pending].body : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={() => {
              if (pending) setMessage(dataActionCopy[pending].done);
              setPending(null);
            }}
            className="inline-flex items-center justify-center rounded-lg bg-error px-[18px] py-[10px] text-md font-medium text-inverse hover:bg-error/90"
          >
            {pending ? dataActionCopy[pending].confirm : "Confirm"}
          </button>
        </div>
      </Modal>
    </Panel>
  );
}
