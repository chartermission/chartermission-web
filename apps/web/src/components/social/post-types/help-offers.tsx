import Link from "next/link";
import type { HelpOfferView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { memberHref } from "../links";
import { AuthorName, MemberAvatar, TimeAgo } from "../post-parts";
import { T } from "@/i18n/client";

/** "Offers of help" on the author's own request (GET /posts/{id}/help), with an empty state. */
export function HelpOffersPanel({ offers, closed }: { offers: HelpOfferView[] | null; closed: boolean }) {
  return (
    <Panel id="offers" aria-labelledby="offers-title" className="flex scroll-mt-24 flex-col gap-4 p-5 max-sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="offers-title" className="text-h3 text-ink">
          Offers of help{offers && offers.length > 0 ? ` · ${offers.length}` : ""}
        </h2>
        <p className="flex items-center gap-1.5 text-xs text-secondary">
          <Icon name="eye" size={14} />
          Only you can see who offered
        </p>
      </div>
      {offers === null ? (
        <p role="alert" className="text-sm text-error">
          Offers couldn’t be loaded. Refresh the page to try again.
        </p>
      ) : offers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong bg-surface px-6 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary-light">
            <Icon name="users" size={22} />
          </span>
          <p className="text-md font-medium text-ink">No offers yet</p>
          <p className="max-w-sm text-sm text-secondary">
            {closed
              ? "This request is closed, so members can no longer offer help."
              : "When members tap “I can help”, they appear here with their note. Share the post to reach more people."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {offers.map((offer) => (
            <li key={offer.member.id} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
              <Link href={memberHref(offer.member.handle)} tabIndex={-1} aria-hidden="true">
                <MemberAvatar member={offer.member} />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <AuthorName member={offer.member} />
                  <TimeAgo iso={offer.createdAt} className="text-xs text-secondary" />
                </div>
                {offer.member.headline && <p className="-mt-0.5 truncate text-xs text-secondary">{offer.member.headline}</p>}
                {offer.note ? (
                  <p className="mt-1 whitespace-pre-wrap rounded-card bg-surface px-3.5 py-2.5 text-sm text-body">{offer.note}</p>
                ) : (
                  <p className="text-xs italic text-secondary">No note added</p>
                )}
                <Link href={memberHref(offer.member.handle)} className="mt-0.5 w-fit text-xs font-medium text-primary-light hover:underline">
                  View profile<span className="sr-only"> <T vars={{ name: offer.member.name }}>{"of {name}"}</T></span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
