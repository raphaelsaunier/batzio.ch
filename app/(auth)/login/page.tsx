import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/forms";
import { Brand } from "@/components/brand";
import { currentUser } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Sign in") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; invite?: string }> }) {
  const t = await getT();
  const params = await searchParams;
  if ((await currentUser()) && !params.invite) redirect(params.next ?? "/select");
  return (
    <div className="space-y-8">
      <Brand className="lg:hidden" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Welcome back")}</h1>
        <p className="text-sm text-muted-foreground">{t("Sign in to your Batzio account.")}</p>
      </div>
      <LoginForm next={params.next} invite={params.invite} />
    </div>
  );
}
