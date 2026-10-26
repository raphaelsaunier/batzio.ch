import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoLogin, LoginForm } from "@/components/auth/forms";
import { Brand } from "@/components/brand";
import { ForgetLocalData } from "@/components/local/forget-local-data";
import { currentUser } from "@/lib/server/session";
import { getT } from "@/lib/i18n/server";
import { getEnv } from "@batzio/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Sign in") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; invite?: string }> }) {
  const t = await getT();
  const params = await searchParams;
  if ((await currentUser()) && !params.invite) redirect(params.next ?? "/select");
  const demo = getEnv();
  return (
    <div className="space-y-8">
      <Brand className="lg:hidden" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Welcome back")}</h1>
        <p className="text-sm text-muted-foreground">{t("Sign in to your Batzio account.")}</p>
      </div>
      <LoginForm next={params.next} invite={params.invite} />
      {demo.DEMO_LOGIN_EMAIL && demo.DEMO_LOGIN_PASSWORD && !params.invite && <DemoLogin email={demo.DEMO_LOGIN_EMAIL} password={demo.DEMO_LOGIN_PASSWORD} />}
      <ForgetLocalData />
    </div>
  );
}
