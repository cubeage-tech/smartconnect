import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Production-hosting checks: direct access to and refresh of deep links on
 * the PRODUCTION build, served the way Vercel serves it. No backend and no
 * database — nothing here needs data.
 *
 *   npm run test:hosting
 *
 * The app is built with `vite build` (what Vercel's Vite build produces) into
 * a temporary folder, so frontend/dist is left alone, and served by
 * e2e-hosting/vercel-static-server.mjs, which applies frontend/vercel.json.
 * Separate from playwright.config.ts (the full E2E suite, which needs a
 * database and serves the app from the Vite dev server — whose own SPA
 * fallback is exactly why it could never catch a hosting 404).
 */
const PORT = Number(process.env.HOSTING_PORT ?? 4190);
const OUT_DIR = process.env.HOSTING_DIST ?? join(tmpdir(), 'smartconnect-hosting-dist');
// The API is never reached: an unroutable origin means no API call can land on
// the static host (which would answer it with index.html).
const NO_API = 'http://127.0.0.1:9';

export default defineConfig({
  testDir: './e2e-hosting',
  outputDir: process.env.E2E_OUTPUT_DIR ?? 'test-results/hosting',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Every navigation and reload must reach the host (the app's service
    // worker never handles navigations anyway; this makes it certain).
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' } }],
  webServer: {
    command: `npx vite build --outDir "${OUT_DIR}" --emptyOutDir && node e2e-hosting/vercel-static-server.mjs`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { HOSTING_PORT: String(PORT), HOSTING_DIST: OUT_DIR, VITE_API_URL: NO_API, VITE_BACKEND_URL: NO_API },
  },
});
