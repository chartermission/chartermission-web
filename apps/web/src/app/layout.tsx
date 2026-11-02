import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Charter Mission — Connecting African Minds",
    template: "%s · Charter Mission",
  },
  description:
    "A Pan-African professional community connecting people, opportunities and initiatives across Africa and the diaspora.",
  applicationName: "Charter Mission",
};

export const viewport: Viewport = {
  themeColor: "#233465",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
