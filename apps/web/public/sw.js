/*
 * Charter Mission service worker.
 *  - Makes the site installable as an app (Add to Home Screen / Install app).
 *  - Shows push notifications for messages and opens the right page when one is tapped.
 *  - When a page can't load because the device is offline, shows /offline.html instead of the
 *    browser's error page. That page and the app icon are the only things it caches; every page,
 *    API call and file still comes from the network.
 * Served with Cache-Control: no-cache (next.config.ts) so browsers pick up a new version on the
 * next visit. Change OFFLINE_CACHE when offline.html or what it uses changes.
 */
const OFFLINE_CACHE = "cm-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("cm-") && key !== OFFLINE_CACHE).map((key) => caches.delete(key)));
      // The page request starts while the worker boots, so pages load as fast as without it.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Page loads only. Everything else (API, scripts, images, video) goes straight to the network.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(event.request);
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })(),
  );
});

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
      icon: "/icons/icon-192.png",
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
