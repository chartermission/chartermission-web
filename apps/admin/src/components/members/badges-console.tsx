"use client";

import { useState } from "react";
import { BADGE_ICONS, type AdminBadge, type AdminBadgeInput, type BadgeTone } from "@chartermission/contracts";
import { Button, Chip, Icon, ProfileBadgeChip, type IconName } from "@chartermission/ui";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { TextField } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";

const TONES: { value: BadgeTone; label: string }[] = [
  { value: "primary", label: "Green" },
  { value: "accent", label: "Red" },
  { value: "warning", label: "Amber" },
  { value: "success", label: "Light green" },
  { value: "info", label: "Blue" },
];

const ICON_LABELS: Record<(typeof BADGE_ICONS)[number], string> = {
  verified: "Seal",
  flame: "Flame",
  flag: "Flag",
  building: "Building",
  lightbulb: "Light bulb",
  message: "Speech bubble",
  users: "People",
  chart: "Chart",
  target: "Target",
  shield: "Shield",
  book: "Book",
  briefcase: "Briefcase",
  globe: "Globe",
  like: "Thumbs up",
  trending: "Trending",
};

/** Badge catalogue (GET /admin/badges): create, edit, turn on / off, remove. */
export function BadgesConsole({ initial }: { initial: AdminBadge[] }) {
  const [badges, setBadges] = useState(initial);
  const [editing, setEditing] = useState<AdminBadge | "new" | null>(null);
  const [removing, setRemoving] = useState<AdminBadge | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const upsert = (b: AdminBadge) => setBadges((list) => (list.some((x) => x.id === b.id) ? list.map((x) => (x.id === b.id ? b : x)) : [...list, b]));

  async function toggle(b: AdminBadge) {
    setBusyId(b.id);
    try {
      upsert(await api<AdminBadge>(`/admin/badges/${b.id}`, { method: "PATCH", body: { status: b.status === "active" ? "disabled" : "active" } }));
      toast(b.status === "active" ? `${b.name} turned off.` : `${b.name} turned on.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="small" onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} />
          New badge
        </Button>
      </div>
      <div className="rounded-card border border-line bg-card">
        {badges.length === 0 ? (
          <EmptyState icon="verified" title="No badges yet" />
        ) : (
          <ul className="divide-y divide-line">
            {badges.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <ProfileBadgeChip badge={b} />
                    {b.status !== "active" && <Chip tone="neutral">Off</Chip>}
                  </div>
                  <p className="text-sm text-secondary">{b.description || "No description"}</p>
                </div>
                <span className="text-sm text-body tabular-nums">
                  {b.holders} {b.holders === 1 ? "member" : "members"}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="small" disabled={busyId === b.id} onClick={() => setEditing(b)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="small" disabled={busyId === b.id} onClick={() => void toggle(b)}>
                    {b.status === "active" ? "Turn off" : "Turn on"}
                  </Button>
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => setRemoving(b)}
                    className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error disabled:opacity-50"
                  >
                    <Icon name="x" size={16} label={`Remove ${b.name}`} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <BadgeForm
          badge={editing === "new" ? null : editing}
          onSaved={(b) => {
            upsert(b);
            setEditing(null);
            toast(`${b.name} saved.`);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ReasonDialog
          title={`Remove ${removing.name}?`}
          description={`This also takes it off ${removing.holders} ${removing.holders === 1 ? "member" : "members"}. To hide it but keep who holds it, turn it off instead.`}
          confirmLabel="Remove badge"
          tone="danger"
          reasonField="none"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/admin/badges/${removing.id}`, { method: "DELETE" });
            setBadges((list) => list.filter((x) => x.id !== removing.id));
            toast(`${removing.name} removed.`);
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function BadgeForm({ badge, onSaved, onClose }: { badge: AdminBadge | null; onSaved: (b: AdminBadge) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState({
    name: badge?.name ?? "New badge",
    description: badge?.description ?? "",
    tone: (badge?.tone ?? "primary") as BadgeTone,
    icon: (badge?.icon ?? "verified") as IconName,
  });
  return (
    <FormModal
      title={badge ? `Edit ${badge.name}` : "New badge"}
      submitLabel={badge ? "Save" : "Create badge"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        const body = {
          name: String(data.get("name") ?? "").trim(),
          description: String(data.get("description") ?? "").trim(),
          tone: String(data.get("tone")) as BadgeTone,
          icon: String(data.get("icon")) as AdminBadgeInput["icon"],
        };
        try {
          onSaved(await api<AdminBadge>(badge ? `/admin/badges/${badge.id}` : "/admin/badges", { method: badge ? "PATCH" : "POST", body }));
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-3">
        <span className="text-xs text-secondary">Preview</span>
        <ProfileBadgeChip badge={{ slug: "preview", ...preview, name: preview.name || "Badge" }} />
      </div>
      <TextField label="Name" name="name" required maxLength={40} defaultValue={badge?.name} onChange={(e) => setPreview((p) => ({ ...p, name: e.target.value }))} />
      <TextField
        label="Description"
        name="description"
        maxLength={200}
        defaultValue={badge?.description}
        hint="Shown when members hover the badge."
        onChange={(e) => setPreview((p) => ({ ...p, description: e.target.value }))}
      />
      <div className="grid gap-4 sm:grid-cols-2" onChange={(e) => {
        const t = e.target as unknown as HTMLSelectElement;
        if (t.name === "tone") setPreview((p) => ({ ...p, tone: t.value as BadgeTone }));
        if (t.name === "icon") setPreview((p) => ({ ...p, icon: t.value as IconName }));
      }}>
        <Field label="Colour">{(id) => <SelectBox id={id} name="tone" defaultValue={preview.tone} options={TONES} />}</Field>
        <Field label="Icon">
          {(id) => <SelectBox id={id} name="icon" defaultValue={preview.icon} options={BADGE_ICONS.map((i) => ({ value: i, label: ICON_LABELS[i] }))} />}
        </Field>
      </div>
    </FormModal>
  );
}
