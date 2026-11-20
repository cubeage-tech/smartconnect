import { execFileSync } from 'node:child_process';
import { expect, Page, test } from '@playwright/test';
import { apiAs, createWorkspace, logIn, newUser, sendMessage, signUp, tokenOf } from './helpers';

/**
 * QA remediation — what only a real browser can show: layering, clipping,
 * sizes and focus. Real API, real UI, LOCAL throwaway database.
 */
const DB = process.env.E2E_DATABASE_URL ?? '';
const LOCAL_DB = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//;

/** An ACTIVE platform administrator created in the LOCAL E2E database (as in t34-admin-login.spec.ts). */
const createAdmin = () => {
  if (!LOCAL_DB.test(DB)) throw new Error('Refusing to touch a non-local database.');
  const admin = newUser('qaAdmin');
  execFileSync(process.env.E2E_PSQL ?? 'psql', [DB, '-v', 'ON_ERROR_STOP=1', '-qtA', '-v', `username=${admin.username}`, '-v', `email=${admin.email}`, '-v', `password=${admin.password}`], {
    input:
      `CREATE EXTENSION IF NOT EXISTS pgcrypto;\n` +
      `INSERT INTO "User" (id, username, email, password, role, "updatedAt") ` +
      `VALUES (gen_random_uuid()::text, :'username', :'email', crypt(:'password', gen_salt('bf', 12)), 'ADMIN', now()) RETURNING id;\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return admin;
};

/** True when the element is what a click at its centre would actually hit (nothing covers it). */
const onTop = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });

test('QA desktop: composer, reactions, drawer layering, team task refresh', async ({ page, request }) => {
  const lead = newUser('qaLead');
  await signUp(page, lead);
  const workspaceId = await createWorkspace(page, `QA ${lead.username}`);

  await test.step('M14: the composer shows its placeholder', async () => {
    const placeholder = await page.locator('main .ProseMirror p.is-editor-empty').first().evaluate((p) => getComputedStyle(p, '::before').content);
    expect(placeholder).toMatch(/Message #General/);
  });

  await test.step('L11: one focus ring — the editable area itself draws none', async () => {
    const editor = page.locator('main [contenteditable="true"]').first();
    await editor.click(); // an editable area matches :focus-visible whenever it has focus
    expect(await editor.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  });

  for (let i = 0; i < 6; i++) await sendMessage(page, `qa message ${i} https://example.com`);
  await expect(page.locator('main').getByText('qa message 5')).toBeVisible();

  await test.step('L10: a web address in a message is a link', async () => {
    await expect(page.locator('main a[href="https://example.com"]').first()).toBeVisible();
  });

  await test.step('L12: a channel opens at its very end — no "Jump to latest" over the newest message', async () => {
    await page.reload();
    await expect(page.locator('main').getByText('qa message 5')).toBeVisible();
    await page.waitForLoadState('networkidle'); // link previews and other late growth
    const scroller = page.locator('main [data-testid="virtuoso-scroller"], main [data-virtuoso-scroller]').first();
    await expect.poll(() => scroller.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
  });

  await test.step('H2 / M1: the reaction picker on the newest message is fully on screen and closes with Escape', async () => {
    const last = page.locator('main [role="article"]').last();
    await last.hover();
    await last.getByRole('button', { name: 'Add reaction' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a reaction' });
    await expect(picker).toBeVisible();
    const box = (await picker.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await onTop(page, '[role="dialog"][aria-label="Choose a reaction"]')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  });

  await test.step('L15: an edited message says "(edited)" next to its time', async () => {
    const mine = page.locator('main [role="article"]').filter({ hasText: 'qa message 5' }).first(); // the list is virtualised: use a rendered (recent) message
    await mine.hover();
    await mine.getByRole('button', { name: 'Edit message' }).click();
    await expect(mine.getByRole('toolbar', { name: 'Message actions' })).toHaveCount(0); // hidden while editing
    await page.keyboard.press('End');
    await page.keyboard.type(' (fixed)');
    await page.keyboard.press('Enter');
    await expect(page.locator('main').getByText('(edited)').first()).toBeVisible();
  });

  const token = await tokenOf(page);
  const me = await (await apiAs(request, token).get('/api/auth/me')).json();
  const created = await apiAs(request, token).post(`/api/workspaces/${workspaceId}/team-tasks`, { title: 'QA drawer task', assigneeId: me.id });
  expect(created.status()).toBe(201);

  await page.goto(`/${workspaceId}/team-tasks`);
  const row = page.getByRole('row').filter({ hasText: 'QA drawer task' });
  await expect(row).toBeVisible();

  await test.step('H1: the task drawer’s Close / Share / Delete are on top of the app header, and Close works', async () => {
    await row.getByRole('button', { name: /^Open / }).click();
    await expect(page.getByRole('button', { name: 'Close task' })).toBeVisible();
    for (const name of ['Close task', 'Share']) expect(await onTop(page, `button[aria-label="${name}"], button:has-text("${name}")`), name).toBe(true);
    await page.getByRole('button', { name: 'Close task' }).click();
    await expect(page.getByRole('button', { name: 'Close task' })).toHaveCount(0);
  });

  await test.step('M4: a status change in the drawer shows in the table without a reload', async () => {
    await row.getByRole('button', { name: /^Open / }).click();
    await page.locator('aside[role="dialog"]').getByRole('combobox', { name: 'Status', exact: true }).first().selectOption({ label: 'In progress' });
    await page.keyboard.press('Escape');
    await expect(row).toContainText('In progress');
  });

  await test.step('M2: a dialog’s backdrop covers the app header', async () => {
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('dialog', { name: 'Create task' })).toBeVisible();
    expect(await onTop(page, 'button[aria-label="Account menu"]')).toBe(false);
    await page.keyboard.press('Escape');
  });
});

test('QA admin: Add Team Lead button and dashboard chart labels', async ({ page }) => {
  const admin = createAdmin();
  await logIn(page, admin);
  await page.waitForURL(/\/admin$/);

  await test.step('M8: the chart’s Y-axis labels are inside the chart', async () => {
    const svg = page.locator('.recharts-wrapper svg').first();
    await expect(svg).toBeVisible();
    const left = (await svg.boundingBox())!.x;
    for (const tick of await page.locator('.recharts-yAxis text').all()) expect((await tick.boundingBox())!.x).toBeGreaterThanOrEqual(left - 0.5);
  });

  await test.step('H5: "Add Team Lead" fits on one line inside its button', async () => {
    await page.getByRole('button', { name: 'Team Management' }).first().click();
    const button = page.getByRole('button', { name: 'Add Team Lead' });
    await expect(button).toBeVisible();
    const fits = await button.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
    expect((await button.boundingBox())!.height).toBeLessThan(48);
  });
});

test('QA phone: header search and touch-only controls', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const member = newUser('qaPhone');
  await signUp(page, member);
  await page.waitForURL(/\/[0-9a-f-]{36}\//);
  const workspaceId = new URL(page.url()).pathname.split('/')[1];

  await page.goto(`/${workspaceId}/home`);
  await test.step('L24: no keyboard-shortcut button on a phone, and a short search placeholder', async () => {
    await expect(page.getByRole('button', { name: /Search and jump to anything/ })).toBeHidden();
    await expect(page.getByPlaceholder('Search messages', { exact: true })).toBeVisible();
  });

  await page.goto(`/${workspaceId}/chats`);
  await test.step('L24: Chats shows its own filter only (one search box)', async () => {
    await expect(page.getByPlaceholder('Filter conversations')).toBeVisible();
    await expect(page.getByPlaceholder('Search messages', { exact: true })).toBeHidden();
  });

  await test.step('no sideways scrolling on the phone pages checked', async () => {
    for (const path of ['home', 'chats', 'more']) {
      await page.goto(`/${workspaceId}/${path}`);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
  await context.close();
});

test('QA V1: a space typed after an emoji is kept', async ({ page }) => {
  const user = newUser('qaEmoji');
  await signUp(page, user);
  await createWorkspace(page, `QA emoji ${user.username}`);
  await sendMessage(page, 'wave 👋 then text');
  const shown = page.locator('main [role="article"]').filter({ hasText: 'then text' }).last();
  await expect(shown).toBeVisible();
  expect(await shown.locator('.rich-text').first().innerText()).toContain('👋 then text');
});

test('QA L34: workspace settings content is centred in the page', async ({ page }) => {
  const user = newUser('qaSettings');
  await signUp(page, user);
  const workspaceId = await createWorkspace(page, `QA settings ${user.username}`);
  await page.setViewportSize({ width: 1470, height: 835 });
  await page.goto(`/${workspaceId}/settings`);
  await expect(page.getByRole('tab', { name: /General/ })).toBeVisible();
  const gaps = await page.locator('main').evaluate((main) => {
    const frame = main.querySelector<HTMLElement>('.max-w-4xl') ?? main.firstElementChild as HTMLElement;
    const m = main.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return { left: f.left - m.left, right: m.right - f.right, width: f.width };
  });
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(24);
  expect(gaps.width).toBeGreaterThan(700);
});
