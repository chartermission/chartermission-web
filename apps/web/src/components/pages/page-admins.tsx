"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { PageAdminView, PageDetail } from "@chartermission/contracts";
import { Button, Chip } from "@chartermission/ui";
import { inputClasses } from "@/components/auth/fields";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import { useT } from "@/i18n/client";

type Pending = { kind: "remove" | "leave" | "transfer"; admin: PageAdminView } | { kind: "delete" } | null;

/**
 * Who manages the page. Every admin can edit the page and post as it; the owner also adds and
 * removes admins, can hand the page to another admin, and can delete it.
 */
export function PageAdmins({ page, viewerId }: { page: PageDetail; viewerId: string }) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [admins, setAdmins] = useState(page.admins ?? []);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const manage = page.viewer.canManageAdmins;
  const base = `/pages/${page.slug}`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = handle.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAdmins(await api<PageAdminView[]>(`${base}/admins`, { method: "POST", body: { handle: value } }));
      setHandle("");
      toast.success("Admin added. They’ve been notified.");
    } catch (e) {
      setError(isApiError(e) ? (e.fields?.handle ?? e.message) : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line">
        {admins.map((admin) => {
          const self = admin.member.id === viewerId;
          return (
            <li key={admin.member.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <MemberAvatar member={admin.member} size={40} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link href={memberHref(admin.member.handle)} className="truncate text-sm font-medium text-ink hover:underline">
                  {admin.member.name}
                  {self && <span className="font-normal text-secondary"> (you)</span>}
                </Link>
                <span className="truncate text-xs text-secondary">@{admin.member.handle}</span>
              </div>
              <Chip tone={admin.role === "owner" ? "info" : "neutral"} className="px-2! py-0.5! text-xs!">
                {admin.role === "owner" ? "Owner" : "Admin"}
              </Chip>
              {admin.role !== "owner" && manage && (
                <>
                  <Button variant="ghost" size="small" onClick={() => setPending({ kind: "transfer", admin })}>
                    Make owner
                  </Button>
                  <Button variant="ghost" size="small" onClick={() => setPending({ kind: "remove", admin })}>
                    Remove
                  </Button>
                </>
              )}
              {admin.role !== "owner" && self && !manage && (
                <Button variant="ghost" size="small" onClick={() => setPending({ kind: "leave", admin })}>
                  Leave
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {manage && (
        <form onSubmit={add} className="flex flex-col gap-1.5 border-t border-line pt-4">
          <label htmlFor={`${id}-handle`} className="text-sm font-medium text-ink">
            Add an admin
          </label>
          <div className="flex gap-2 max-sm:flex-col">
            <input
              id={`${id}-handle`}
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                setError(null);
              }}
              placeholder="Their handle, e.g. amara-okafor"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-help`}
              className={inputClasses(!!error, "flex-1")}
            />
            <Button type="submit" variant="secondary" disabled={busy || !handle.trim()}>
              {busy ? "Adding…" : "Add admin"}
            </Button>
          </div>
          <p id={`${id}-help`} className={error ? "text-xs text-error" : "text-xs text-secondary"}>
            {error ?? "The handle is the last part of their profile address. Admins can edit the page and post as it."}
          </p>
        </form>
      )}

      {manage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-light px-4 py-3">
          <p className="text-sm text-ink">
            <span className="font-medium">Delete this page.</span> Its posts and followers are removed with it. This can’t be undone.
          </p>
          <Button variant="secondary" size="small" onClick={() => setPending({ kind: "delete" })}>
            Delete page
          </Button>
        </div>
      )}

      {pending?.kind === "delete" && (
        <ConfirmDialog
          title={t("Delete {name}?", { name: page.name })}
          confirmLabel="Delete page"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api(base, { method: "DELETE" });
            toast.success(t("{name} was deleted", { name: page.name }));
            router.push("/pages");
            router.refresh();
          }}
        >
          The page, everything it posted and its followers will be removed for good.
        </ConfirmDialog>
      )}
      {pending && pending.kind !== "delete" && (
        <ConfirmDialog
          title={
            pending.kind === "transfer"
              ? t("Make {name} the owner?", { name: pending.admin.member.name })
              : pending.kind === "leave"
                ? t("Stop managing {name}?", { name: page.name })
                : t("Remove {name} as an admin?", { name: pending.admin.member.name })
          }
          confirmLabel={pending.kind === "transfer" ? "Make owner" : pending.kind === "leave" ? "Leave" : "Remove"}
          danger={pending.kind !== "transfer"}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const userId = pending.admin.member.id;
            if (pending.kind === "transfer") {
              setAdmins(await api<PageAdminView[]>(`${base}/owner`, { method: "POST", body: { userId } }));
              toast.success(t("{name} now owns the page. You’re still an admin.", { name: pending.admin.member.name }));
              router.refresh();
            } else {
              const next = await api<PageAdminView[]>(`${base}/admins/${userId}`, { method: "DELETE" });
              if (pending.kind === "leave") {
                toast.success(t("You no longer manage {name}", { name: page.name }));
                router.push(base);
                router.refresh();
              } else {
                setAdmins(next);
                toast.success("Admin removed");
              }
            }
          }}
        >
          {pending.kind === "transfer"
            ? "They will be able to add and remove admins and delete the page. You stay on as an admin."
            : pending.kind === "leave"
              ? "You won’t be able to edit the page or post as it. The owner can add you again."
              : "They won’t be able to edit the page or post as it any more."}
        </ConfirmDialog>
      )}
    </div>
  );
}
