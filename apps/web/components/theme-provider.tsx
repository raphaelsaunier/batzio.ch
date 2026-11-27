"use client";

import { Preferences } from "@ui-sdk/react/preferences";
import type * as React from "react";
import { colorScheme } from "@/lib/color-scheme";

/** Applies the saved colour scheme to <html> (an inline script runs before hydration, so there is no flash). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <Preferences preferences={[colorScheme]}>{children}</Preferences>;
}
