"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { SignUpInput } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import {
  Checkbox,
  Field,
  FieldError,
  FormAlert,
  PasswordInput,
  boxClasses,
  describedBy,
  focusRing,
  inputClasses,
  retryMessage,
  textLinkClasses,
} from "@/components/auth/fields";
import { PasswordRules, StrengthMeter, passwordRules } from "@/components/auth/password-rules";

type FieldName = keyof SignUpInput;
type Values = { name: string; email: string; password: string; country: string; acceptTerms: boolean };
type Errors = Partial<Record<FieldName, string>>;

const fieldOrder: FieldName[] = ["name", "email", "password", "country", "acceptTerms"];

const initialValues: Values = { name: "", email: "", password: "", country: "", acceptTerms: false };

/** Runs the shared SignUpInput schema and returns the first message per field. */
function validate(values: Values): Errors {
  const result = SignUpInput.safeParse(values);
  const errors: Errors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as FieldName;
      if (errors[field]) continue;
      errors[field] =
        field === "name" && issue.code === "too_big"
          ? "Use 80 characters or fewer"
          : field === "country"
            ? "Choose your country"
            : issue.message;
    }
  }
  if (!errors.password && values.password) {
    const personal = passwordRules(values.password, values).find((rule) => rule.id === "personal");
    if (personal?.met === false) errors.password = "Don’t use your name or email address in your password";
  }
  return errors;
}

/** Sign-up form (Figma 17:1544) wired to POST /auth/register. */
export function SignUpForm({ countryGroups }: { countryGroups: CountryGroup[] }) {
  const id = useId();
  const fieldId = (field: string) => `${id}-${field}`;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [values, setValues] = useState<Values>(initialValues);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const errors = validate(values);
  const visibleError = (field: FieldName) =>
    serverErrors[field] ?? (touched[field] || submitAttempted ? errors[field] : undefined);

  const update = <K extends keyof Values>(field: K, value: Values[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setServerErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };
  const touch = (field: FieldName) => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  function focusField(field: FieldName) {
    const control = formRef.current?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitAttempted(true);
    setFormError(null);
    const firstInvalid = fieldOrder.find((field) => errors[field]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }
    const input = SignUpInput.parse(values);
    setSubmitting(true);
    try {
      await api("/auth/register", { method: "POST", body: input });
      router.push(`/check-email?email=${encodeURIComponent(input.email)}`);
      // The router may keep this screen mounted for back navigation: leave it reusable, without the password.
      setValues(initialValues);
      setTouched({});
      setSubmitAttempted(false);
      setSubmitting(false);
    } catch (error) {
      setSubmitting(false);
      if (isApiError(error, "RATE_LIMITED")) {
        setFormError(retryMessage(error.retryAfter, "Too many sign-up attempts from this network."));
      } else if (isApiError(error) && error.fields && Object.keys(error.fields).length > 0) {
        const fields = error.fields as Errors;
        setServerErrors(fields);
        const first = fieldOrder.find((field) => fields[field]);
        if (first) focusField(first);
        else setFormError(error.message);
      } else {
        setFormError(isApiError(error) ? error.message : "Something went wrong. Please try again.");
      }
    }
  }

  const nameError = visibleError("name");
  const emailError = visibleError("email");
  const passwordError = visibleError("password");
  const countryError = visibleError("country");
  const termsError = visibleError("acceptTerms");
  const rules = passwordRules(values.password, values);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={`${id}-title`}
      className="flex w-full flex-col gap-[18px]"
    >
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-h1 text-ink">
          Create your account
        </h1>
        <p className="text-md text-secondary">It takes two minutes. You can finish your profile later.</p>
      </div>

      {formError && <FormAlert tone="error">{formError}</FormAlert>}

      <Field id={fieldId("name")} label="Full name" error={nameError}>
        <input
          id={fieldId("name")}
          name="name"
          type="text"
          autoComplete="name"
          placeholder="e.g. Amina Okafor"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => touch("name")}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy(nameError && `${fieldId("name")}-error`)}
          className={inputClasses(!!nameError)}
        />
      </Field>

      <Field id={fieldId("email")} label="Email" error={emailError}>
        <input
          id={fieldId("email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="you@example.com"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          onBlur={() => touch("email")}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy(emailError && `${fieldId("email")}-error`)}
          className={inputClasses(!!emailError)}
        />
      </Field>

      <Field id={fieldId("password")} label="Password" error={passwordError}>
        <PasswordInput
          id={fieldId("password")}
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => update("password", e.target.value)}
          onBlur={() => touch("password")}
          invalid={!!passwordError}
          aria-describedby={describedBy(
            `${fieldId("password")}-rules`,
            values.password.length >= 12 && `${fieldId("password")}-strength`,
            passwordError && `${fieldId("password")}-error`,
          )}
        />
        <StrengthMeter id={`${fieldId("password")}-strength`} password={values.password} />
        <PasswordRules id={`${fieldId("password")}-rules`} rules={rules} />
      </Field>

      <Field id={fieldId("country")} label="Country of residence or connection" error={countryError}>
        <div className="relative">
          <select
            id={fieldId("country")}
            name="country"
            autoComplete="country"
            value={values.country}
            onChange={(e) => {
              update("country", e.target.value);
              touch("country");
            }}
            onBlur={() => touch("country")}
            aria-invalid={countryError ? true : undefined}
            aria-describedby={describedBy(countryError && `${fieldId("country")}-error`)}
            className={cn(
              boxClasses(!!countryError),
              focusRing(!!countryError),
              "cursor-pointer appearance-none pr-10 pl-3.5",
              values.country ? "text-ink" : "text-disabled",
            )}
          >
            <option value="" disabled>
              Select a country
            </option>
            {countryGroups.map((group) => (
              <optgroup key={group.label} label={group.label} className="text-ink">
                {group.countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size={18}
            className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-secondary"
          />
        </div>
      </Field>

      <div className="flex flex-col gap-2.5">
        <Checkbox
          name="acceptTerms"
          checked={values.acceptTerms}
          onChange={(e) => {
            update("acceptTerms", e.target.checked);
            touch("acceptTerms");
          }}
          invalid={!!termsError}
          describedBy={describedBy(termsError && `${fieldId("acceptTerms")}-error`)}
        >
          <span className="text-ink">
            I agree to the{" "}
            <Link
              href="/terms"
              target="_blank"
              className="underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              Terms of Use
            </Link>
            ,{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              Privacy Notice
            </Link>{" "}
            and{" "}
            <Link
              href="/guidelines"
              target="_blank"
              className="underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              Community Guidelines
            </Link>
          </span>
        </Checkbox>
        <FieldError id={`${fieldId("acceptTerms")}-error`} message={termsError} />
      </div>

      <Button type="submit" block disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? "Creating your account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-secondary">
        Already a member?{" "}
        <Link href="/signin" className={textLinkClasses}>
          Sign in
        </Link>
      </p>

      <p className="flex items-center gap-2 rounded-lg bg-info-light p-3 text-xs text-body">
        <Icon name="mail" size={16} className="shrink-0 text-info" />
        We’ll send a verification link. You can post once your email is verified.
      </p>
    </form>
  );
}
