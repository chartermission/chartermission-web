import type { MetadataRoute } from "next";

/**
 * Web app manifest (/manifest.webmanifest): what the browser needs to offer "Install app" / "Add to
 * Home Screen" and to open Charter Mission in its own window, without the browser's address bar.
 * The icons are in public/icons (maskable ones are full-bleed so Android can crop them to any shape).
 */
export default function manifest(): MetadataRoute.Manifest {
  const icon = (src: string, sizes: string, purpose: "any" | "maskable") => ({ src, sizes, type: "image/png", purpose });
  return {
    id: "/",
    name: "Charter Mission",
    short_name: "Charter Mission",
    description: "A Pan-African professional community connecting people, opportunities and initiatives across Africa and the diaspora.",
    start_url: "/feed",
    scope: "/",
    display: "standalone",
    background_color: "#f8f9fc",
    theme_color: "#046d35",
    categories: ["social", "business", "education"],
    icons: [
      icon("/icons/icon-192.png", "192x192", "any"),
      icon("/icons/icon-512.png", "512x512", "any"),
      icon("/icons/maskable-192.png", "192x192", "maskable"),
      icon("/icons/maskable-512.png", "512x512", "maskable"),
    ],
    shortcuts: [
      { name: "Create a post", url: "/feed?compose=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Messages", url: "/messages", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Notifications", url: "/notifications", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
