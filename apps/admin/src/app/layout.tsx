import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { I18nProvider } from "@/i18n/client";
import { DICTS } from "@/i18n/dict";
import { getLocale } from "@/i18n/server";

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
  themeColor: "#024a22",
};

/** The console's language comes from a cookie, so it is read behind a boundary (the shell stays static). */
async function Localized({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale} dict={DICTS[locale]}>
      {children}
    </I18nProvider>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <Suspense>
          <Localized>{children}</Localized>
        </Suspense>
      </body>
    </html>
  );
}
