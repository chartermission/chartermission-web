/*
 * Privacy & notification settings placeholder content from the Figma
 * "Web / Settings — privacy & notifications" screen (node 20:3056).
 * Visibility values use the FieldVisibility enum from @chartermission/contracts.
 */
import type { FieldVisibility } from "@chartermission/contracts";
import { followedHashtags } from "@/lib/mock-data";

export type ProfileFieldSetting = { id: string; label: string; value: string; visibility: FieldVisibility };

export const profileFieldSettings: ProfileFieldSetting[] = [
  { id: "email", label: "Email address", value: "owais@example.com", visibility: "connections" },
  { id: "phone", label: "Phone number", value: "+971 •• ••• ••65", visibility: "only_me" },
  { id: "location", label: "Location", value: "Dubai, United Arab Emirates", visibility: "members" },
  { id: "organisation", label: "Current organisation", value: "HyseTech Software Design", visibility: "public" },
  { id: "website", label: "Website", value: "hysetech.net", visibility: "public" },
  { id: "diaspora", label: "Diaspora link", value: "Pakistan · Lahore", visibility: "members" },
];

export const connectionRequestOptions = [
  { value: "everyone", label: "Everyone" },
  { value: "members", label: "Members" },
  { value: "mutual", label: "Mutual connections" },
  { value: "nobody", label: "No one" },
] as const;

export type ConnectionRequestPolicy = (typeof connectionRequestOptions)[number]["value"];

export const discoverabilitySettings = {
  directory: true,
  findByEmail: false,
  connectionRequests: "members" as ConnectionRequestPolicy,
  activityInSuggestions: true,
};

export const notificationChannels = [
  { id: "inApp", label: "In-app" },
  { id: "email", label: "Email" },
  { id: "push", label: "Push" },
] as const;

export type NotificationChannel = (typeof notificationChannels)[number]["id"];

export const notificationSettings: { id: string; label: string; channels: Record<NotificationChannel, boolean> }[] = [
  { id: "mentions", label: "Mentions and replies", channels: { inApp: true, email: true, push: true } },
  { id: "connections", label: "Connection requests", channels: { inApp: true, email: true, push: true } },
  { id: "opportunities", label: "New opportunities matching my alerts", channels: { inApp: true, email: true, push: false } },
  { id: "trending", label: "Trending topics I follow", channels: { inApp: true, email: false, push: true } },
  { id: "chapters", label: "Chapter and event reminders", channels: { inApp: true, email: true, push: true } },
  { id: "digest", label: "Weekly digest", channels: { inApp: false, email: true, push: false } },
];

export const followedTopicSettings = [...followedHashtags];

export const accountEmail = "owais@example.com";
