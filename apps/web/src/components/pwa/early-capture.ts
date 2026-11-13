/**
 * Inline script at the top of every page: keeps the browser's install event if it fires before
 * React has loaded (components/pwa/install.ts picks it up). A plain module, not "use client", so the
 * root layout (a server component) can read the string.
 */
export const EARLY_CAPTURE =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__cmInstallPrompt=e});";
