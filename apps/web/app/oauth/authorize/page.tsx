import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ConsentForm, type ConsentCompany } from "@/components/oauth/consent";
import { Button } from "@/components/ui/button";
import { listMemberships } from "@batzio/server/control";
import { publicOrigin, readAuthorizeRequest } from "@batzio/server/oauth";
import type { Role } from "@batzio/core/permissions";
import { getT } from "@/lib/i18n/server";
import { currentUser, getControl } from "@/lib/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Allow access") };
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const params = await searchParams;
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = publicOrigin(new Request(`${proto}://${host}/`));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  const next = `/oauth/authorize?${query}`;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const checked = await readAuthorizeRequest(await getControl(), new URL(next, origin));
  if (!checked.ok) {
    if (checked.redirect) redirect(checked.redirect);
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("This connection request is not valid.")}</h1>
        <Button variant="outline" className="mt-6" render={<Link href="/" />}>
          {t("Back")}
        </Button>
      </Shell>
    );
  }

  const companies: ConsentCompany[] = (await listMemberships(await getControl(), user.id)).map((m) => ({
    slug: m.tenant.slug,
    name: m.tenant.name,
    role: m.role as Role,
  }));

  return (
    <Shell>
      {companies.length === 0 ? (
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("You don't have a company yet.")}</h1>
          <Button render={<Link href="/select" />}>{t("Create one")}</Button>
        </div>
      ) : (
        <ConsentForm request={checked.request} companies={companies} email={user.email} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <Link href="/">
          <Brand />
        </Link>
        {children}
      </div>
    </main>
  );
}
