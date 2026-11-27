import { createColorScheme, createLocalStorage } from "@ui-sdk/core";

/**
 * Light, dark or the browser's choice. Preferences (components/theme-provider.tsx) puts the
 * choice on <html data-color-scheme> before the first paint; tokens.css and the `dark:` variant
 * style by it. Kept under the same localStorage key the app used before, so saved choices carry over.
 */
export const colorScheme = createColorScheme({
  defaultValue: "light",
  global: true,
  storage: createLocalStorage("theme"),
  onValueChange: () => pauseTransitions(),
  onSystemValueChange: () => pauseTransitions(),
});

/** Turns transitions off for the frame the scheme changes in, so colours and shadows swap at once. */
function pauseTransitions() {
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}
