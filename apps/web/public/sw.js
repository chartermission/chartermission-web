/*
 * Charter Mission service worker: shows push notifications for messages and opens the right page
 * when one is tapped. It does not cache anything.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Charter Mission", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Charter Mission";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/brand/charter-mission-mark.png",
      badge: "/brand/charter-mission-mark.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/messages" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === new URL(url, self.location.origin).origin && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
