"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createCompanyAction, demoLoginAction, loginAction, signupAction, type FormState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@batzio/i18n/react";

/** After an action rejects fields, focus the first one so its label and error are read out. */
function useFocusFirstError(state: FormState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.fields && Object.keys(state.fields).length) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return form;
}

const LANGUAGES = [
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
];

function slugPreview(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function ErrorBanner({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}

export function LoginForm({ next, invite }: { next?: string; invite?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-6">
      <ErrorBanner state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <input type="hidden" name="invite" value={invite ?? ""} />
      <FieldGroup>
        <Field>
          <FieldLabel>{t("Email")}</FieldLabel>
          <Input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        </Field>
        <Field>
          <FieldLabel>{t("Password")}</FieldLabel>
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
      </FieldGroup>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending && <Spinner />} {t("Sign in")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("New to Batzio?")}{" "}
        <Link href={invite ? `/signup?invite=${invite}` : "/signup"} className="font-medium text-primary hover:underline">
          {t("Create an account")}
        </Link>
      </p>
    </form>
  );
}

/** The shared demo account: its credentials, and a button that signs in with them. */
export function DemoLogin({ email, password }: { email: string; password: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(demoLoginAction, {});
  return (
    <form action={action} className="neu-card space-y-4 p-5">
      <div>
        <p className="font-display font-semibold">{t("Just looking around?")}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t("Open the demo company: a Swiss agency with a year of invoices, bills, payroll and bank statements.")}</p>
      </div>
      <dl className="bg-muted/60 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 text-sm">
        <dt className="text-muted-foreground">{t("Email")}</dt>
        <dd className="font-mono break-all">{email}</dd>
        <dt className="text-muted-foreground">{t("Password")}</dt>
        <dd className="font-mono break-all">{password}</dd>
      </dl>
      <ErrorBanner state={state} />
      <Button type="submit" variant="outline" className="w-full" size="lg" disabled={pending}>
        {pending && <Spinner />} {t("Open the demo")}
      </Button>
    </form>
  );
}

function CompanyFields({ state }: { state: FormState }) {
  const t = useT();
  const [company, setCompany] = useState(state.values?.company ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [language, setLanguage] = useState(state.values?.language ?? "de");
  // Controlled, so the form reset React runs after each action keeps the choice.
  const [demo, setDemo] = useState(true);
  return (
    <>
      <Field invalid={state.fields?.company ? true : undefined}>
        <FieldLabel>{t("Company name")}</FieldLabel>
        <Input name="company" required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Muster GmbH" />
        <FieldError>{state.fields?.company}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field invalid={state.fields?.slug ? true : undefined}>
          <FieldLabel>{t("Company address")}</FieldLabel>
          <Input name="slug" value={slug} onChange={(e) => setSlug(slugPreview(e.target.value))} placeholder={slugPreview(company) || "muster-gmbh"} />
          <FieldDescription>batzio.ch/{slug || slugPreview(company) || "muster-gmbh"}</FieldDescription>
          <FieldError>{state.fields?.slug}</FieldError>
        </Field>
        <Field>
          <FieldLabel>{t("Language")}</FieldLabel>
          <input type="hidden" name="language" value={language} />
          <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("Chart of accounts")}</FieldDescription>
        </Field>
      </div>
      <Field orientation="horizontal">
        <Checkbox name="demo" checked={demo} onCheckedChange={(v) => setDemo(v === true)} />
        <FieldLabel className="font-normal">
          {t("Fill with demo data (contacts, invoices, bookings, payroll)")}
        </FieldLabel>
      </Field>
    </>
  );
}

export function SignupForm({ invite }: { invite?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(signupAction, {});
  const form = useFocusFirstError(state);
  return (
    <form ref={form} action={action} className="space-y-6">
      <ErrorBanner state={state} />
      <input type="hidden" name="invite" value={invite ?? ""} />
      <FieldGroup>
        <Field invalid={state.fields?.name ? true : undefined}>
          <FieldLabel>{t("Your name")}</FieldLabel>
          <Input name="name" autoComplete="name" required defaultValue={state.values?.name} />
        </Field>
        <Field>
          <FieldLabel>{t("Work email")}</FieldLabel>
          <Input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        </Field>
        <Field>
          <FieldLabel>{t("Password")}</FieldLabel>
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
          <FieldDescription>{t("At least 10 characters.")}</FieldDescription>
        </Field>
        {!invite && <CompanyFields state={state} />}
      </FieldGroup>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending && <Spinner />} {invite ? t("Create account & join") : t("Create account")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("Already have an account?")}{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t("Sign in")}
        </Link>
      </p>
    </form>
  );
}

export function CreateCompanyForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createCompanyAction, {});
  const form = useFocusFirstError(state);
  return (
    <form ref={form} action={action} className="space-y-6">
      <ErrorBanner state={state} />
      <FieldGroup>
        <CompanyFields state={state} />
      </FieldGroup>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />} {t("Create company")}
      </Button>
    </form>
  );
}
