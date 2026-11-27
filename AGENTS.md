# Agent notes

## Web UI (apps/web)

The web app's components are built on [ui-sdk](https://ui-sdk.dev) (`@ui-sdk/react` + `@ui-sdk/core`), styled with Tailwind in `apps/web/components/ui/*`.

- Before using ui-sdk, read `apps/web/node_modules/@ui-sdk/react/docs/llms.txt`, then the page for each component you touch in `docs/components/<name>.md`. To build a new component, also search `apps/web/node_modules/@ui-sdk/react/docs/core.md` by heading and read `rendering.md` next to it.
- Import each part from its own entry (`@ui-sdk/react/dialog`); there is no root import. Use the `render` prop to change a part's element (`<Button render={<Link href="/x" />}>`); there is no `asChild`.
- Popups render in place, in the browser's top layer. Keep them out of `<form>`, `<a>` and `<label>` ancestors whose clicks they would trigger, and style them by ui-sdk's state attributes (`data-open`, `data-highlighted`, `data-starting-style`, …), not Radix's `data-state`.
- Don't put React `autoFocus` inside popup content: it moves focus before ui-sdk records who opened the popup, so focus is lost on close. Use the content's `initialFocus` instead.
- Dark mode is `data-color-scheme` on `<html>` (`apps/web/lib/color-scheme.ts`); colour tokens come from `packages/tokens` (`pnpm gen`).
