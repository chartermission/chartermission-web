"use client";

import Link from "next/link";
import type { GroupDetail } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { absoluteDate } from "@/components/social/format";
import { memberHref, topicHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { NoTranslate } from "@/i18n/auto";
import { useIntlTag, useT } from "@/i18n/client";
import { ROLE_LABEL, RunBy } from "./group-parts";

/** The group's description and rules, as written (line breaks kept). */
function Prose({ text }: { text: string }) {
  return (
    <p dir="auto" className="whitespace-pre-line text-md text-body">
      <NoTranslate>{text}</NoTranslate>
    </p>
  );
}

/** About tab (and what a private group shows everyone): about, rules, hashtags, facts and who runs it. */
export function GroupAbout({ group, compact = false }: { group: GroupDetail; compact?: boolean }) {
  const t = useT();
  const intl = useIntlTag();
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-4 p-5 max-sm:p-4">
        <section aria-labelledby="group-about-heading" className="flex flex-col gap-2">
          <h2 id="group-about-heading" className="text-h3 text-ink">
            {t("About")}
          </h2>
          {group.about ? <Prose text={group.about} /> : <p className="text-sm text-secondary">{t("The group’s admins haven’t described it yet.")}</p>}
          {group.hashtags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("Hashtags")}>
              {group.hashtags.map((tag) => (
                <li key={tag}>
                  <Link href={topicHref(tag)} className="rounded-full bg-accent-light px-2.5 py-1 text-sm font-medium text-accent-hover hover:underline" dir="auto">
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-secondary">
            {group.country && (
              <li className="flex items-center gap-1.5">
                <Icon name="map-pin" size={16} />
                {group.country.name}
              </li>
            )}
            <li className="flex items-center gap-1.5">
              <Icon name="calendar" size={16} />
              {t("Created {date}", { date: absoluteDate(intl, group.createdAt) })}
            </li>
            {!compact && group.postCount !== null && (
              <li className="flex items-center gap-1.5">
                <Icon name="message" size={16} />
                {t("{count} posts", { count: group.postCount })}
              </li>
            )}
            <li>
              <RunBy group={group} />
            </li>
          </ul>
        </section>

        {group.rules && (
          <section aria-labelledby="group-rules-heading" className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 id="group-rules-heading" className="text-h3 text-ink">
              {t("Rules")}
            </h2>
            <Prose text={group.rules} />
          </section>
        )}
      </Panel>

      <GroupAdminsPanel group={group} />
    </div>
  );
}

/** Owner, admins and moderators: always shown, even for private groups. */
export function GroupAdminsPanel({ group }: { group: GroupDetail }) {
  const t = useT();
  return (
    <Panel aria-labelledby="group-admins-heading" className="flex flex-col gap-3 p-5 max-sm:p-4">
      <h2 id="group-admins-heading" className="text-h3 text-ink">
        {t("Admins and moderators")}
      </h2>
      {group.admins.length ? (
        <ul className="flex flex-col gap-3">
          {group.admins.map(({ member, role }) => (
            <li key={member.id} className="flex items-center gap-2.5">
              <MemberAvatar member={member} size={32} link />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link href={memberHref(member.handle)} className="truncate text-sm font-medium text-ink hover:underline">
                  {member.name}
                </Link>
                {member.headline && <span className="truncate text-xs text-secondary">{member.headline}</span>}
              </div>
              <span className="shrink-0 text-xs text-secondary">{t(ROLE_LABEL[role])}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-secondary">{t("The group is run by its page or chapter team.")}</p>
      )}
      {group.ownerType !== "member" && (
        <p className="text-xs text-secondary">
          {group.ownerType === "page" ? t("The page’s admins also run this group.") : t("The chapter team also runs this group.")}
        </p>
      )}
    </Panel>
  );
}
