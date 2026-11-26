import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { apiAs, createWorkspace, E2EUser, newUser, signUp, tokenOf, trackPageErrors } from './helpers';

/**
 * Personal call and notification sounds in real Chromium: settings saved to
 * the account (they survive a reload), the chosen group ringtone for a real
 * incoming call, ONE ringing tab among two tabs of the same person (Web Locks
 * + BroadcastChannel), answering in one tab stopping the ring in both, and
 * Do Not Disturb. Audio really plays through Web Audio after a click (the
 * browser's autoplay rule); the engine announces every start/stop as a
 * `smartconnect:sound` event, which each tab records here.
 */

declare global {
  interface Window {
    __sounds?: { action: string; sound: string; loop: boolean }[];
  }
}

const joinViaLink = async (request: APIRequestContext, ownerToken: string, joinerToken: string, workspaceId: string, joiner: E2EUser) => {
  const owner = apiAs(request, ownerToken);
  const link = await (await owner.get(`/api/workspaces/${workspaceId}/invite-link`)).json();
  const token = new URL(link.url).searchParams.get('token');
  expect((await (await apiAs(request, joinerToken).post('/api/workspaces/join', { token })).json()).status).toBe('pending');
  const requests = await (await owner.get(`/api/workspaces/${workspaceId}/requests`)).json();
  const mine = requests.find((r: { user: { username: string } }) => r.user.username === joiner.username);
  expect((await owner.put(`/api/workspaces/${workspaceId}/requests/${mine.id}`, { action: 'APPROVE' })).ok()).toBeTruthy();
};

const recordSounds = (page: Page) =>
  page.addInitScript(() => {
    window.__sounds = [];
    window.addEventListener('smartconnect:sound', (e) => window.__sounds!.push((e as CustomEvent).detail));
  });
const sounds = (page: Page) => page.evaluate(() => window.__sounds ?? []);
const ringingIn = async (page: Page) => {
  const events = await sounds(page);
  const starts = events.filter((e) => e.loop && e.action === 'start').length;
  const stops = events.filter((e) => e.loop && e.action === 'stop').length;
  return starts - stops;
};
const banner = (page: Page) => page.locator('div.fixed').filter({ hasText: /Incoming (audio|video) call/ });

const openSoundSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Call & notification sounds' }).click();
  const dialog = page.getByRole('dialog', { name: 'Call & notification sounds' });
  await expect(dialog.getByText('Group calls', { exact: true })).toBeVisible();
  return dialog;
};
const row = (dialog: ReturnType<Page['getByRole']>, title: string) => dialog.locator('li').filter({ hasText: title });

test('call sounds: saved per account, one ringing tab, stopped everywhere on answer, silent with Do Not Disturb', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const alice = newUser('sndA');
  const bob = newUser('sndB');
  const a = await (await browser.newContext()).newPage();
  const bobContext = await browser.newContext(); // one browser profile, two tabs
  const b1 = await bobContext.newPage();
  const errors = [a, b1].map(trackPageErrors);

  await signUp(a, alice);
  const workspaceId = await createWorkspace(a, `Sounds ${alice.username.slice(-5)}`);
  const general = new URL(a.url()).pathname.split('/')[3];
  await signUp(b1, bob);
  await b1.waitForURL((url) => url.pathname !== '/login');
  await joinViaLink(request, await tokenOf(a), await tokenOf(b1), workspaceId, bob);

  await test.step('Bob picks a group ringtone; it is saved to his account', async () => {
    await b1.goto(`/${workspaceId}/c/${general}`);
    const dialog = await openSoundSettings(b1);
    await row(dialog, 'Group calls').getByRole('combobox').selectOption('classic');
    await row(dialog, 'Group calls').getByRole('slider').fill('40');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await b1.reload();
    const again = await openSoundSettings(b1);
    await expect(row(again, 'Group calls').getByRole('combobox')).toHaveValue('classic');
    await expect(row(again, 'Group calls').getByRole('slider')).toHaveValue('40');
    // Alice's own settings are untouched (per user).
    const mine = await (await apiAs(request, await tokenOf(a)).get('/api/users/me/sound-preferences')).json();
    expect(mine.isDefault).toBe(true);
    await again.getByRole('button', { name: 'Cancel' }).click();
  });

  const b2 = await bobContext.newPage();
  errors.push(trackPageErrors(b2));
  await test.step('two tabs, audio allowed in both (a click each, as the browser requires)', async () => {
    await recordSounds(b1);
    await recordSounds(b2);
    await b1.reload();
    await b2.goto(`/${workspaceId}/c/${general}`);
    for (const tab of [b1, b2]) {
      await expect(tab.getByRole('button', { name: 'Account menu' })).toBeVisible();
      await tab.mouse.click(5, 300);
    }
  });

  await test.step('a group call rings in exactly one of the two tabs, with the chosen ringtone', async () => {
    await a.getByTitle('Start audio call').click();
    await a.getByRole('button', { name: 'Start call' }).click();
    await expect(banner(b1)).toContainText('Incoming audio call');
    await expect(banner(b2)).toContainText('Incoming audio call');
    await expect.poll(async () => (await ringingIn(b1)) + (await ringingIn(b2)), { timeout: 10_000 }).toBe(1);
    await b1.waitForTimeout(1500); // and it stays one
    expect((await ringingIn(b1)) + (await ringingIn(b2))).toBe(1);
    const started = [...(await sounds(b1)), ...(await sounds(b2))].filter((e) => e.action === 'start');
    expect(started).toEqual([{ action: 'start', sound: 'classic', loop: true }]);
  });

  await test.step('declining in one tab stops the ringing and the banner in both', async () => {
    await banner(b2).getByRole('button', { name: /Decline/ }).click();
    await expect(banner(b1)).toHaveCount(0);
    await expect.poll(async () => (await ringingIn(b1)) + (await ringingIn(b2))).toBe(0);
    await a.getByTitle('End call').click();
    await expect(a.getByTitle('End call')).toHaveCount(0);
  });

  await test.step('Do Not Disturb: the next call shows, silently', async () => {
    const dialog = await openSoundSettings(b1);
    await dialog.getByRole('switch', { name: 'Do not disturb' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const before = (await sounds(b1)).length + (await sounds(b2)).length;
    await a.getByTitle('Start audio call').click();
    await a.getByRole('button', { name: 'Start call' }).click();
    await expect(banner(b1)).toContainText('Incoming audio call');
    await expect(banner(b2)).toContainText('Incoming audio call'); // the other tab got the new setting too
    await b1.waitForTimeout(1500);
    expect((await sounds(b1)).length + (await sounds(b2)).length).toBe(before);
  });

  for (const pageErrors of errors) expect(pageErrors).toEqual([]);
});
