#!/usr/bin/env node
// Render src-tauri/icons/icon-source.svg → 1024×1024 PNG, then hand it to
// `pnpm tauri icon` so the official CLI produces every size + .ico + .icns
// that Tauri's bundler reads from tauri.conf.json.
//
// Why a custom script: ImageMagick / Inkscape are not assumed to be on the
// dev machine. @resvg/resvg-js is pure-WASM, no native build needed, and
// loads system fonts so the CJK character in the design renders correctly.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const svgPath = resolve(projectRoot, "src-tauri/icons/icon-source.svg");
const pngPath = resolve(projectRoot, "src-tauri/icons/icon-source.png");

console.log(`[icons] reading ${svgPath}`);
const svg = readFileSync(svgPath);

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1024 },
  font: {
    loadSystemFonts: true,
    // Fallback for the CJK glyph "账" — if the host has none of the named
    // fonts in the SVG, resvg falls back to the first CJK font it finds.
    defaultFontFamily: "Microsoft YaHei",
  },
  background: "rgba(0,0,0,0)",
});

const pngBuffer = resvg.render().asPng();
mkdirSync(dirname(pngPath), { recursive: true });
writeFileSync(pngPath, pngBuffer);
console.log(`[icons] wrote ${pngPath} (${pngBuffer.length} bytes)`);

console.log(`[icons] running: pnpm tauri icon ${pngPath}`);
execSync(`pnpm tauri icon "${pngPath}"`, {
  stdio: "inherit",
  cwd: projectRoot,
});

console.log("[icons] done — all sizes + .ico + .icns refreshed");
