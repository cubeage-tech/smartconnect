import { expect, Page, test } from '@playwright/test';
import { acceptInvitationTo, API_URL, apiAs, createWorkspace, logIn, newUser, sendMessage, signOut, signUp, tokenOf, trackPageErrors } from './helpers';

/**
 * Production incident 2026-11-23 — "messages need a reload" and "another
 * person's messages appear after reloading". Separate browser contexts are
 * separate people; tabs of one context share one browser profile.
 */

const userIdOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).id as string;
const frameText = (payload: string | Buffer) => (typeof payload === 'string' ? payload : payload.toString('utf8'));

/** The accounts behind this tab's authenticated API calls, and every Socket.IO frame it receives (WebSocket or polling). */
const watchTab = (page: Page) => {
  const seen = { apiUsers: [] as string[], frames: [] as string[] };
  page.on('request', (req) => {
    if (!req.url().startsWith(`${API_URL}/api/`)) return;
    const auth = req.headers()['authorization'];
    if (auth?.startsWith('Bearer ')) seen.apiUsers.push(userIdOf(auth.slice(7)));
  });
  page.on('websocket', (ws) => ws.on('framereceived', (f) => seen.frames.push(frameText(f.payload))));
  page.on('response', async (res) => {
    if (!res.url().includes('/socket.io/') || res.request().method() !== 'GET') return;
    seen.frames.push(await res.text().catch(() => ''));
  });
  return seen;
};

/** A (owner) and B in a new workspace W; returns W's General URL and the users' tokens. */
const workspaceWithTwo = async (a: Page, b: Page, request: Parameters<typeof acceptInvitationTo>[0], label: string) => {
  const ua = newUser(`${label}a`);
  const ub = newUser(`${label}b`);
  await signUp(a, ua);
  const workspaceId = await createWorkspace(a, `RT ${ua.username}`);
  const general = new URL(a.url()).pathname;
  await signUp(b, ub);
  await expect(b.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();
  const tokenA = await tokenOf(a);
  const tokenB = await tokenOf(b);
  const bId = userIdOf(tokenB);
  expect((await apiAs(request, tokenA).post(`/api/workspaces/${workspaceId}/members`, { userId: bId })).status()).toBe(201);
  await acceptInvitationTo(request, tokenB, workspaceId);
  return { ua, ub, workspaceId, general, tokenA, tokenB, bId };
};

test('a person whose network blocks WebSockets still gets messages live (HTTP long-polling fallback)', async ({ browser, request }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errorsA = trackPageErrors(a);
  const errorsB = trackPageErrors(b);
  const { general } = await workspaceWithTwo(a, b, request, 'ws');

  // From now on every Socket.IO WebSocket handshake in B's browser is refused
  // (as by a proxy or firewall): the browser opens a real WebSocket to a closed
  // port instead, which errors before it ever opens. Plain HTTP still works.
  await ctxB.addInitScript(() => {
    const Native = window.WebSocket;
    const w = window as unknown as { __blockedWebSockets: number; WebSocket: typeof WebSocket };
    w.__blockedWebSockets = 0;
    const Blocked = function (url: string | URL, protocols?: string | string[]) {
      if (!String(url).includes('/socket.io/')) return new Native(url, protocols);
      w.__blockedWebSockets++;
      return new Native('ws://127.0.0.1:9/refused');
    } as unknown as typeof WebSocket;
    Object.assign(Blocked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    Blocked.prototype = Native.prototype;
    w.WebSocket = Blocked;
  });
  const polling: string[] = [];
  b.on('request', (req) => {
    if (/\/socket\.io\/\?.*transport=polling/.test(req.url())) polling.push(req.url());
  });
  await b.goto(general);
  await expect(b.locator('main h2').filter({ hasText: 'General' })).toBeVisible();
  await a.goto(general);

  const toB = `over polling ${Date.now()}`;
  await sendMessage(a, toB);
  await expect(b.locator('main').getByText(toB)).toBeVisible();
  expect(await b.evaluate(() => (window as unknown as { __blockedWebSockets: number }).__blockedWebSockets), 'B tried (and failed) to open a WebSocket').toBeGreaterThan(0);
  expect(polling.length, 'B fell back to HTTP long-polling').toBeGreaterThan(0);
  await expect(b.getByText('Connecting to SmartConnect…')).toHaveCount(0);

  // …and B can send over the same fallback.
  const fromB = `reply over polling ${Date.now()}`;
  await sendMessage(b, fromB);
  await expect(a.locator('main').getByText(fromB)).toBeVisible();
  await expect(b.getByText(/Not delivered yet/)).toHaveCount(0);
  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('separate people: live DM, no leak when switching conversations, and an outsider receives nothing', async ({ browser, request }) => {
  const [ctxA, ctxB, ctxC] = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [a, b, c] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxC.newPage()]);
  const errors = [trackPageErrors(a), trackPageErrors(b), trackPageErrors(c)];
  const { ub, workspaceId, general } = await workspaceWithTwo(a, b, request, 'dm');
  const uc = newUser('rtc');
  await signUp(c, uc);
  await expect(c.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();
  const watchC = watchTab(c);

  // People → profile (no optional profile fields set) → Message opens the DM.
  await a.goto(`/${workspaceId}/directory?tab=People`);
  await a.getByRole('button', { name: `View profile of ${ub.username}` }).click();
  const dialog = a.getByRole('dialog', { name: ub.username });
  await expect(dialog.getByText('Member ·', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Message' }).click();
  await a.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  const dm = new URL(a.url()).pathname;

  await b.goto(dm);
  await expect(b.locator('main [contenteditable="true"]').first()).toBeVisible();
  const secret = `dm only for b ${Date.now()}`;
  await sendMessage(a, secret);
  await expect(b.locator('main').getByText(secret)).toBeVisible();

  // B switches to General; A keeps writing in the DM.
  await b.getByRole('group', { name: 'Channels' }).getByRole('button', { name: /General/ }).click();
  await b.waitForURL(new RegExp(`${general}$`));
  const whileAway = `while b is in general ${Date.now()}`;
  await sendMessage(a, whileAway);
  const inGeneral = `general note ${Date.now()}`;
  await a.goto(general);
  await sendMessage(a, inGeneral);
  await expect(b.locator('main').getByText(inGeneral)).toBeVisible();
  await expect(b.locator('main').getByText(whileAway)).toHaveCount(0);
  await expect(b.locator('main').getByText(secret)).toHaveCount(0);
  // Back in the DM, everything is there, in order, without a reload.
  await b.getByRole('group', { name: 'Direct messages' }).getByRole('button').first().click();
  await b.waitForURL(new RegExp(`${dm}$`));
  await expect(b.locator('main').getByText(whileAway)).toBeVisible();
  await expect(b.locator('main').getByText(inGeneral)).toHaveCount(0);

  // The outsider never received any of it, live or by asking.
  await c.waitForTimeout(500);
  for (const text of [secret, whileAway, inGeneral]) expect(watchC.frames.join('\n')).not.toContain(text);
  const tokenC = await tokenOf(c);
  expect((await apiAs(request, tokenC).get(`/api/channels/${dm.split('/').pop()}/messages`)).status()).toBe(403);
  expect((await apiAs(request, tokenC).get(`/api/channels/${general.split('/').pop()}/messages`)).status()).toBe(403);
  await c.goto(dm);
  await expect(c.getByText(secret)).toHaveCount(0);

  for (const e of errors) expect(e).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
});

test('two tabs of ONE browser profile always show the same account — never a silent switch on reload', async ({ browser }) => {
  const ctx = await browser.newContext(); // one profile: tabs share the sign-in
  const t1 = await ctx.newPage();
  const t2 = await ctx.newPage();
  const ua = newUser('taba');
  const ub = newUser('tabb');
  const w1 = watchTab(t1);
  const w2 = watchTab(t2);

  // Tab 2 shows the login form first; tab 1 signs in as A.
  await t2.goto('/login');
  await signUp(t1, ua);
  await t1.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  const tokenA = await tokenOf(t1);
  const idA = userIdOf(tokenA);
  // Tab 2 follows the sign-in at once (it used to keep its stale form and could sign in as someone else).
  await t2.waitForURL(/\/c\/[0-9a-f-]{36}$/);

  // Signing out in tab 2 signs tab 1 out too.
  await signOut(t2);
  await t2.waitForURL(/\/login/);
  await t1.waitForURL(/\/login/);

  // Tab 2 signs in as B: tab 1 switches to B right away — not later, on a reload.
  w1.apiUsers.length = 0;
  w2.apiUsers.length = 0;
  await signUp(t2, ub);
  await t2.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  await t1.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  const idB = userIdOf(await tokenOf(t2));
  expect(idB).not.toBe(idA);
  await expect.poll(() => w1.apiUsers.length).toBeGreaterThan(0);
  expect(new Set(w1.apiUsers)).toEqual(new Set([idB]));
  expect(new Set(w2.apiUsers)).toEqual(new Set([idB]));

  // A reload changes nothing: still B, the same account the tab already showed.
  w1.apiUsers.length = 0;
  await t1.reload();
  await expect.poll(() => w1.apiUsers.length).toBeGreaterThan(0);
  expect(new Set(w1.apiUsers)).toEqual(new Set([idB]));

  // Switching back to A in tab 1 (sign out, sign in): both tabs are A again.
  await signOut(t1);
  await t1.waitForURL(/\/login/);
  await t2.waitForURL(/\/login/);
  await logIn(t1, ua);
  await t1.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  await t2.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  expect(userIdOf(await tokenOf(t2))).toBe(idA);
  await ctx.close();
});
