import { execFileSync } from 'node:child_process';
import { Browser, expect, Locator, Page, test } from '@playwright/test';
import { newUser } from './helpers';

/**
 * Admin Panel theme switcher in a real browser at phone, narrow-phone, tablet
 * and desktop sizes: the control is visible without horizontal scrolling,
 * Light / Dark apply at once and survive a reload, and System follows the
 * operating system live. Runs against a LOCAL throwaway database only.
 */

const DB = process.env.E2E_DATABASE_URL ?? '';
const LOCAL_DB = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//;
const SHOTS = process.env.THEME_SHOTS_DIR;

const createAdmin = () => {
  if (!LOCAL_DB.test(DB)) throw new Error('Refusing to touch a non-local database.');
  const admin = newUser('themeadmin');
  execFileSync(
    process.env.E2E_PSQL ?? 'psql',
    [DB, '-v', 'ON_ERROR_STOP=1', '-qtA', '-v', `username=${admin.username}`, '-v', `email=${admin.email}`, '-v', `password=${admin.password}`],
    {
      input:
        `CREATE EXTENSION IF NOT EXISTS pgcrypto;\n` +
        `INSERT INTO "User" (id, username, email, password, role, "updatedAt") ` +
        `VALUES (gen_random_uuid()::text, :'username', :'email', crypt(:'password', gen_salt('bf', 12)), 'ADMIN', now());\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  return admin;
};

const VIEWPORTS = [
  { name: 'phone-375', width: 375, height: 812, touch: true, place: 'top bar' },
  { name: 'phone-320', width: 320, height: 640, touch: true, place: 'top bar' },
  { name: 'tablet-768', width: 768, height: 1024, touch: true, place: 'sidebar' },
  { name: 'desktop-1280', width: 1280, height: 800, touch: false, place: 'sidebar' },
] as const;

const openAdmin = async (browser: Browser, vp: (typeof VIEWPORTS)[number]) => {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const admin = createAdmin();
  await page.goto('/login');
  await page.getByRole('button', { name: 'Administrator console' }).click();
  await page.getByLabel('Administrator e-mail').fill(admin.email);
  await page.locator('input[type="password"]').fill(admin.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole('heading', { level: 1, name: /System Overview/ })).toBeVisible();
  return { context, page, errors };
};

/** The one switcher visible at this size (the other copy is display:none). */
const visibleSwitcher = (page: Page, vp: (typeof VIEWPORTS)[number]): Locator =>
  (vp.place === 'sidebar' ? page.getByRole('complementary', { name: 'Administration' }) : page.getByRole('banner')).getByRole('radiogroup', { name: 'Theme' });

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'));
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('smartconnect:theme'));

for (const vp of VIEWPORTS) {
  test(`admin theme switcher — ${vp.name} (${vp.place})`, async ({ browser }) => {
    const { context, page, errors } = await openAdmin(browser, vp);
    const theme = visibleSwitcher(page, vp);

    // Visible, inside the screen, exactly one on screen, and no sideways scrolling.
    await expect(theme).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toHaveCount(1);
    const box = (await theme.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    if (vp.place === 'top bar') {
      await expect(page.getByRole('banner').getByRole('button', { name: 'Sign out' })).toBeVisible();
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-light.png` });

    // Dark: applied at once, saved, and still there after a reload.
    await theme.getByRole('radio', { name: 'Dark' }).click();
    expect(await isDark(page)).toBe(true);
    expect(await stored(page)).toBe('dark');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /System Overview/ })).toBeVisible();
    expect(await isDark(page)).toBe(true);
    await expect(visibleSwitcher(page, vp).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-dark.png` });

    // System: follows the operating system, live.
    await visibleSwitcher(page, vp).getByRole('radio', { name: 'System' }).click();
    expect(await stored(page)).toBe('system');
    expect(await isDark(page)).toBe(false); // the context's OS setting is light
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => isDark(page)).toBe(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => isDark(page)).toBe(false);

    // Light survives a reload even on a dark OS.
    await page.emulateMedia({ colorScheme: 'dark' });
    await visibleSwitcher(page, vp).getByRole('radio', { name: 'Light' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /System Overview/ })).toBeVisible();
    expect(await isDark(page)).toBe(false);
    await expect(visibleSwitcher(page, vp).getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');

    // Keyboard: the radio group moves with the arrow keys.
    await visibleSwitcher(page, vp).getByRole('radio', { name: 'Light' }).focus();
    await page.keyboard.press('ArrowRight');
    expect(await stored(page)).toBe('dark');
    await expect(visibleSwitcher(page, vp).getByRole('radio', { name: 'Dark' })).toBeFocused();

    expect(errors).toEqual([]);
    await context.close();
  });
}
