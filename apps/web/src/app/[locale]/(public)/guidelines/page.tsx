import type { Metadata } from "next";
import { POLICY_REF_LABELS, type PolicyRef } from "@chartermission/contracts";
import { PolicyPage } from "@/components/public/policy-page";
import { guidelineAnchor } from "@/components/account/policy-links";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Community Guidelines"), description: t("How we keep Charter Mission safe and useful.") };
}

const descriptions: Record<PolicyRef, string> = {
  "guidelines.respect": "Disagree with ideas, not people. Keep discussion civil and constructive.",
  "guidelines.harassment": "No bullying, threats, intimidation or repeated unwanted contact.",
  "guidelines.spam": "No repetitive, unsolicited or misleading promotion, and no engagement bait.",
  "guidelines.scams": "No fraud, fake opportunities, advance-fee schemes or requests for money under false pretences.",
  "guidelines.impersonation": "Don’t pretend to be another person or organisation.",
  "guidelines.misinformation": "Don’t share content you know to be false or misleading in ways that could cause harm.",
  "guidelines.discrimination": "No hate or discrimination based on who people are.",
  "guidelines.sexual_content": "No sexual content.",
  "guidelines.violence": "No threats, incitement or glorification of violence.",
  "guidelines.ip": "Only post what you have the right to share.",
  "guidelines.platform_integrity": "Don’t manipulate trending topics, run fake accounts or abuse platform features.",
};

export default function GuidelinesPage() {
  const refs = Object.keys(POLICY_REF_LABELS) as PolicyRef[];
  return (
    <PolicyPage
      path="/guidelines"
      title="Community Guidelines"
      intro="What we expect from every member. Moderation actions always name the guideline they rely on."
      sections={[
        ...refs.map((ref) => ({
          id: guidelineAnchor(ref),
          title: POLICY_REF_LABELS[ref],
          body: <p>{descriptions[ref]}</p>,
        })),
        {
          id: "reporting",
          title: "Reporting and appeals",
          body: (
            <p>
              Report posts, comments, members or topics that break these guidelines. You’ll see the status of your reports in
              Settings. If we act on your account or content, you can appeal once and a different moderator will review it.
            </p>
          ),
        },
      ]}
    />
  );
}
