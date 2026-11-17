import { APIResponse, expect, Page, Response, test } from '@playwright/test';

/**
 * Direct access and page refresh on the PRODUCTION build, served the way
 * Vercel serves it (playwright.hosting.config.ts → vercel-static-server.mjs,
 * which applies frontend/vercel.json). Without the SPA fallback every deep
 * link below answered Vercel's "404: NOT_FOUND" page — only "/" loaded.
 *
 * No backend runs: each check is that the host answers with the app (200,
 * HTML, security headers) and the app boots on that URL, including its
 * lazily loaded page chunk — not anything that needs data.
 */

const UUID = '3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70';
const ACTIVATION_TOKEN = 'A'.repeat(43); // the shape of a link token; valid nowhere

/** The host answered with the app itself. */
const expectApp = (response: Response | APIResponse | null, label: string) => {
  expect(response, label).not.toBeNull();
  expect(response!.status(), `${label}: status`).toBe(200);
  const headers = response!.headers();
  expect(headers['content-type'], `${label}: content type`).toContain('text/html');
  expect(headers['x-frame-options'], `${label}: X-Frame-Options`).toBe('DENY');
  expect(headers['x-content-type-options'], `${label}: X-Content-Type-Options`).toBe('nosniff');
  expect(headers['referrer-policy'], `${label}: Referrer-Policy`).toBe('strict-origin-when-cross-origin');
};

/** Any build file the page asks for that is not served (e.g. a chunk answered with HTML or 404). */
const watchBuildFiles = (page: Page) => {
  const failed: string[] = [];
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    const type = response.headers()['content-type'] ?? '';
    if (pathname.startsWith('/assets/') && (response.status() !== 200 || type.includes('text/html'))) failed.push(`${pathname} → ${response.status()} ${type}`);
  });
  return failed;
};

const signIn = (page: Page) => page.getByRole('button', { name: 'Sign In' });

test.describe('public pages: open directly, then refresh', () => {
  test('/login', async ({ page }) => {
    const failed = watchBuildFiles(page);
    expectApp(await page.goto('/login'), '/login');
    await expect(signIn(page)).toBeVisible();
    expectApp(await page.reload(), '/login refresh');
    await expect(page).toHaveURL(/\/login$/);
    await expect(signIn(page)).toBeVisible();
    expect(failed).toEqual([]);
  });

  test('/signup', async ({ page }) => {
    expectApp(await page.goto('/signup'), '/signup');
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    expectApp(await page.reload(), '/signup refresh');
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('/activate#token=… (the Team Lead / Member activation link)', async ({ page }) => {
    const failed = watchBuildFiles(page);
    expectApp(await page.goto(`/activate#token=${ACTIVATION_TOKEN}`), '/activate');
    await expect(page.getByRole('heading', { name: 'Activate your SmartConnect account' })).toBeVisible();
    await expect(page).toHaveURL(/\/activate$/); // the page takes the token out of the address bar
    expectApp(await page.reload(), '/activate refresh');
    // By design the token is gone after the first load, so a refresh shows the
    // page's own "incomplete link" notice — the app, not a host 404.
    await expect(page.getByRole('heading', { name: 'This activation link is incomplete' })).toBeVisible();
    expect(failed).toEqual([]);
  });

  test('/reset-password?token=…&id=… (the password-reset link)', async ({ page }) => {
    expectApp(await page.goto(`/reset-password?token=t&id=${UUID}`), '/reset-password');
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
    expectApp(await page.reload(), '/reset-password refresh');
    await expect(page).toHaveURL(/\/reset-password$/); // the page takes the token out of the address bar
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
  });

  test('/invite/<token> (the e-mail invitation link)', async ({ page }) => {
    expectApp(await page.goto(`/invite/${UUID}`), '/invite');
    // No backend here, so the invitation lookup fails — shown by the app's own page.
    await expect(page.getByRole('heading', { name: 'Invitation not valid' })).toBeVisible();
    expectApp(await page.reload(), '/invite refresh');
    await expect(page).toHaveURL(new RegExp(`/invite/${UUID}$`));
    await expect(page.getByRole('heading', { name: 'Invitation not valid' })).toBeVisible();
  });

  test('/join-workspace?token=… (the reusable workspace link) hands over to sign-in', async ({ page }) => {
    expectApp(await page.goto('/join-workspace?token=abc'), '/join-workspace');
    await expect(page).toHaveURL(/\/login\?joinToken=abc$/);
    await expect(signIn(page)).toBeVisible();
  });
});

test.describe('signed-in pages: open directly and refresh — the app boots and asks a visitor without a session to sign in', () => {
  for (const path of ['/admin', '/admin/users', '/dashboard', '/channels', `/${UUID}/home`, `/${UUID}/c/${UUID}`, `/${UUID}/settings`, `/${UUID}/projects/${UUID}`]) {
    test(path, async ({ page }) => {
      const failed = watchBuildFiles(page);
      expectApp(await page.goto(path), path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(signIn(page)).toBeVisible();
      // A refresh asks the host for the same deep URL again.
      expectApp(await page.goto(path), `${path} refresh`);
      await expect(signIn(page)).toBeVisible();
      expect(failed).toEqual([]);
    });
  }
});

test('build files are served as themselves; missing files are a real 404, never the HTML page', async ({ page, request }) => {
  await page.goto('/login');
  const entry = await page.locator('script[type="module"][src^="/assets/"]').getAttribute('src');
  const stylesheet = await page.locator('link[rel="stylesheet"][href^="/assets/"]').getAttribute('href');
  const served: [string, string][] = [
    [entry!, 'javascript'],
    [stylesheet!, 'text/css'],
    ['/manifest.webmanifest', 'manifest+json'],
    ['/sw.js', 'javascript'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/icons/icon-192.png', 'image/png'],
  ];
  for (const [path, type] of served) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain(type);
  }
  for (const path of ['/assets/index-0ld-chunk.js', '/assets/ActivateAccountPage-0ld.js', '/assets/', '/icons/missing.png', '/favicon-old.ico', '/robots.txt']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['content-type'] ?? '', path).not.toContain('text/html');
  }
});
