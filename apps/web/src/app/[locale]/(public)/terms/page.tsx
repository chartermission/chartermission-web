import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/public/policy-page";

export const metadata: Metadata = { title: "Terms of Use", description: "The terms for using Charter Mission." };

export default function TermsPage() {
  return (
    <PolicyPage
      path="/terms"
      title="Terms of Use"
      intro="A plain-language summary of the agreement between you and Charter Mission when you create an account."
      sections={[
        {
          id: "community",
          title: "A non-partisan community",
          body: (
            <p>
              Charter Mission connects people, opportunities and initiatives across Africa and the diaspora. Membership is free
              and never depends on a political position.
            </p>
          ),
        },
        {
          id: "account",
          title: "Your account",
          body: (
            <ul>
              <li>Use your real name and an email address you control. One account per person.</li>
              <li>Keep your password private. Passwords must be at least 12 characters and not commonly used.</li>
              <li>You need a verified email to post, comment, react, connect or report.</li>
            </ul>
          ),
        },
        {
          id: "content",
          title: "What you post",
          body: (
            <p>
              You own what you post. You allow Charter Mission to show it to the audience you choose. Follow the{" "}
              <Link href="/guidelines" className="text-primary-light underline">
                Community Guidelines
              </Link>
              ; content that breaks them may be hidden or removed.
            </p>
          ),
        },
        {
          id: "moderation",
          title: "Moderation and appeals",
          body: (
            <p>
              Moderators can warn, hide or remove content, restrict posting or connecting for a set time, or suspend an account.
              Every action records the policy it relies on. You can appeal each action once, and a different moderator reviews it.
            </p>
          ),
        },
        {
          id: "leaving",
          title: "Leaving",
          body: (
            <p>
              You can deactivate your account at any time and reactivate it by signing in. You can also ask us to delete it;
              personal data is erased within 30 days of the request being approved.
            </p>
          ),
        },
      ]}
    />
  );
}
