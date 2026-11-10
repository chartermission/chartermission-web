import type { Metadata } from "next";
import { PolicyPage } from "@/components/public/policy-page";

export const metadata: Metadata = { title: "Privacy Notice", description: "How Charter Mission handles your personal data." };

export default function PrivacyPage() {
  return (
    <PolicyPage
      path="/privacy"
      title="Privacy Notice"
      intro="A plain-language summary of what we collect, who can see it and the choices you have."
      sections={[
        {
          id: "collect",
          title: "What we collect",
          body: (
            <ul>
              <li>Account details: name, email, password (stored only as an Argon2id hash) and country.</li>
              <li>Profile details you choose to add, such as headline, skills, experience and links.</li>
              <li>What you do on the platform: posts, comments, connections, follows and reports.</li>
            </ul>
          ),
        },
        {
          id: "visibility",
          title: "You decide who sees your profile",
          body: (
            <p>
              Each profile field can be Public, Members, Connections or Only me. Profiles are visible to members only by default
              and your email is hidden unless you change it. Hidden fields are never sent to people who can’t see them.
            </p>
          ),
        },
        {
          id: "use",
          title: "How we use it",
          body: (
            <>
              <p>
                To run your account, show your content to the people you choose, send the emails you need (verification, security,
                outcomes) and the notifications you opt into. Analytics use a pseudonymous ID and never include message text or
                private fields. We don’t sell personal data.
              </p>
              <p>
                When a post is on your screen we count it as seen, so its author (or the admins of the page that published it) can
                see how many members it reached. The count is kept against the same pseudonymous ID with your country: authors see
                totals only, never who viewed a post, and countries with fewer than three viewers are grouped together.
              </p>
              <p>
                If you apply for the verified badge, the legal name, statement and links you send are seen only by our review team
                and are used only to decide your request.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "How long we keep it",
          body: (
            <ul>
              <li>Personal data of deleted accounts: erased within 30 days of an approved deletion request.</li>
              <li>Sessions and sign-in tokens: removed 30 days after they expire.</li>
              <li>Raw analytics events: 13 months.</li>
              <li>Moderation records and audit logs: as long as the law requires.</li>
            </ul>
          ),
        },
        {
          id: "rights",
          title: "Your choices",
          body: (
            <p>
              In Settings you can change field visibility, download a copy of your data, see the policies you accepted, deactivate
              your account or request its deletion.
            </p>
          ),
        },
      ]}
    />
  );
}
