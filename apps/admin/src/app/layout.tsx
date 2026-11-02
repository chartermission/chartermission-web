import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Charter Mission Admin",
    template: "%s · Charter Mission Admin",
  },
  description: "Charter Mission admin console for moderation, review and platform controls.",
  applicationName: "Charter Mission Admin",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#192550",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
