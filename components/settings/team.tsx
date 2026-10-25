"use client";

import { Check, Copy, KeyRound, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createApiKeyAction, inviteMemberAction, removeMemberAction, revokeApiKeyAction, setRoleAction } from "@/app/(app)/[tenant]/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ROLE_LABELS, ROLES } from "@/lib/permissions";
import { useT } from "@/lib/i18n/client";

function RoleSelect({ value, onChange, disabled, exclude = [] }: { value: string; onChange: (v: string) => void; disabled?: boolean; exclude?: string[] }) {
  const t = useT();
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-40 bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.filter((r) => !exclude.includes(r)).map((r) => (
          <SelectItem key={r} value={r}>
            {t(ROLE_LABELS[r])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CopyField({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={t("Copy")}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function InviteForm({ tenant }: { tenant: string }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await inviteMemberAction(tenant, email, role);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            setLink(r.link ? `${window.location.origin}${r.link}` : null);
            setEmail("");
            router.refresh();
          });
        }}
      >
        <Field className="min-w-64 flex-1">
          <FieldLabel htmlFor="invite-email">{t("Email")}</FieldLabel>
          <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.ch" />
        </Field>
        <Field className="w-auto">
          <FieldLabel>{t("Role")}</FieldLabel>
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <UserPlus />} {t("Invite")}
        </Button>
      </form>
      {link && (
        <Alert>
          <AlertTitle>{t("Invitation link")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t("Send this link to your colleague. It is valid for 14 days.")}</p>
            <CopyField value={link} />
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function MemberControls({ tenant, userId, role, isSelf, canManage }: { tenant: string; userId: string; role: string; isSelf: boolean; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      router.refresh();
    });
  return (
    <div className="flex items-center justify-end gap-2">
      <RoleSelect value={role} disabled={!canManage || pending} onChange={(v) => run(() => setRoleAction(tenant, userId, v))} />
      {canManage && !isSelf && (
        <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => run(() => removeMemberAction(tenant, userId))} aria-label={t("Remove member")}>
          <Trash2 className="text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

export function ApiKeyForm({ tenant, maxRole }: { tenant: string; maxRole: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [role, setRole] = useState(maxRole);
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const excluded = ROLES.slice(0, ROLES.indexOf(maxRole as (typeof ROLES)[number]));
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createApiKeyAction(tenant, name, scope, role);
            if (!r.ok) return void toast.error(r.error);
            setKey(r.key ?? null);
            setName("");
            router.refresh();
          });
        }}
      >
        <Field className="min-w-56 flex-1">
          <FieldLabel htmlFor="key-name">{t("Name")}</FieldLabel>
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude, Zapier, Excel import" />
        </Field>
        <Field className="w-auto">
          <FieldLabel>{t("Access")}</FieldLabel>
          <Select value={scope} onValueChange={(v) => setScope(v as "read" | "write")}>
            <SelectTrigger className="h-8 w-36 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="write">{t("Read & write")}</SelectItem>
              <SelectItem value="read">{t("Read only")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field className="w-auto">
          <FieldLabel>{t("Acts as role")}</FieldLabel>
          <RoleSelect value={role} onChange={setRole} exclude={excluded} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <KeyRound />} {t("Create key")}
        </Button>
      </form>
      {key && (
        <Alert className="border-success/40 bg-success/5">
          <AlertTitle>{t("Your new API key")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t("Copy it now — for security it is stored hashed and cannot be shown again.")}</p>
            <CopyField value={key} />
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function RevokeKeyButton({ tenant, id }: { tenant: string; id: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeApiKeyAction(tenant, id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Trash2 />} {t("Revoke")}
    </Button>
  );
}
