import type { ProfileOptionKind } from "@chartermission/contracts";

/** How each list is named in the console. `usage` heads the column counting who uses an option. */
export const KIND_LABELS: Record<ProfileOptionKind, { label: string; usage: string }> = {
  skills: { label: "Skills", usage: "Members using" },
  sectors: { label: "Sectors", usage: "Members using" },
  interests: { label: "Interests", usage: "Members using" },
  languages: { label: "Languages", usage: "Members using" },
  "event-categories": { label: "Event categories", usage: "Events using" },
};

export const optionsPath = (kind: ProfileOptionKind) => `/admin/profile-options/${kind}`;
