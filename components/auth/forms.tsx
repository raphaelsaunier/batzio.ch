"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createCompanyAction, loginAction, signupAction, type FormState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/client";

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
          <FieldLabel htmlFor="email">{t("Email")}</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">{t("Password")}</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
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

function CompanyFields({ state }: { state: FormState }) {
  const t = useT();
  const [company, setCompany] = useState(state.values?.company ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [language, setLanguage] = useState(state.values?.language ?? "de");
  return (
    <>
      <Field data-invalid={!!state.fields?.company}>
        <FieldLabel htmlFor="company">{t("Company name")}</FieldLabel>
        <Input id="company" name="company" required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Muster GmbH" />
        <FieldError>{state.fields?.company}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field data-invalid={!!state.fields?.slug}>
          <FieldLabel htmlFor="slug">{t("Company address")}</FieldLabel>
          <Input id="slug" name="slug" value={slug} onChange={(e) => setSlug(slugPreview(e.target.value))} placeholder={slugPreview(company) || "muster-gmbh"} />
          <FieldDescription>batzio.app/{slug || slugPreview(company) || "muster-gmbh"}</FieldDescription>
          <FieldError>{state.fields?.slug}</FieldError>
        </Field>
        <Field>
          <FieldLabel>{t("Language")}</FieldLabel>
          <input type="hidden" name="language" value={language} />
          <Select value={language} onValueChange={setLanguage}>
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
        <Checkbox id="demo" name="demo" defaultChecked />
        <FieldLabel htmlFor="demo" className="font-normal">
          {t("Fill with demo data (contacts, invoices, bookings, payroll)")}
        </FieldLabel>
      </Field>
    </>
  );
}

export function SignupForm({ invite }: { invite?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(signupAction, {});
  return (
    <form action={action} className="space-y-6">
      <ErrorBanner state={state} />
      <input type="hidden" name="invite" value={invite ?? ""} />
      <FieldGroup>
        <Field data-invalid={!!state.fields?.name}>
          <FieldLabel htmlFor="name">{t("Your name")}</FieldLabel>
          <Input id="name" name="name" autoComplete="name" required defaultValue={state.values?.name} />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">{t("Work email")}</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">{t("Password")}</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
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
  return (
    <form action={action} className="space-y-6">
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
