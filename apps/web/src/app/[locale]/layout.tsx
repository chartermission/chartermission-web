import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { MediaGuard } from "@/components/video/media-guard";
import { SHARE_IMAGE } from "@/lib/share-image";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-arabic";
import "../globals.css";
import { LOCALES, dirOf } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { DICTS } from "@/i18n/dict";
import { getLocale, getT, messagesFor } from "@/i18n/server";

/** Absolute links in share previews (WhatsApp, LinkedIn, X need a full URL for the image). */
const SITE_URL = process.env.NEXT_PUBLIC_WEB_URL || "https://chartermission.com";
const OG_LOCALE = { en: "en_GB", fr: "fr_FR", ar: "ar_AR" } as const;

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const description = t("A Pan-African professional community connecting people, opportunities and initiatives across Africa and the diaspora.");
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t("Charter Mission — Connecting African Minds"),
      template: "%s · Charter Mission",
    },
    description,
    applicationName: "Charter Mission",
    openGraph: { images: [SHARE_IMAGE], type: "website", siteName: "Charter Mission", locale: OG_LOCALE[locale], description },
    twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url] },
  };
}

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
        <I18nProvider locale={locale} messages={messagesFor(locale)} dict={DICTS[locale]}>
          {children}
          <Suspense fallback={null}>
            <MediaGuard />
          </Suspense>
        </I18nProvider>
      </body>
    </html>
  );
}
