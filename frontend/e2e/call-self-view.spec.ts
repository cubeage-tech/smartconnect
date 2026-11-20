import { APIRequestContext, Browser, expect, Page, test } from '@playwright/test';
import { apiAs, createWorkspace, E2EUser, newUser, signUp, tokenOf, trackPageErrors } from './helpers';

/**
 * Regression: in a video call people saw everyone else but not themselves.
 * Real Chromium with a fake camera (playwright.config.ts launch flags): your
 * own tile must actually render camera frames — alone while waiting, and next
 * to the other person once they join.
 */

const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

/** Joins `joiner` to a workspace through the existing invite-link + approval API (setup only). */
const joinViaLink = async (request: APIRequestContext, ownerToken: string, joinerToken: string, workspaceId: string, joiner: E2EUser) => {
  const owner = apiAs(request, ownerToken);
  const link = await (await owner.get(`/api/workspaces/${workspaceId}/invite-link`)).json();
  const token = new URL(link.url).searchParams.get('token');
  expect((await (await apiAs(request, joinerToken).post('/api/workspaces/join', { token })).json()).status).toBe('pending');
  const requests = await (await owner.get(`/api/workspaces/${workspaceId}/requests`)).json();
  const mine = requests.find((r: { user: { username: string } }) => r.user.username === joiner.username);
  expect((await owner.put(`/api/workspaces/${workspaceId}/requests/${mine.id}`, { action: 'APPROVE' })).ok()).toBeTruthy();
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Size of the frames a tile's <video> is actually rendering (0×0 = nothing to show). */
const frameSize = (page: Page, name: string) =>
  page
    .getByRole('dialog', { name: 'Video call' })
    .locator('div', { has: page.locator('span', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) })
    .locator('video')
    .last()
    .evaluate((video: HTMLVideoElement) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      live: (video.srcObject as MediaStream | null)?.getVideoTracks().some((t) => t.readyState === 'live') ?? false,
    }));

/** The tile has a live camera track AND is rendering its frames (a remote video's first frames take a moment). */
const showsFrames = (page: Page, name: string) =>
  expect
    .poll(async () => {
      const { width, height, live } = await frameSize(page, name);
      return live && width > 0 && height > 0;
    }, { message: `${name} should be rendering camera frames`, timeout: 30_000 })
    .toBe(true);

test('video call: you see yourself — alone while waiting, and next to the other person', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [a, b] = [await newPage(browser), await newPage(browser)];
  const errors = [a, b].map(trackPageErrors);
  const alice = newUser('selfA');
  const bob = newUser('selfB');

  await signUp(a, alice);
  const workspaceId = await createWorkspace(a, `Self view ${alice.username.slice(-5)}`);
  const general = new URL(a.url()).pathname.split('/')[3];
  await signUp(b, bob);
  await b.waitForURL((url) => url.pathname !== '/login'); // signed in before reading the session
  await joinViaLink(request, await tokenOf(a), await tokenOf(b), workspaceId, bob);
  await b.goto(`/${workspaceId}`);
  await b.waitForURL(new RegExp(`/${workspaceId}/c/${general}$`));

  await test.step('alone in the call: your own camera is on screen', async () => {
    await a.getByTitle('Start video call').click();
    await a.getByRole('button', { name: 'Start call' }).click();
    await expect(a.getByText('Waiting for others to join…').first()).toBeVisible({ timeout: 20_000 });
    await showsFrames(a, `${alice.username} (You)`);
  });

  await test.step('with someone else: both people see themselves and each other', async () => {
    await expect(b.getByText(/Incoming video call/)).toBeVisible();
    await b.getByRole('button', { name: /Accept/ }).click();
    await b.getByRole('button', { name: 'Join call' }).click();
    await showsFrames(b, `${bob.username} (You)`);
    await showsFrames(b, alice.username);
    await showsFrames(a, bob.username);
    await showsFrames(a, `${alice.username} (You)`);
  });

  await test.step('camera off, then on again: your own video comes back', async () => {
    await a.getByRole('button', { name: 'Turn camera off' }).click();
    await a.getByRole('button', { name: 'Turn camera on' }).click();
    await showsFrames(a, `${alice.username} (You)`);
  });

  for (const pageErrors of errors) expect(pageErrors).toEqual([]);
});
