import type { Initiative } from "@/lib/mock/initiatives";

export type InitiativeSummary = Pick<
  Initiative,
  "slug" | "title" | "theme" | "status" | "country" | "summary" | "progressLabel" | "percent" | "lead" | "collaborators"
> & { roles: { id: string; title: string }[] };

export function toInitiativeSummary(initiative: Initiative): InitiativeSummary {
  const { slug, title, theme, status, country, summary, progressLabel, percent, lead, collaborators, roles } = initiative;
  return {
    slug,
    title,
    theme,
    status,
    country,
    summary,
    progressLabel,
    percent,
    lead,
    collaborators,
    roles: roles.map(({ id, title: roleTitle }) => ({ id, title: roleTitle })),
  };
}
