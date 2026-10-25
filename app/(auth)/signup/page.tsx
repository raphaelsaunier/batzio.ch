import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/forms";
import { Brand } from "@/components/brand";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Create account") };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const t = await getT();
  const { invite } = await searchParams;
  return (
    <div className="space-y-8">
      <Brand className="lg:hidden" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{invite ? t("Join your team") : t("Start with Batzio")}</h1>
        <p className="text-sm text-muted-foreground">
          {invite ? t("Create your account to accept the invitation.") : t("Create your account and your first company. Free to try, no card required.")}
        </p>
      </div>
      <SignupForm invite={invite} />
    </div>
  );
}
