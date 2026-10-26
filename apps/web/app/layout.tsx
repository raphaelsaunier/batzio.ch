import type { Metadata } from "next";
import { Bricolage_Grotesque, Cinzel, Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@batzio/i18n/react";
import { CATALOG_VERSION } from "@batzio/i18n/server";
import { getLocale, messagesFor } from "@/lib/i18n/server";
import { isClientNavigation } from "@/lib/navigation";
import { shareMetadata } from "@/lib/share";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700", "800"] });
// The wordmark: Roman capitals, like the lettering on the coin.
const brand = Cinzel({ subsets: ["latin"], variable: "--font-brand", weight: ["600", "700"] });

export async function generateMetadata(): Promise<Metadata> {
  return { title: { default: "Batzio", template: "%s · Batzio" }, icons: { icon: "/favicon.svg" }, ...(await shareMetadata("home")) };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  // Client-side navigations reuse the catalog the browser already has.
  const navigation = await isClientNavigation();
  return (
    <html lang={locale} className={cn("font-sans", inter.variable, display.variable, brand.variable)} suppressHydrationWarning>
      <body>
        <I18nProvider locale={locale} version={CATALOG_VERSION} messages={navigation ? undefined : messagesFor(locale)}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            <Toaster position="bottom-right" richColors closeButton />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
