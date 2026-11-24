#!/usr/bin/env node
/**
 * Derives SmartConnect's display and icon images from the official logo,
 * public/logo.png, which is the master and is never modified. Everything
 * here is a crop of the original artwork plus high-quality downscaling: no
 * recolouring, no redrawing. It uses the Chromium that Playwright already
 * installs (`npx playwright install chromium`), so there is no image-library
 * dependency.
 *
 * Re-run after replacing public/logo.png, from frontend/:
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Writes:
 *   public/brand/smartconnect-logo.png         the full logo (emblem, wordmark, tagline), empty margins trimmed
 *   public/brand/smartconnect-mark.png         the "S" emblem alone, centred on a transparent square
 *   public/icons/favicon-16.png, favicon-32.png               browser tab
 *   public/icons/smartconnect-apple-180.png                    iOS home screen (opaque white: iOS fills transparency with black)
 *   public/icons/smartconnect-192.png, smartconnect-512.png    installed app, purpose "any" (transparent)
 *   public/icons/smartconnect-maskable-192.png, -512.png       installed app, purpose "maskable" (white, emblem inside the 80% safe zone)
 *
 * The icons have new file names on purpose: public/sw.js caches /icons/
 * cache-first by URL, on the rule that a URL's content never changes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'public', 'logo.png');
// The master logo is not committed to the repository: put the official file there first.
if (!existsSync(source)) {
  console.error('public/logo.png not found. Place the official SmartConnect logo (the master PNG) there, then run this again.');
  process.exit(1);
}

// Output heights/sizes in device pixels, for 3x screens: the full logo is
// shown at most 64 CSS px tall and the mark at most 44 px (Brand.tsx).
const FULL_HEIGHT = 192;
const MARK_SIZE = 144;
const ICONS = [
  { file: 'icons/favicon-16.png', size: 16, scale: 1, background: null },
  { file: 'icons/favicon-32.png', size: 32, scale: 1, background: null },
  { file: 'icons/smartconnect-apple-180.png', size: 180, scale: 0.72, background: '#ffffff' },
  { file: 'icons/smartconnect-192.png', size: 192, scale: 0.84, background: null },
  { file: 'icons/smartconnect-512.png', size: 512, scale: 0.84, background: null },
  // Maskable: the platform may crop to a circle of radius 40% — at 58% height
  // the emblem's whole box stays inside it.
  { file: 'icons/smartconnect-maskable-192.png', size: 192, scale: 0.58, background: '#ffffff' },
  { file: 'icons/smartconnect-maskable-512.png', size: 512, scale: 0.58, background: '#ffffff' },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const outputs = await page.evaluate(
    async ({ b64, FULL_HEIGHT, MARK_SIZE, ICONS }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const { width: w, height: h } = img;
      const src = document.createElement('canvas');
      src.width = w;
      src.height = h;
      const sctx = src.getContext('2d');
      sctx.drawImage(img, 0, 0);
      const alpha = sctx.getImageData(0, 0, w, h).data;
      const visible = (x, y) => alpha[(y * w + x) * 4 + 3] > 8;

      // Column runs of visible pixels: emblem, divider, wordmark letters…
      const runs = [];
      let start = -1;
      for (let x = 0; x <= w; x++) {
        let on = false;
        if (x < w) for (let y = 0; y < h && !on; y++) on = visible(x, y);
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          runs.push([start, x - 1]);
          start = -1;
        }
      }
      const box = (x0, x1) => {
        let top = h, bottom = -1;
        for (let y = 0; y < h; y++)
          for (let x = x0; x <= x1; x++)
            if (visible(x, y)) {
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
              break;
            }
        return { x: x0, y: top, w: x1 - x0 + 1, h: bottom - top + 1 };
      };
      // Expected layout: a wide emblem, then a thin divider, then the wordmark.
      const [emblemRun, dividerRun] = runs;
      if (!emblemRun || !dividerRun || emblemRun[1] - emblemRun[0] < 100 || dividerRun[1] - dividerRun[0] > 30) {
        throw new Error(`Unexpected logo layout (column runs: ${JSON.stringify(runs.slice(0, 4))}); check public/logo.png`);
      }
      const emblem = box(emblemRun[0], emblemRun[1]);
      const all = box(runs[0][0], runs[runs.length - 1][1]);

      /** Draws a region scaled to (dw, dh), halving in steps so large reductions stay smooth. */
      const scaled = (region, dw, dh) => {
        let canvas = document.createElement('canvas');
        canvas.width = region.w;
        canvas.height = region.h;
        canvas.getContext('2d').drawImage(src, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
        while (canvas.width / 2 >= dw && canvas.height / 2 >= dh) {
          const half = document.createElement('canvas');
          half.width = Math.round(canvas.width / 2);
          half.height = Math.round(canvas.height / 2);
          const ctx = half.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(canvas, 0, 0, half.width, half.height);
          canvas = half;
        }
        const out = document.createElement('canvas');
        out.width = dw;
        out.height = dh;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, dw, dh);
        return out;
      };
      /** The emblem centred on a square canvas, its taller side `scale` of the square. */
      const square = (size, scale, background) => {
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const ctx = out.getContext('2d');
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, size, size);
        }
        const k = (size * scale) / Math.max(emblem.w, emblem.h);
        const dw = Math.max(1, Math.round(emblem.w * k));
        const dh = Math.max(1, Math.round(emblem.h * k));
        ctx.drawImage(scaled(emblem, dw, dh), Math.round((size - dw) / 2), Math.round((size - dh) / 2));
        return out;
      };
      const png = (canvas) => canvas.toDataURL('image/png').split(',')[1];

      // Full logo: trimmed to its artwork, with a 2% margin so edges stay soft.
      const pad = Math.round(all.h * 0.02);
      const full = { x: Math.max(0, all.x - pad), y: Math.max(0, all.y - pad) };
      full.w = Math.min(w, all.x + all.w + pad) - full.x;
      full.h = Math.min(h, all.y + all.h + pad) - full.y;
      const fullWidth = Math.round((full.w * FULL_HEIGHT) / full.h);

      return {
        layout: { source: [w, h], artwork: all, emblem, fullRatio: full.w / full.h },
        files: [
          { file: 'brand/smartconnect-logo.png', data: png(scaled(full, fullWidth, FULL_HEIGHT)) },
          { file: 'brand/smartconnect-mark.png', data: png(square(MARK_SIZE, 0.96, null)) },
          ...ICONS.map((icon) => ({ file: icon.file, data: png(square(icon.size, icon.scale, icon.background)) })),
        ],
      };
    },
    { b64: readFileSync(source).toString('base64'), FULL_HEIGHT, MARK_SIZE, ICONS }
  );

  for (const { file, data } of outputs.files) {
    const target = join(root, 'public', file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(data, 'base64'));
    console.log(`wrote public/${file}`);
  }
  console.log(JSON.stringify(outputs.layout));
} finally {
  await browser.close();
}
