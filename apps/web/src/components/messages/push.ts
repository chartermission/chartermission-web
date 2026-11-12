"use client";

import type { MessagesConfig } from "@chartermission/contracts";
import { api } from "@/lib/api/client";

export type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Whether this browser shows message notifications while Charter Mission isn't open. */
export async function pushState(config: MessagesConfig | null): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (!config?.pushPublicKey) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** Asks the browser for permission and registers it with the server. */
export async function enablePush(config: MessagesConfig): Promise<PushState> {
  if (!supported() || !config.pushPublicKey) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.pushPublicKey) as BufferSource }));
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api("/push/subscriptions", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys } });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api("/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
  return "off";
}
