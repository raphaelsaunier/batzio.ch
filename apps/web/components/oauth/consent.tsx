"use client";

import { useActionState, useState } from "react";
import { approveOauthAction, denyOauthAction } from "@/app/oauth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS, ROLES, type Role } from "@batzio/core/permissions";
import { useT } from "@batzio/i18n/react";

export interface ConsentCompany {
  slug: string;
  name: string;
  role: Role;
}

export interface ConsentRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  resource: string | null;
  scope: "read" | "write";
  returnHost: string;
}

export function ConsentForm({ request, companies, email }: { request: ConsentRequest; companies: ConsentCompany[]; email: string }) {
  const t = useT();
  const [tenant, setTenant] = useState(companies[0]?.slug ?? "");
  const company = companies.find((c) => c.slug === tenant) ?? companies[0];
  const [role, setRole] = useState<Role>(company?.role ?? "viewer");
  const [scope, setScope] = useState<"read" | "write">(request.scope);
  const [state, approve, pending] = useActionState(approveOauthAction, {});
  const excluded = company ? ROLES.slice(0, ROLES.indexOf(company.role)) : [];
  const chosenRole = excluded.includes(role) ? company?.role ?? role : role;

  const fields = () => (
    <>
      <input type="hidden" name="client_id" value={request.clientId} />
      <input type="hidden" name="redirect_uri" value={request.redirectUri} />
      <input type="hidden" name="code_challenge" value={request.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value={request.codeChallengeMethod} />
      <input type="hidden" name="state" value={request.state ?? ""} />
      <input type="hidden" name="resource" value={request.resource ?? ""} />
      <input type="hidden" name="scope" value={scope} />
    </>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("{name} wants to work in your books.", { name: request.clientName })}</h1>
        <p className="text-muted-foreground text-sm">{t("Choose the company and how much it may do. You can disconnect it any time under Connections.")}</p>
        <p className="text-muted-foreground text-sm">{t("You will be sent back to {host}.", { host: request.returnHost })}</p>
        <p className="text-muted-foreground text-xs">{t("Signed in as {email}", { email })}</p>
      </div>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <form action={approve} className="space-y-4">
        {fields()}
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="role" value={chosenRole} />
        {companies.length > 1 ? (
          <Field>
            <FieldLabel>{t("Company")}</FieldLabel>
            <Select
              value={tenant}
              onValueChange={(slug) => {
                if (!slug) return;
                setTenant(slug);
                const next = companies.find((c) => c.slug === slug);
                if (next) setRole(next.role);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <p className="text-sm">
            <span className="text-muted-foreground">{t("Company")}</span> <span className="font-medium">{company?.name}</span>
          </p>
        )}
        <Field>
          <FieldLabel>{t("Access")}</FieldLabel>
          <Select value={scope} onValueChange={(v) => v && setScope(v as "read" | "write")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="write">{t("Read & write")}</SelectItem>
              <SelectItem value="read">{t("Read only")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t("Acts as role")}</FieldLabel>
          <Select value={chosenRole} onValueChange={(v) => v && setRole(v as Role)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.filter((r) => !excluded.includes(r)).map((r) => (
                <SelectItem key={r} value={r}>
                  {t(ROLE_LABELS[r])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="submit" className="flex-1" disabled={pending || !company}>
            {t("Allow access")}
          </Button>
          <Button type="submit" variant="outline" form="oauth-deny" disabled={pending}>
            {t("Cancel")}
          </Button>
        </div>
      </form>
      <form id="oauth-deny" action={denyOauthAction}>
        {fields()}
      </form>
    </div>
  );
}
