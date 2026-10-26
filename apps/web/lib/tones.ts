import type { Tone } from "@batzio/server/resources/types";
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
  info: "bg-info/12 text-info border-info/20",
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_35%)] border-warning/30 dark:text-warning",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
};
