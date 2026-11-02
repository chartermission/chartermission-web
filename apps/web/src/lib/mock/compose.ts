/*
 * Create-post dialog placeholder content (Figma "Web / Create post — modal", node 19:2951).
 */
import type { IconName } from "@chartermission/ui";
import { members } from "./members";

export type HashtagSuggestion = { tag: string; posts: number; trending?: boolean };

export const hashtagSuggestions: HashtagSuggestion[] = [
  { tag: "AfCFTA", posts: 2481, trending: true },
  { tag: "DiasporaInvest", posts: 1906, trending: true },
  { tag: "CleanCooking", posts: 1122, trending: true },
  { tag: "AfricanTech", posts: 3870, trending: true },
  { tag: "YouthEmployment", posts: 908, trending: true },
  { tag: "ClimateAction", posts: 5214 },
  { tag: "AgriTech", posts: 2760 },
  { tag: "WomenInLeadership", posts: 1480 },
  { tag: "Fintech", posts: 1388 },
  { tag: "CleanEnergy", posts: 640 },
  { tag: "TradeAfrica", posts: 644 },
  { tag: "Logistics", posts: 412 },
  { tag: "CleanTech", posts: 318 },
  { tag: "MadeInAfrica", posts: 296 },
  { tag: "CharterFellows", posts: 214 },
];

export const mentionSuggestions = Object.values(members).map(({ name, handle, shortHeadline, tone }) => ({
  name,
  handle,
  headline: shortHeadline,
  tone,
}));

export const audienceOptions: { value: "everyone" | "members" | "connections"; label: string; icon: IconName }[] = [
  { value: "everyone", label: "Everyone", icon: "globe" },
  { value: "members", label: "Members only", icon: "shield" },
  { value: "connections", label: "Connections", icon: "users" },
];

export const pollDurations = [
  { value: "1", label: "1 day" },
  { value: "3", label: "3 days" },
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
];
