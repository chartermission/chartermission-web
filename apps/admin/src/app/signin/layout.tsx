import type { ReactNode } from "react";
import { Icon, Logo } from "@chartermission/ui";
import { LanguageSwitcher } from "@/i18n/language-menu";

/** Sign-in and MFA steps: centred card on the console's dark brand band. */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex h-[60px] items-center gap-4 bg-primary-dark px-4 sm:px-6">
        <Logo theme="dark" />
        <span className="rounded-md bg-white/12 px-2.5 py-1 text-label text-inverse">Admin console</span>
        <div className="flex-1" />
        <LanguageSwitcher dark />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-16">
        <div className="flex w-full max-w-[420px] flex-col gap-4">
          <div className="flex flex-col gap-6 rounded-card border border-line bg-card p-6 shadow-[0_1px_3px_rgba(25,37,80,0.06)] sm:p-8">
            {children}
          </div>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-secondary">
            <Icon name="shield" size={14} />
            Staff only. Every sign-in and action is recorded in the audit log.
          </p>
        </div>
      </main>
    </div>
  );
}
