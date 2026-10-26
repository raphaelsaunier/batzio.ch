#!/usr/bin/env node
/**
 * Hands the shared EN/DE/FR/IT catalog to the native apps.
 *
 * The apps look strings up by their English text with `L("…")`, exactly like
 * `t("…")` on the web. This script collects the keys their sources use (plus a
 * few the operating systems show, such as permission prompts) and writes:
 *
 *   apps/apple/BatzioKit/…/Resources/strings.json   + Batzio/Resources/<lang>.lproj/InfoPlist.strings
 *   apps/android/app/src/main/assets/strings.json   + res/values-<lang>/strings.xml, res/xml/locales_config.xml
 *   apps/windows/Batzio.Core/Resources/strings.json + Batzio.App/Strings/<lang>/Resources.resw
 *
 *   node scripts/native.mjs          write
 *   node scripts/native.mjs --check  fail when an output is stale or a key is missing
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const repo = join(pkg, "..", "..");
const { module } = await runnerImport(join(pkg, "src/messages/catalog.ts"));
const CATALOG = module.CATALOG;
const LANGS = ["de", "fr", "it"];
const INDEX = { de: 1, fr: 2, it: 3 };
const HEADER = "Generated from packages/i18n by `pnpm gen`. Do not edit.";

/** Strings the operating systems display for the apps (permission prompts, share targets). */
const PLATFORM = {
  camera: "Batzio uses the camera to scan receipts and documents.",
  photos: "Batzio reads the receipts and documents you pick.",
  share: "Send to Batzio",
  description: "Agent-first Swiss accounting. Drop a receipt, ask Batzi, done.",
};

const SOURCES = [
  { dir: "apps/apple", ext: /\.swift$/ },
  { dir: "apps/android/app/src", ext: /\.kt$/ },
  { dir: "apps/windows", ext: /\.(cs|xaml)$/ },
];
const CALL = /\bL\(\s*"((?:[^"\\]|\\.)*)"/g;
const XAML = /\bL:Text\.Key="((?:[^"\\]|\\.)*)"/g;

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (["build", "bin", "obj", "DerivedData"].includes(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (ext.test(name) && !/Tokens\.|\.g\./.test(name)) out.push(path);
  }
  return out;
}

const unescape = (s) => JSON.parse(`"${s}"`);
const keys = new Set(Object.values(PLATFORM));
for (const { dir, ext } of SOURCES) {
  const root = join(repo, dir);
  if (!existsSync(root)) continue;
  for (const file of walk(root, ext)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(CALL)) keys.add(unescape(m[1]));
    for (const m of text.matchAll(XAML)) keys.add(unescape(m[1]));
  }
}

const rows = new Map(CATALOG.map((r) => [r[0], r]));
const missing = [...keys].filter((k) => !rows.has(k)).sort();
const sorted = [...keys].filter((k) => rows.has(k)).sort();
const table = Object.fromEntries(LANGS.map((l) => [l, Object.fromEntries(sorted.map((k) => [k, rows.get(k)[INDEX[l]]]))]));
const tr = (lang, key) => (lang === "en" ? key : (rows.get(key)?.[INDEX[lang]] ?? key));
// Plain {lang: {key: text}} (JSON has no comments; the generator header lives in this script).
const stringsJson = `${JSON.stringify(table, null, 1)}\n`;

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const androidEscape = (s) => xmlEscape(s).replace(/'/g, "\\'").replace(/"/g, '\\"');
const stringsEscape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const outputs = [
  ["apps/apple/BatzioKit/Sources/BatzioKit/Resources/strings.json", stringsJson],
  ["apps/android/app/src/main/assets/strings.json", stringsJson],
  ["apps/windows/Batzio.Core/Resources/strings.json", stringsJson],
  [
    "apps/android/app/src/main/res/xml/locales_config.xml",
    `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${HEADER} -->\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${["en", ...LANGS].map((l) => `    <locale android:name="${l}" />`).join("\n")}\n</locale-config>\n`,
  ],
];
for (const lang of ["en", ...LANGS]) {
  outputs.push([
    `apps/apple/Batzio/Resources/${lang}.lproj/InfoPlist.strings`,
    `/* ${HEADER} */\n"CFBundleDisplayName" = "Batzio";\n"NSCameraUsageDescription" = "${stringsEscape(tr(lang, PLATFORM.camera))}";\n"NSPhotoLibraryUsageDescription" = "${stringsEscape(tr(lang, PLATFORM.photos))}";\n`,
  ]);
  outputs.push([
    `apps/android/app/src/main/res/values${lang === "en" ? "" : `-${lang}`}/strings.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${HEADER} -->\n<resources>\n    <string name="app_name" translatable="false">Batzio</string>\n    <string name="share_label">${androidEscape(tr(lang, PLATFORM.share))}</string>\n</resources>\n`.replace(
      lang === "en" ? "" : '    <string name="app_name" translatable="false">Batzio</string>\n',
      "",
    ),
  ]);
  const winLang = { en: "en-US", de: "de-CH", fr: "fr-CH", it: "it-CH" }[lang];
  outputs.push([
    `apps/windows/Batzio.App/Strings/${winLang}/Resources.resw`,
    `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${HEADER} -->\n<root>\n  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>\n  <resheader name="version"><value>2.0</value></resheader>\n  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>\n  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>\n  <data name="AppDisplayName" xml:space="preserve"><value>Batzio</value></data>\n  <data name="AppDescription" xml:space="preserve"><value>${xmlEscape(tr(lang, PLATFORM.description))}</value></data>\n  <data name="ShareTarget" xml:space="preserve"><value>${xmlEscape(tr(lang, PLATFORM.share))}</value></data>\n</root>\n`,
  ]);
}

const check = process.argv.includes("--check");
let stale = 0;
for (const [rel, content] of outputs) {
  const file = join(repo, rel);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (current === content) continue;
  if (check) {
    stale++;
    console.error(`stale: ${rel}`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${relative(repo, file)}`);
  }
}
if (missing.length) {
  console.error(`${missing.length} native string(s) missing from the catalog (add them to packages/i18n/src/messages):`);
  for (const k of missing) console.error(`  ${JSON.stringify(k)}`);
}
console.log(`${sorted.length} native strings in ${["en", ...LANGS].join("/")}.`);
if ((check && stale) || missing.length) process.exit(1);
