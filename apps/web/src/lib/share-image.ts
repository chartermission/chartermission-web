/**
 * The picture link previews show (WhatsApp, LinkedIn, X, Slack) when a link has none of its own:
 * the Charter Mission logo, centred on white so it survives both WhatsApp's square crop and the
 * wide card on LinkedIn, Facebook and X. A page that sets its own `openGraph` replaces the
 * layout's, image included, so each one spreads this back in. A new file name (rather than
 * replacing the old picture) makes WhatsApp and Facebook fetch it again instead of their cached copy.
 */
export const SHARE_IMAGE = {
  url: "/brand/share-logo.jpg",
  width: 1200,
  height: 630,
  alt: "Charter Mission logo",
  type: "image/jpeg",
};
