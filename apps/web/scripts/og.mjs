#!/usr/bin/env node
/**
 * Renders the open-graph images (1200×630) into public/og/<kind>-<locale>.jpg.
 *
 *   pnpm --filter @batzio/web og
 *
 * Each image is an HTML page screenshotted by the local Chrome (playwright-core,
 * channel "chrome"). The copy comes from the i18n catalog, so the images speak
 * the same words as the pages; fonts are loaded from Google Fonts, so this needs
 * a connection.
 */
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bot, Code, HeartHandshake, Plug, Smartphone, Truck, Wallet, WifiOff, Zap } from "lucide-react";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
const out = join(pub, "og");
const LOCALES = ["en", "de", "fr", "it"];

// ------------------------------------------------------------------ copy

const messages = join(here, "../../../packages/i18n/src/messages");
const rows = [];
for (const file of readdirSync(messages).filter((f) => /^catalog-[a-z]\.ts$/.test(f))) {
  rows.push(...(await import(pathToFileURL(join(messages, file)).href)).ROWS);
}
const byKey = new Map(rows.map((r) => [r[0], r]));
const tr = (locale) => (key) => {
  const row = byKey.get(key);
  if (!row) throw new Error(`Missing catalog row: ${key}`);
  return row[LOCALES.indexOf(locale)];
};

// ------------------------------------------------------------------ assets

const dataUri = (file, type) => `data:${type};base64,${readFileSync(join(pub, file)).toString("base64")}`;
const COIN = dataUri("brand/coin-front-720.png", "image/png");
const MAC = dataUri("marketing/mac-insights.webp", "image/webp");
const PHONE = dataUri("marketing/iphone-today.webp", "image/webp");
const icon = (Icon) => renderToStaticMarkup(createElement(Icon, { size: 20, strokeWidth: 2.2, "aria-hidden": true }));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ------------------------------------------------------------------ templates

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1200px; height: 630px; }
body { font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.card { position: relative; width: 1200px; height: 630px; overflow: hidden; padding: 64px 72px; display: flex; flex-direction: column; }
.light { background: linear-gradient(135deg, #f6f9fc 0%, #e6edf6 55%, #d4e1f0 100%); color: #0e1a2e; }
.dark { background: radial-gradient(ellipse at 85% 10%, #1f3d63 0%, transparent 55%), linear-gradient(160deg, #0d1828 0%, #08101c 100%); color: #f1f5fb; }
.crosses { position: absolute; inset: 0; opacity: .5;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Cpath d='M20 15h4v5h5v4h-5v5h-4v-5h-5v-4h5z' fill='%233f6fa6' fill-opacity='.07'/%3E%3C/svg%3E");
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 45%); mask-image: linear-gradient(90deg, transparent 0%, #000 45%); }
.dark .crosses { filter: brightness(2.4); opacity: .35; }
.brand { position: relative; display: flex; align-items: center; gap: 14px; }
.brand img { width: 46px; height: 46px; border-radius: 50%; box-shadow: 0 4px 10px rgb(15 30 60 / .25); }
.brand span { font-family: Cinzel, serif; font-weight: 700; font-size: 30px; letter-spacing: .14em; color: #21416b; }
.brand small { margin-left: 6px; padding-left: 20px; border-left: 2px solid rgb(63 111 166 / .25); font-size: 21px; font-weight: 600; color: #3f6fa6; }
.dark .brand span { color: #cfe0f4; } .dark .brand small { color: #9cc0e8; border-color: rgb(156 192 232 / .3); }
.text { position: relative; max-width: 640px; margin-top: 40px; }
h1 { font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 60px; line-height: 1.02; letter-spacing: -.025em; text-wrap: balance; }
.light h1 { background: linear-gradient(180deg, #13243d 0%, #2b4c78 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
p.sub { margin-top: 22px; font-size: 24px; line-height: 1.4; color: #4a5b73; text-wrap: pretty; }
.dark p.sub { color: #a9b8cc; }
.chips { position: relative; display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; max-width: 700px; list-style: none; }
.chips li { display: inline-flex; align-items: center; gap: 10px; padding: 8px 17px 8px 8px; border-radius: 999px; font-size: 18px; font-weight: 600; color: #21416b;
  background: #edf2f8; box-shadow: 5px 5px 12px rgb(163 177 198 / .6), -5px -5px 12px rgb(255 255 255 / .95); }
.chips li i { display: inline-flex; width: 32px; height: 32px; border-radius: 50%; align-items: center; justify-content: center; color: #fff;
  background: linear-gradient(135deg, #8fb2da 0%, #3f6fa6 45%, #21416b 100%); }
.dark .chips li { background: rgb(255 255 255 / .06); color: #dbe7f5; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .12); }
/* home: the coin */
.glow { position: absolute; right: -120px; top: -40px; width: 760px; height: 760px; border-radius: 50%; background: radial-gradient(circle, rgb(255 255 255 / .95) 0%, rgb(255 255 255 / 0) 62%); }
.coin { position: absolute; right: -36px; top: 92px; width: 470px; height: 470px; transform: rotate(-9deg); filter: drop-shadow(0 34px 44px rgb(15 30 60 / .38)); }
/* demo: Mac + iPhone */
.mac { position: absolute; left: 700px; top: 118px; width: 640px; border-radius: 14px; box-shadow: 0 30px 60px -20px rgb(15 30 60 / .5); }
.phone { position: absolute; left: 880px; top: 236px; width: 190px; padding: 6px; border-radius: 34px; background: linear-gradient(180deg, #a1a1aa, #52525b); box-shadow: 0 30px 50px -16px rgb(15 30 60 / .6); }
.phone img { display: block; width: 100%; border-radius: 29px; }
.cta { display: inline-flex; align-items: center; gap: 10px; margin-top: 34px; padding: 14px 26px; border-radius: 999px; font-size: 21px; font-weight: 700; color: #fff;
  background: linear-gradient(180deg, #4f80b8 0%, #2c5688 100%); box-shadow: 0 10px 24px -8px rgb(33 65 107 / .7), inset 0 1px 0 rgb(255 255 255 / .35); }
/* api: endpoints */
.code { position: absolute; left: 742px; top: 150px; width: 520px; border-radius: 18px; background: rgb(6 11 20 / .9); border: 1px solid rgb(255 255 255 / .1);
  box-shadow: 0 40px 80px -30px rgb(0 0 0 / .8); font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 17px; }
.code .bar { display: flex; gap: 7px; padding: 14px 18px; border-bottom: 1px solid rgb(255 255 255 / .08); }
.code .bar span { width: 11px; height: 11px; border-radius: 50%; }
.code ol { list-style: none; padding: 16px 18px 20px; display: grid; gap: 11px; }
.code li { display: flex; gap: 12px; align-items: center; color: #cfdae8; white-space: nowrap; }
.code em { font-style: normal; font-weight: 700; font-size: 13px; padding: 3px 8px; border-radius: 6px; min-width: 52px; text-align: center; }
.code .get { background: rgb(52 211 153 / .16); color: #6ee7b7; } .code .post { background: rgb(96 165 250 / .18); color: #93c5fd; }
.code .note { color: #6b7d95; padding-left: 64px; font-size: 15px; margin-top: -6px; }
`;

function page(kind, locale) {
  const t = tr(locale);
  const brand = `<div class="brand"><img src="${COIN}" alt=""><span>BATZIO</span><small>batzio.ch</small></div>`;
  const chips = (items) => `<ul class="chips">${items.map(([I, label]) => `<li><i>${icon(I)}</i>${esc(label)}</li>`).join("")}</ul>`;
  let body;
  if (kind === "home") {
    body = `<div class="card light"><div class="crosses"></div><div class="glow"></div><img class="coin" src="${COIN}" alt="">
      ${brand}
      <div class="text"><h1>${esc(t("Swiss accounting that keeps up with you"))}</h1>
      <p class="sub">${esc(t("Instant on every device, ready for your AI assistant, compatible with the tools you already use."))}</p></div>
      ${chips([[Zap, t("Instant")], [Smartphone, t("Native apps")], [Bot, t("AI agents")], [Truck, t("Switch in one click")]])}</div>`;
  } else if (kind === "vs") {
    body = `<div class="card light"><div class="crosses"></div><div class="glow"></div><img class="coin" src="${COIN}" alt="">
      ${brand}
      <div class="text"><h1>${esc(t("Compared with bexio, row by row"))}</h1>
      <p class="sub">${esc(t("From CHF 5.– a month instead of 35.–, open source, works offline and free for non-profits."))}</p></div>
      ${chips([[Wallet, "CHF 5.– vs 35.–"], [Code, t("Open source")], [WifiOff, t("Works offline")], [HeartHandshake, t("Free for non-profits")]])}</div>`;
  } else if (kind === "demo") {
    body = `<div class="card light"><div class="crosses"></div><img class="mac" src="${MAC}" alt=""><div class="phone"><img src="${PHONE}" alt=""></div>
      ${brand}
      <div class="text" style="max-width:600px"><h1>${esc(t("A year of Swiss books, ready to explore"))}</h1>
      <p class="sub">${esc(t("Invoices, bills, payroll and bank statements of a demo agency — one click, nothing to set up."))}</p>
      <span class="cta">${esc(t("Open the demo"))} →</span></div></div>`;
  } else {
    const line = (m, path) => `<li><em class="${m.toLowerCase()}">${m}</em>${esc(path)}</li>`;
    body = `<div class="card dark"><div class="crosses"></div>
      <div class="code"><div class="bar"><span style="background:#f87171cc"></span><span style="background:#fcd34dcc"></span><span style="background:#34d399cc"></span></div><ol>
        ${line("GET", "/api/v1/invoices?status=open")}
        ${line("POST", "/api/v1/invoices/42/issue")}
        ${line("GET", "/api/v1/reports/vat")}
        ${line("POST", "/api/mcp")}<li class="note">tools/call → create_invoice</li>
        ${line("POST", "/api/compat/2.0/kb_invoice/search")}
      </ol></div>
      ${brand}
      <div class="text" style="max-width:600px"><h1>${esc(t("One API for all your books"))}</h1>
      <p class="sub">${esc(t("REST with OpenAPI, an MCP server for AI agents, and drop-in compatibility with your current accounting software."))}</p></div>
      ${chips([[Code, "REST + OpenAPI"], [Bot, t("MCP server")], [Plug, t("Compatibility API")]])}</div>`;
  }
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Cinzel:wght@700&family=Inter:wght@500;600;700&display=block">
    <style>${CSS}</style></head><body>${body}</body></html>`;
}

// ------------------------------------------------------------------ render

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const kind of ["home", "demo", "api", "vs"]) {
  for (const locale of LOCALES) {
    await tab.setContent(page(kind, locale), { waitUntil: "networkidle" });
    await tab.evaluate(() => document.fonts.ready);
    const file = join(out, `${kind}-${locale}.jpg`);
    await tab.screenshot({ path: file, type: "jpeg", quality: 90 });
    console.log(`  ${file.slice(pub.length + 1)}`);
  }
}
await browser.close();
