import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { InvitePreview } from "@chartermission/contracts";
import { Avatar, Icon, buttonClasses, cn } from "@chartermission/ui";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { NoTranslate } from "@/i18n/auto";
import { getIntlTag, getT } from "@/i18n/server";
import { apiGetOrNull } from "@/lib/api/server";

type Search = { from?: string; chapter?: string; event?: string };

function inviteQuery(sp: Search) {
  const from = typeof sp.from === "string" ? sp.from : "";
  if (typeof sp.chapter === "string" && sp.chapter) return { from, kind: "chapter", slug: sp.chapter };
  if (typeof sp.event === "string" && sp.event) return { from, kind: "event", slug: sp.event };
  return { from, kind: "member" };
}

async function load(sp: Search) {
  const q = inviteQuery(sp);
  if (!q.from) return null;
  return apiGetOrNull<InvitePreview>("/invites/preview", q);
}

export async function generateMetadata({ searchParams }: PageProps<"/[locale]/invite">): Promise<Metadata> {
  const t = await getT();
  const preview = await load((await searchParams) as Search);
  const name = preview?.inviter?.name;
  const title = preview?.target
    ? name
      ? t("{name} invited you to {target}", { name, target: preview.target.title })
      : t("You’re invited to {target}", { target: preview.target.title })
    : name
      ? t("{name} invited you to Charter Mission", { name })
      : t("You’re invited to Charter Mission");
  return { title, robots: { index: false } };
}

async function Invitation({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getT();
  const tag = await getIntlTag();
  const preview = await load(await searchParams);
  const inviter = preview?.inviter ?? null;
  const target = preview?.target ?? null;
  const next = target?.path ?? (inviter ? `/${inviter.handle}` : "/feed");

  const when = (() => {
    if (!target?.startsAt) return null;
    const zone = target.timezone ?? "UTC";
    const start = new Date(target.startsAt);
    const end = target.endsAt ? new Date(target.endsAt) : null;
    const day = start.toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone });
    const from = start.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", timeZone: zone });
    const to = end?.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", timeZone: zone });
    return { day, time: to ? `${from}–${to}` : from, zone: zone.split("/").pop()!.replace(/_/g, " ") };
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        {inviter ? (
          <Avatar name={inviter.name} src={inviter.avatarUrl ?? undefined} tone={inviter.tone} size={56} />
        ) : (
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-tint text-primary">
            <Icon name="mail" size={24} />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <p className="text-sm text-secondary">{t("You’re invited")}</p>
          <h1 className="text-h2 text-ink">
            {inviter ? (
              <>
                <NoTranslate>{inviter.name}</NoTranslate>
                {inviter.verified && <Icon name="verified" size={18} className="ms-1 inline text-primary" label={t("Verified")} />}{" "}
                <span className="font-normal">{t("invited you")}</span>
              </>
            ) : (
              t("Join Charter Mission")
            )}
          </h1>
          {inviter?.headline && (
            <p className="truncate text-sm text-secondary">
              <NoTranslate>{inviter.headline}</NoTranslate>
            </p>
          )}
        </div>
      </div>

      {target ? (
        <article className="overflow-hidden rounded-card border border-line bg-card">
          {target.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- the chapter's or event's own picture
            <img src={target.imageUrl} alt="" className="aspect-[40/21] w-full object-cover" />
          )}
          <div className="flex flex-col gap-2 p-5">
            <span className="flex items-center gap-1.5 text-label text-accent-hover uppercase">
              <Icon name={preview?.kind === "event" ? "calendar" : "users"} size={14} />
              {preview?.kind === "event" ? t("Event") : t("Chapter")}
            </span>
            <h2 className="text-h3 text-ink">
              <NoTranslate>{target.title}</NoTranslate>
            </h2>
            {when && (
              <p className="flex items-start gap-2 text-sm text-ink">
                <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-secondary" />
                <span>
                  {when.day}
                  <br />
                  <span className="text-secondary">
                    {when.time} · {t("{city} time", { city: when.zone })}
                  </span>
                </span>
              </p>
            )}
            {target.place && (
              <p className="flex items-center gap-2 text-sm text-ink">
                <Icon name={target.format === "online" ? "video" : "map-pin"} size={16} className="shrink-0 text-secondary" />
                <NoTranslate>{target.place}</NoTranslate>
              </p>
            )}
            {(target.memberCount !== undefined || target.registeredCount !== undefined) && (
              <p className="flex items-center gap-2 text-sm text-secondary">
                <Icon name="users" size={16} className="shrink-0" />
                {target.memberCount !== undefined
                  ? t("{count} members", { count: target.memberCount })
                  : t("{count} going", { count: target.registeredCount ?? 0 })}
              </p>
            )}
            {target.description && (
              <p className="line-clamp-4 text-sm text-body">
                <NoTranslate>{target.description}</NoTranslate>
              </p>
            )}
          </div>
        </article>
      ) : (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-primary-tint-2 p-5">
          <p className="text-md text-ink">
            {inviter
              ? t("{name} would like you to join them on Charter Mission, the professional community where Africa and its diaspora build together.", { name: inviter.name })
              : t("Charter Mission is the professional community where Africa and its diaspora build together.")}
          </p>
          {inviter && <p className="text-sm text-secondary">{t("When you join, you’re connected with {name} straight away.", { name: inviter.name })}</p>}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Link href="/signup" className={cn(buttonClasses({ variant: "primary" }), "w-full")}>
          {preview?.kind === "event" ? t("Join free to register") : preview?.kind === "chapter" ? t("Join free and enter the chapter") : t("Accept the invitation")}
        </Link>
        <Link href={`/signin?next=${encodeURIComponent(next)}`} className={cn(buttonClasses({ variant: "secondary" }), "w-full")}>
          {t("I already have an account")}
        </Link>
        <p className="text-center text-xs text-secondary">
          {preview && preview.memberCount > 0
            ? t("Free to join. {count} professionals are already here.", { count: preview.memberCount })
            : t("Free to join.")}
        </p>
      </div>
    </div>
  );
}

/** The page an invitation link opens for someone who isn't a member yet: who invited them, and to what. */
export default function InvitePage({ searchParams }: PageProps<"/[locale]/invite">) {
  return (
    <AuthShell heading="You’re invited to the community building Africa’s next chapter">
      <Suspense fallback={<AuthFormSkeleton rows={4} />}>
        <Invitation searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </AuthShell>
  );
}
