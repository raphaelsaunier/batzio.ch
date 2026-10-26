#!/usr/bin/env node
/**
 * Brand assets for the native apps, rendered from the web's coin artwork
 * (apps/web/public/brand) and the design tokens:
 *
 *   Apple    Batzio/Resources/Assets.xcassets (AppIcon, AppIconVision, CoinFront, CoinBack, AccentColor)
 *   Android  res/mipmap-<density>/ic_launcher_foreground.png, res/drawable-nodpi/coin_front|back.png
 *   Windows  Batzio.App/Assets/*.png (tiles, store logo, splash, coin)
 *
 * Run with `pnpm --filter @batzio/tokens brand` after changing the coin.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const repo = join(pkg, "..", "..");
const resolved = JSON.parse(readFileSync(join(pkg, "generated/tokens.resolved.json"), "utf8"));
const front = join(repo, "apps/web/public/brand/coin-front-720.png");
const back = join(repo, "apps/web/public/brand/coin-back-720.png");
const hex = (name, mode = "light") => resolved.color[name][mode].hex;

const write = async (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  // Palette-quantised PNGs (libimagequant) keep the apps small.
  const out = path.endsWith(".png") ? await sharp(data).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer() : data;
  writeFileSync(path, out);
  console.log(`wrote ${path.slice(repo.length + 1)}`);
};
const json = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);

/** Soft silver-blue background with a light from the upper left. */
function backdrop(size, rounded = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/>
        <stop offset="0.55" stop-color="${hex("background")}"/>
        <stop offset="1" stop-color="#C9D8EA"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${rounded}" ry="${rounded}" fill="url(#g)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png();
}

async function coin(file, size) {
  return sharp(file).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

/** Coin centred on the backdrop, with a soft shadow. */
async function icon(size, { scale = 0.78, rounded = 0, inset = 0 } = {}) {
  const inner = Math.round((size - inset * 2) * scale);
  const c = await coin(front, inner);
  const shadow = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><ellipse cx="${size / 2}" cy="${size / 2 + inner * 0.47}" rx="${inner * 0.36}" ry="${inner * 0.06}" fill="rgba(20,40,80,0.28)"/></svg>`) }])
    .blur(Math.max(1, size / 80))
    .png()
    .toBuffer();
  const base = await backdrop(size - inset * 2, rounded).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: base, left: inset, top: inset },
      { input: shadow, left: 0, top: 0 },
      { input: c, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2 - inner * 0.02) },
    ])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

const info = { author: "batzio", version: 1 };

// ---------------------------------------------------------------- Apple
const xc = join(repo, "apps/apple/Batzio/Resources/Assets.xcassets");
await json(join(xc, "Contents.json"), { info });

const appIcon = join(xc, "AppIcon.appiconset");
const macSizes = [16, 32, 128, 256, 512];
const images = [{ filename: "ios-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }];
await write(join(appIcon, "ios-1024.png"), await icon(1024, { scale: 0.74 }));
for (const s of macSizes) {
  for (const scale of [1, 2]) {
    const px = s * scale;
    const name = `mac-${s}@${scale}x.png`;
    // macOS icons are a rounded square with breathing room.
    await write(join(appIcon, name), await icon(px, { scale: 0.8, rounded: px * 0.18, inset: Math.round(px * 0.1) }));
    images.push({ filename: name, idiom: "mac", scale: `${scale}x`, size: `${s}x${s}` });
  }
}
await json(join(appIcon, "Contents.json"), { images, info });

const vision = join(xc, "AppIconVision.solidimagestack");
await json(join(vision, "Contents.json"), { info, layers: [{ filename: "Front.solidimagestacklayer" }, { filename: "Back.solidimagestacklayer" }] });
for (const [layer, png] of [
  ["Front", await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await coin(front, 720), left: 152, top: 152 }]).png().toBuffer()],
  ["Back", await backdrop(1024).toBuffer()],
]) {
  const dir = join(vision, `${layer}.solidimagestacklayer`);
  await json(join(dir, "Contents.json"), { info });
  await json(join(dir, "Content.imageset", "Contents.json"), { images: [{ filename: `${layer.toLowerCase()}.png`, idiom: "vision", scale: "2x" }], info });
  await write(join(dir, "Content.imageset", `${layer.toLowerCase()}.png`), png);
}

for (const [name, file] of [["CoinFront", front], ["CoinBack", back]]) {
  const dir = join(xc, `${name}.imageset`);
  await write(join(dir, `${name}.png`), await coin(file, 720));
  await json(join(dir, "Contents.json"), { images: [{ filename: `${name}.png`, idiom: "universal", scale: "3x" }], info });
}

const rgb = (h) => ({ red: `0x${h.slice(1, 3)}`, green: `0x${h.slice(3, 5)}`, blue: `0x${h.slice(5, 7)}`, alpha: "1.000" });
await json(join(xc, "AccentColor.colorset", "Contents.json"), {
  colors: [
    { color: { "color-space": "srgb", components: rgb(hex("primary")) }, idiom: "universal" },
    { appearances: [{ appearance: "luminosity", value: "dark" }], color: { "color-space": "srgb", components: rgb(hex("primary", "dark")) }, idiom: "universal" },
  ],
  info,
});

// ---------------------------------------------------------------- Android
const res = join(repo, "apps/android/app/src/main/res");
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, f] of Object.entries(densities)) {
  const size = Math.round(108 * f);
  const inner = Math.round(size * 0.5);
  const fg = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await coin(front, inner), left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await write(join(res, `mipmap-${d}`, "ic_launcher_foreground.png"), fg);
}
await write(join(res, "drawable-nodpi", "coin_front.png"), await coin(front, 512));
await write(join(res, "drawable-nodpi", "coin_back.png"), await coin(back, 512));
await write(
  join(res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated by packages/tokens/scripts/brand.mjs -->\n<resources>\n    <color name="ic_launcher_background">${hex("background")}</color>\n</resources>\n`,
);

// ---------------------------------------------------------------- Windows
const win = join(repo, "apps/windows/Batzio.App/Assets");
const tile = async (w, h, coinScale = 0.7) => {
  const inner = Math.round(Math.min(w, h) * coinScale);
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await coin(front, inner), left: Math.round((w - inner) / 2), top: Math.round((h - inner) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
};
await write(join(win, "Square44x44Logo.scale-200.png"), await tile(88, 88, 0.9));
await write(join(win, "Square44x44Logo.targetsize-24_altform-unplated.png"), await tile(24, 24, 1));
await write(join(win, "Square150x150Logo.scale-200.png"), await tile(300, 300));
await write(join(win, "Wide310x150Logo.scale-200.png"), await tile(620, 300));
await write(join(win, "StoreLogo.png"), await tile(50, 50, 0.95));
await write(join(win, "SplashScreen.scale-200.png"), await tile(1240, 600, 0.5));
await write(join(win, "LockScreenLogo.scale-200.png"), await tile(48, 48, 0.95));
await write(join(win, "CoinFront.png"), await coin(front, 512));
await write(join(win, "CoinBack.png"), await coin(back, 512));
await write(join(win, "AppIcon.ico.png"), await icon(256, { scale: 0.8, rounded: 46, inset: 16 }));
