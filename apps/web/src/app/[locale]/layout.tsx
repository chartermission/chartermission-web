import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-arabic";
import "../globals.css";
import { LOCALES, dirOf } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { getLocale, messagesFor } from "@/i18n/server";

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
  themeColor: "#046d35",
};

/** One prerendered shell per language. The proxy picks the language; the address stays the same. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
