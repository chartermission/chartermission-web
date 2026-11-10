import type { Translate } from "@/i18n/translate";

export function followersLabel(t: Translate, count: number) {
  return t("{count} followers", { count });
}
