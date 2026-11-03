import { Icon, cn } from "@chartermission/ui";

type Rule = { id: string; label: string; met: boolean | null };

/** Mirrors the API's password policy (CM-AUTH-05) so members see the rules before submitting. */
export function passwordRules(password: string, ctx: { name?: string; email?: string }): Rule[] {
  const lower = password.toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  const local = (ctx.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const localSquashed = local.replace(/[^a-z0-9]/g, "");
  const containsEmail =
    (local.length >= 3 && lower.includes(local)) || (localSquashed.length >= 3 && squashed.includes(localSquashed));
  const parts = (ctx.name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 3);
  const full = parts.join("");
  const containsName = (full.length >= 3 && squashed.includes(full)) || parts.some((p) => p.length >= 4 && squashed.includes(p));
  const hasIdentity = Boolean(ctx.name?.trim() || ctx.email?.trim());
  return [
    { id: "length", label: "At least 12 characters", met: password ? password.length >= 12 : null },
    {
      id: "personal",
      label: "Doesn’t contain your name or email",
      met: password && hasIdentity ? !containsEmail && !containsName : null,
    },
    { id: "common", label: "Not a common or breached password (checked when you continue)", met: null },
  ];
}

export function PasswordRules({ id, rules }: { id: string; rules: Rule[] }) {
  return (
    <ul id={id} className="flex flex-col gap-1" aria-label="Password requirements">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={cn(
            "flex items-center gap-1.5 text-xs",
            rule.met === true ? "text-success" : rule.met === false ? "text-error" : "text-secondary",
          )}
        >
          <Icon
            name={rule.met === false ? "x" : "check"}
            size={12}
            className={cn("shrink-0", rule.met === null && "opacity-40")}
          />
          {rule.label}
          <span className="sr-only">{rule.met === true ? " (met)" : rule.met === false ? " (not met)" : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** 0–4 strength score for the meter (Figma shows 3 of 4 bars = "Strong password"). */
export function passwordStrength(password: string): { score: number; label: string; tone: "error" | "warning" | "success" } {
  if (password.length < 12) return { score: 1, label: "Too short", tone: "error" };
  let score = 2;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 16) score += 1;
  if (score === 2) return { score, label: "Fair password", tone: "warning" };
  if (score === 3) return { score, label: "Strong password", tone: "success" };
  return { score, label: "Very strong password", tone: "success" };
}

const toneBar = { error: "bg-error", warning: "bg-warning", success: "bg-success" } as const;
const toneText = { error: "text-error", warning: "text-warning", success: "text-success" } as const;

export function StrengthMeter({ id, password }: { id: string; password: string }) {
  // Below 12 characters the rules list already says what's missing.
  if (password.length < 12) return null;
  const strength = passwordStrength(password);
  return (
    <>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn("h-1 flex-1 rounded-[2px]", bar <= strength.score ? toneBar[strength.tone] : "bg-muted")}
          />
        ))}
      </div>
      <p id={id} aria-live="polite" className={cn("text-xs", toneText[strength.tone])}>
        {strength.label}
      </p>
    </>
  );
}
