import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale, messagesFor } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Batzio", template: "%s · Batzio" },
  description: "Swiss business software for people who would rather do anything than accounting.",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={cn("font-sans", inter.variable, display.variable)} suppressHydrationWarning>
      <body>
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            <Toaster position="bottom-right" richColors closeButton />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
