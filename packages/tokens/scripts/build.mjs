#!/usr/bin/env node
/**
 * Turns tokens.json into platform resources:
 *   generated/tokens.css            web (imported by apps/web/app/globals.css)
 *   generated/tokens.resolved.json  sRGB hex + Display P3 for anything else
 *   apps/apple/…/Tokens.swift       SwiftUI
 *   apps/android/…/Tokens.kt        Jetpack Compose
 *   apps/windows/…/Tokens.xaml      WinUI 3
 *   icons.json →                     BZIcon.swift, BzIcons.kt, BzIcons.g.cs
 *
 *   node scripts/build.mjs          write everything
 *   node scripts/build.mjs --check  fail when a generated file is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const repo = join(pkg, "..", "..");
const tokens = JSON.parse(readFileSync(join(pkg, "tokens.json"), "utf8"));
const icons = JSON.parse(readFileSync(join(pkg, "icons.json"), "utf8"));
const HEADER = "Generated from packages/tokens by `pnpm gen`. Do not edit.";

// ---------------------------------------------------------------- colour maths

function parseOklch(value) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(value);
  if (!m) throw new Error(`Not an oklch() colour: ${value}`);
  const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]), alpha };
}

function oklchToLinearSrgb({ l, c, h }) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const linearToP3 = ([r, g, b]) => [
  0.8224621 * r + 0.177538 * g,
  0.0331941 * r + 0.9668058 * g,
  0.0170827 * r + 0.0723974 * g + 0.9105199 * b,
];
const encode = (x) => {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
const round = (x, d = 4) => Number(x.toFixed(d));

function resolve(value) {
  const o = parseOklch(value);
  const lin = oklchToLinearSrgb(o);
  const srgb = lin.map(encode);
  const p3 = linearToP3(lin).map(encode);
  const byte = (x) => Math.round(x * 255).toString(16).padStart(2, "0").toUpperCase();
  return {
    oklch: value,
    alpha: round(o.alpha),
    srgb: srgb.map((x) => round(x)),
    p3: p3.map((x) => round(x)),
    hex: `#${srgb.map(byte).join("")}`,
    argb: `#${byte(o.alpha)}${srgb.map(byte).join("")}`,
  };
}

const camel = (k) => k.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
const pascal = (k) => camel(k).replace(/^./, (ch) => ch.toUpperCase());

const colors = Object.entries(tokens.color).map(([name, v]) => ({
  name,
  light: resolve(v.light),
  dark: resolve(v.dark),
}));

// ---------------------------------------------------------------- outputs

function css() {
  const remToCss = (px) => `${px / 16}rem`;
  const shadowCss = (layers, inset) => layers.map(([x, y, blur, color]) => `${inset ? "inset " : ""}${x}px ${y}px ${blur}px var(--${color})`).join(", ");
  const scheme = (mode) => {
    const lines = [`  color-scheme: ${mode};`];
    for (const [name, v] of Object.entries(tokens.color)) {
      if (mode === "dark" && v.dark === v.light) continue;
      lines.push(`  --${name}: ${v[mode]};`);
    }
    if (mode === "light") lines.push(`  --radius: ${remToCss(tokens.radius.base)};`, `  --radius-field: ${remToCss(tokens.radius.field)};`);
    for (const [name, s] of Object.entries(tokens.shadow)) lines.push(`  --${name}: ${shadowCss(s[mode], s.inset)};`);
    for (const [name, v] of Object.entries(tokens.css)) lines.push(`  --${name}: ${v[mode]};`);
    return lines.join("\n");
  };
  // The web app's colour scheme lives on <html data-color-scheme="light|dark|system">
  // (ui-sdk's createColorScheme); "system" follows the browser before any script runs.
  const dark = scheme("dark");
  return `/* ${HEADER} */\n:root {\n${scheme("light")}\n}\n\n[data-color-scheme="dark"] {\n${dark}\n}\n\n@media (prefers-color-scheme: dark) {\n  [data-color-scheme="system"] {\n${dark.replace(/^/gm, "  ")}\n  }\n}\n`;
}

function resolvedJson() {
  return `${JSON.stringify(
    {
      $comment: HEADER,
      color: Object.fromEntries(colors.map((c) => [c.name, { light: c.light, dark: c.dark }])),
      radius: tokens.radius,
      space: tokens.space,
      font: tokens.font,
      typescale: tokens.typescale,
      shadow: tokens.shadow,
      gradient: tokens.gradient,
    },
    null,
    2,
  )}\n`;
}

function swift() {
  const rgba = (c) => `(${c.p3.join(", ")}, ${c.alpha})`;
  const out = [`// ${HEADER}`, "", "import SwiftUI", "", "public extension Color {"];
  for (const c of colors) {
    out.push(`    /// ${c.light.oklch} · dark ${c.dark.oklch}`);
    out.push(`    static let bz${pascal(c.name)} = Color.bzDynamic(light: ${rgba(c.light)}, dark: ${rgba(c.dark)})`);
  }
  out.push("}", "", "public enum BZRadius {");
  for (const [k, v] of Object.entries(tokens.radius)) out.push(`    public static let ${k === "2xl" ? "xxl" : camel(k)}: CGFloat = ${v}`);
  out.push("}", "", "public enum BZSpace {");
  for (const [k, v] of Object.entries(tokens.space)) out.push(`    public static let ${k === "2xl" ? "xxl" : camel(k)}: CGFloat = ${v}`);
  out.push("}", "", "public enum BZTypeScale {");
  for (const [k, v] of Object.entries(tokens.typescale)) out.push(`    public static let ${camel(k)}: CGFloat = ${v}`);
  out.push("}", "", "public enum BZFontFamily {");
  for (const [k, v] of Object.entries(tokens.font)) out.push(`    public static let ${camel(k)} = "${v.family}"`);
  out.push("}", "", "public enum BZShadow {");
  for (const [name, s] of Object.entries(tokens.shadow)) {
    const layers = (mode) => s[mode].map(([x, y, blur, color]) => `.init(x: ${x}, y: ${y}, blur: ${blur}, color: .bz${pascal(color)})`).join(", ");
    out.push(`    public static let ${camel(name)} = BZShadowSet(inset: ${!!s.inset}, light: [${layers("light")}], dark: [${layers("dark")}])`);
  }
  out.push("}", "", "public enum BZGradient {");
  out.push(`    public static let metal: [Color] = [${tokens.gradient.metal.map((c) => `.bz${pascal(c)}`).join(", ")}]`);
  out.push("}", "");
  return out.join("\n");
}

function kotlin() {
  const argb = (c) => `Color(0x${c.argb.slice(1)})`;
  const props = colors.map((c) => c.name);
  const out = [
    `// ${HEADER}`,
    "package ch.batzio.app.ui.theme",
    "",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.sp",
    "",
    "/** Every colour token for one appearance. */",
    "data class BzScheme(",
    ...props.map((p) => `    val ${camel(p)}: Color,`),
    ")",
    "",
  ];
  for (const mode of ["light", "dark"]) {
    out.push(`val Bz${pascal(mode)} = BzScheme(`);
    for (const c of colors) out.push(`    ${camel(c.name)} = ${argb(c[mode])}, // ${c[mode].oklch}`);
    out.push(")", "");
  }
  out.push("object BzRadius {");
  for (const [k, v] of Object.entries(tokens.radius)) out.push(`    val ${k === "2xl" ? "xxl" : camel(k)} = ${v}.dp`);
  out.push("}", "", "object BzSpace {");
  for (const [k, v] of Object.entries(tokens.space)) out.push(`    val ${k === "2xl" ? "xxl" : camel(k)} = ${v}.dp`);
  out.push("}", "", "object BzTypeScale {");
  for (const [k, v] of Object.entries(tokens.typescale)) out.push(`    val ${camel(k)} = ${v}.sp`);
  out.push("}", "", "data class BzShadowLayer(val x: Float, val y: Float, val blur: Float, val color: (BzScheme) -> Color)");
  out.push("data class BzShadowSet(val inset: Boolean, val light: List<BzShadowLayer>, val dark: List<BzShadowLayer>)", "", "object BzShadows {");
  for (const [name, s] of Object.entries(tokens.shadow)) {
    const layers = (mode) => s[mode].map(([x, y, blur, color]) => `BzShadowLayer(${x}f, ${y}f, ${blur}f) { it.${camel(color)} }`).join(", ");
    out.push(`    val ${camel(name)} = BzShadowSet(${!!s.inset}, listOf(${layers("light")}), listOf(${layers("dark")}))`);
  }
  out.push("}", "", "object BzGradient {");
  out.push(`    fun metal(s: BzScheme) = listOf(${tokens.gradient.metal.map((c) => `s.${camel(c)}`).join(", ")})`);
  out.push("}", "");
  return out.join("\n");
}

const WINUI_BRUSHES = {
  ApplicationPageBackgroundThemeBrush: "background",
  ButtonBackground: "neu-surface",
  ButtonBackgroundPointerOver: "accent",
  ButtonBackgroundPressed: "secondary",
  ButtonForeground: "foreground",
  ButtonForegroundPointerOver: "foreground",
  ButtonForegroundPressed: "foreground",
  ButtonBorderBrush: "border",
  ButtonBorderBrushPointerOver: "border",
  ButtonBorderBrushPressed: "border",
  AccentButtonBackgroundPressed: "metal-to",
  AccentButtonForeground: "primary-foreground",
  AccentButtonForegroundPointerOver: "primary-foreground",
  AccentButtonForegroundPressed: "primary-foreground",
  NavigationViewDefaultPaneBackground: "sidebar",
  NavigationViewExpandedPaneBackground: "sidebar",
  NavigationViewContentBackground: "background",
};

function xaml() {
  const dict = (mode, key) => {
    const lines = [`        <ResourceDictionary x:Key="${key}">`];
    for (const c of colors) {
      lines.push(`            <Color x:Key="Bz${pascal(c.name)}Color">${c[mode].argb}</Color>`);
      lines.push(`            <SolidColorBrush x:Key="Bz${pascal(c.name)}Brush" Color="${c[mode].argb}" />`);
    }
    const gradient = (key) => {
      lines.push(`            <LinearGradientBrush x:Key="${key}" StartPoint="0,0" EndPoint="1,1">`);
      tokens.gradient.metal.forEach((name, i, all) => {
        const c = colors.find((x) => x.name === name);
        lines.push(`                <GradientStop Color="${c[mode].argb}" Offset="${round(i / (all.length - 1), 2)}" />`);
      });
      lines.push("            </LinearGradientBrush>");
    };
    gradient("BzMetalBrush");
    // WinUI lightweight styling: the stock controls pick up Batzio's colours.
    const hex = (name) => colors.find((x) => x.name === name)[mode].argb;
    for (const [key, token] of Object.entries(WINUI_BRUSHES)) lines.push(`            <SolidColorBrush x:Key="${key}" Color="${hex(token)}" />`);
    for (const key of ["AccentButtonBackground", "AccentButtonBackgroundPointerOver"]) gradient(key);
    for (const key of ["SystemAccentColor", "SystemAccentColorLight1", "SystemAccentColorLight2", "SystemAccentColorLight3", "SystemAccentColorDark1", "SystemAccentColorDark2", "SystemAccentColorDark3"]) {
      lines.push(`            <Color x:Key="${key}">${hex("primary")}</Color>`);
    }
    lines.push("        </ResourceDictionary>");
    return lines.join("\n");
  };
  const out = [
    `<!-- ${HEADER} -->`,
    '<ResourceDictionary',
    '    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"',
    '    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">',
    "    <ResourceDictionary.ThemeDictionaries>",
    dict("light", "Default"),
    dict("light", "Light"),
    dict("dark", "Dark"),
    "    </ResourceDictionary.ThemeDictionaries>",
  ];
  for (const [k, v] of Object.entries(tokens.radius)) out.push(`    <x:Double x:Key="BzRadius${pascal(k === "2xl" ? "xxl" : k)}">${v}</x:Double>`);
  out.push(`    <CornerRadius x:Key="BzCornerRadius">${tokens.radius.base}</CornerRadius>`);
  out.push(`    <CornerRadius x:Key="BzCornerRadiusPill">${tokens.radius.pill}</CornerRadius>`);
  for (const [k, v] of Object.entries(tokens.space)) out.push(`    <x:Double x:Key="BzSpace${pascal(k === "2xl" ? "xxl" : k)}">${v}</x:Double>`);
  for (const [k, v] of Object.entries(tokens.typescale)) out.push(`    <x:Double x:Key="BzFontSize${pascal(k)}">${v}</x:Double>`);
  for (const [k, v] of Object.entries(tokens.font)) {
    const src = v.file ? `ms-appx:///Assets/Fonts/${v.file}#${v.family}` : v.family;
    out.push(`    <FontFamily x:Key="Bz${pascal(k)}Font">${src}</FontFamily>`);
  }
  out.push("</ResourceDictionary>", "");
  return out.join("\n");
}

function swiftIcons() {
  const entries = Object.entries(icons.icons).map(([k, v]) => `        "${k}": "${v.sf}",`);
  return [
    `// ${HEADER}`,
    "",
    "/// Server icon names (lucide) as SF Symbols.",
    "public enum BZIcon {",
    "    public static let symbols: [String: String] = [",
    ...entries,
    "    ]",
    "",
    `    public static func symbol(_ name: String?) -> String { name.flatMap { symbols[$0] } ?? "${icons.fallback[0]}" }`,
    "}",
    "",
  ].join("\n");
}

function kotlinIcons() {
  const entries = Object.entries(icons.icons).map(([k, v]) => `    "${k}" -> Icons.Outlined.${v.material}`);
  return [
    `// ${HEADER}`,
    "@file:Suppress(\"DEPRECATION\")",
    "",
    "package ch.batzio.app.ui.theme",
    "",
    "import androidx.compose.material.icons.Icons",
    "import androidx.compose.material.icons.outlined.*",
    "import androidx.compose.ui.graphics.vector.ImageVector",
    "",
    "/** Server icon names (lucide) as Material icons. */",
    "fun bzIcon(name: String?): ImageVector = when (name) {",
    ...entries,
    `    else -> Icons.Outlined.${icons.fallback[1]}`,
    "}",
    "",
  ].join("\n");
}

function csharpIcons() {
  const entries = Object.entries(icons.icons).map(([k, v]) => `        ["${k}"] = "\\u${v.fluent}",`);
  return [
    `// ${HEADER}`,
    "#nullable enable",
    "namespace Batzio.Core.Design;",
    "",
    "/// <summary>Server icon names (lucide) as Segoe Fluent Icons glyphs.</summary>",
    "public static class BzIcons",
    "{",
    "    private static readonly Dictionary<string, string> Glyphs = new()",
    "    {",
    ...entries,
    "    };",
    "",
    `    public static string Glyph(string? name) => name is not null && Glyphs.TryGetValue(name, out var g) ? g : "\\u${icons.fallback[2]}";`,
    "}",
    "",
  ].join("\n");
}

const OUTPUTS = [
  [join(pkg, "generated/tokens.css"), css],
  [join(pkg, "generated/tokens.resolved.json"), resolvedJson],
  [join(repo, "apps/apple/BatzioKit/Sources/BatzioKit/Design/Tokens.swift"), swift],
  [join(repo, "apps/android/app/src/main/java/ch/batzio/app/ui/theme/Tokens.kt"), kotlin],
  [join(repo, "apps/windows/Batzio.App/Themes/Tokens.xaml"), xaml],
  [join(repo, "apps/apple/BatzioKit/Sources/BatzioKit/Design/BZIcon.swift"), swiftIcons],
  [join(repo, "apps/android/app/src/main/java/ch/batzio/app/ui/theme/BzIcons.kt"), kotlinIcons],
  [join(repo, "apps/windows/Batzio.Core/Design/BzIcons.g.cs"), csharpIcons],
];

const check = process.argv.includes("--check");
let stale = 0;
for (const [file, render] of OUTPUTS) {
  const next = render();
  let current = null;
  try {
    current = readFileSync(file, "utf8");
  } catch {}
  if (current === next) continue;
  if (check) {
    stale++;
    console.error(`stale: ${relative(repo, file)}`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, next);
    console.log(`wrote ${relative(repo, file)}`);
  }
}
if (stale) {
  console.error("Design tokens changed; run `pnpm gen`.");
  process.exit(1);
}
