"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { SERVICES_MAX_PER_HOST, type AvailabilityView, type ServiceHost, type ServiceView } from "@chartermission/contracts";
import { Button, Icon, Panel, cn } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Menu, type MenuItem } from "@/components/social/menu";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { availabilityHref, availabilityQuery, hostInputOf, hostKey, sortServices, toServiceInput } from "./format";
import { ServiceCard } from "./service-card";
import { ServiceEditorDialog } from "./service-editor-dialog";

type Editing = { service: ServiceView | null } | null;

/**
 * The "Services" panel on a profile or a page. Managers add, edit, hide, reorder and delete
 * services, and are nudged to set availability when something is bookable but no hours are set.
 * Renders nothing for other people when there are no services.
 */
export function ServicesSection({
  host,
  services,
  canManage,
  signedIn = true,
  compact = false,
}: {
  host: ServiceHost;
  services: ServiceView[];
  canManage: boolean;
  /** False for visitors who aren't signed in (they're offered sign in instead of Message / Enquire). */
  signedIn?: boolean;
  /**
   * Narrow layout for a 320px side rail (the profile's right rail). It carries no #services
   * anchor: the full-width copy in the main column (shown on smaller screens) keeps it.
   */
  compact?: boolean;
}) {
  const t = useT();
  const compactId = useId();
  const headingId = compact ? `${compactId}-heading` : "services-heading";
  const router = useRouter();
  const [list, setList] = useState(() => sortServices(services));
  const [prop, setProp] = useState(services);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<ServiceView | null>(null);
  const [moving, setMoving] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  // New data from the server (router.refresh) replaces the local copy.
  if (prop !== services) {
    setProp(services);
    setList(sortServices(services));
  }

  const shown = canManage ? list : list.filter((s) => s.active);
  const needsHours = canManage && list.some((s) => s.bookable && s.active);
  const key = hostKey(host);
  const hostInput = hostInputOf(host);
  const pageHost = host.type === "page";

  useEffect(() => {
    if (!needsHours) return;
    const controller = new AbortController();
    const [kind, pageId] = key.split(":");
    api<AvailabilityView>("/availability", {
      query: availabilityQuery(kind === "page" && pageId ? { type: "page", pageId } : { type: "member" }),
      signal: controller.signal,
    })
      .then((a) => setConfigured(a.configured))
      .catch(() => undefined);
    return () => controller.abort();
  }, [needsHours, key]);

  if (!canManage && shown.length === 0) return null;

  function saved(service: ServiceView) {
    setList((current) => sortServices(current.some((s) => s.id === service.id) ? current.map((s) => (s.id === service.id ? service : s)) : [...current, service]));
    toast.success(editing?.service ? "Service updated" : "Service added");
    router.refresh();
  }

  async function toggleHidden(service: ServiceView) {
    try {
      const updated = await api<ServiceView>(`/services/${service.id}`, { method: "PATCH", body: toServiceInput(service, { active: !service.active }) });
      setList((current) => current.map((s) => (s.id === updated.id ? updated : s)));
      toast.success(updated.active ? "Service shown" : "Service hidden");
      router.refresh();
    } catch (e) {
      toast.error(e);
    }
  }

  async function move(index: number, to: number) {
    if (moving || to < 0 || to >= list.length) return;
    const before = list;
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    const changed = next.map((s, i) => ({ s, i })).filter(({ s, i }) => s.position !== i);
    setList(next.map((s, i) => ({ ...s, position: i })));
    setMoving(true);
    try {
      await Promise.all(changed.map(({ s, i }) => api<ServiceView>(`/services/${s.id}`, { method: "PATCH", body: toServiceInput(s, { position: i }) })));
      router.refresh();
    } catch (e) {
      setList(before);
      toast.error(e);
    } finally {
      setMoving(false);
    }
  }

  function menuFor(service: ServiceView, index: number) {
    const items: MenuItem[] = [
      { label: t("Edit"), icon: "edit", onSelect: () => setEditing({ service }) },
      { label: service.active ? t("Hide") : t("Show"), icon: service.active ? "eye-off" : "eye", onSelect: () => void toggleHidden(service) },
      { label: t("Move up"), onSelect: () => void move(index, index - 1), disabled: index === 0 || moving },
      { label: t("Move down"), onSelect: () => void move(index, index + 1), disabled: index === list.length - 1 || moving },
      { label: t("Delete"), icon: "trash", danger: true, onSelect: () => setDeleting(service) },
    ];
    return <Menu label={t("Options for {title}", { title: service.title })} items={items} />;
  }

  const canAdd = canManage && list.length < SERVICES_MAX_PER_HOST;

  return (
    <Panel id={compact ? undefined : "services"} aria-labelledby={headingId} className={cn("flex scroll-mt-24 flex-col p-5", compact ? "gap-3" : "gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-h3 text-ink">
          Services
        </h2>
        {canManage && list.length > 0 && (
          <Button variant="secondary" size="small" onClick={() => setEditing({ service: null })} disabled={!canAdd}>
            <Icon name="plus" size={16} />
            Add a service
          </Button>
        )}
      </div>

      {needsHours && configured === false && (
        <div role="status" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-warning-light px-3.5 py-3 text-sm text-ink">
          <Icon name="clock" size={18} className="mt-0.5 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 basis-60">
            {pageHost ? "Nobody can book the page’s consultations until you set its hours." : "Nobody can book your consultations until you set your hours."}
          </p>
          <Link href={availabilityHref(host)} className="font-medium text-primary-light hover:underline">
            Set availability
          </Link>
        </div>
      )}

      {canManage && list.length === 0 ? (
        <div className={cn("flex flex-col items-start gap-3 rounded-[10px] border border-dashed border-line-strong", compact ? "px-3.5 py-4" : "px-4 py-5")}>
          <p className="text-sm text-body">
            {pageHost
              ? "List what the page offers. Visitors can book a free consultation or send an enquiry."
              : "List what you offer. People can book a free consultation with you or send you a message."}
          </p>
          <Button variant="accent" size="small" onClick={() => setEditing({ service: null })}>
            <Icon name="plus" size={16} />
            Add a service
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((service) => (
            <li key={service.id}>
              <ServiceCard service={service} signedIn={signedIn} compact={compact} menu={canManage ? menuFor(service, list.indexOf(service)) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {canManage && list.length >= SERVICES_MAX_PER_HOST && (
        <p className="text-xs text-secondary">{t("You can list up to {count} services.", { count: SERVICES_MAX_PER_HOST })}</p>
      )}

      {editing && (
        <ServiceEditorDialog
          host={hostInput}
          service={editing.service}
          position={editing.service ? undefined : list.length}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this service?"
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await api(`/services/${deleting.id}`, { method: "DELETE" });
            setList((current) => current.filter((s) => s.id !== deleting.id));
            toast.success("Service deleted");
            router.refresh();
          }}
          onClose={() => setDeleting(null)}
        >
          {deleting.upcomingBookings
            ? t("It has upcoming bookings ({count}). Check them in Bookings before you delete it. To stop new bookings only, hide it instead.", { count: deleting.upcomingBookings })
            : "It disappears for everyone. To keep it for later, hide it instead."}
        </ConfirmDialog>
      )}
    </Panel>
  );
}
