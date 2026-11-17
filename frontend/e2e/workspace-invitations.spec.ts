import { Browser, expect, Page, test } from '@playwright/test';
import { API_URL, apiAs, createWorkspace, newUser, signUp, tokenOf, trackPageErrors } from './helpers';

/**
 * Team Lead → invitation → workspace membership, in real browsers:
 *  1. a Team Lead invites a new address from Workspace settings and gets the
 *     invitation's link (no e-mail provider here);
 *  2. the new person signs up from that link and lands in exactly that
 *     workspace — SmartConnect Collab and it, nothing else;
 *  3. an existing account gets the invitation in the app (workspace rail),
 *     live; accepting joins it;
 *  4. a second Team Lead's invitation is declined, then a new one accepted —
 *     the person now switches between all their workspaces;
 *  5. opening an invitation link while signed in asks first (Accept /
 *     Decline), and a workspace nobody invited them to stays closed.
 */

const freshPage = async (browser: Browser) => (await browser.newContext()).newPage();
const rail = (page: Page) => page.getByRole('navigation', { name: 'Workspaces' });
const railButton = (page: Page, name: string) => rail(page).getByRole('button', { name: new RegExp(`^${name}`) });
const invitationsButton = (page: Page, count: number) => rail(page).getByRole('button', { name: `Workspace invitations (${count})` });
const SIGNUP_FORM = (page: Page) => page.locator('form').filter({ has: page.getByRole('button', { name: 'Create Account' }) });

test('workspace invitations: new people sign up into the invited workspace; existing accounts accept or decline in the app and keep every membership', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const leadA = newUser('invA');
  const a = await freshPage(browser);
  const aErrors = trackPageErrors(a);
  await signUp(a, leadA);
  const apollo = `Apollo ${leadA.username.slice(-5)}`;
  const apolloId = await createWorkspace(a, apollo);
  const tokenA = await tokenOf(a);

  const leadB = newUser('invB');
  const b = await freshPage(browser);
  await signUp(b, leadB);
  const zeus = `Zeus ${leadB.username.slice(-5)}`;
  const zeusId = await createWorkspace(b, zeus);
  const tokenB = await tokenOf(b);

  const newcomer = newUser('invNew');
  let inviteLink = '';
  await test.step('1. the Team Lead invites a new address from Workspace settings and gets its invitation link', async () => {
    await a.goto(`/${apolloId}/settings?tab=invitations`);
    await a.getByLabel('E-mail address').fill(newcomer.email);
    await a.getByRole('button', { name: /^(Create invitation|Send invite)$/ }).click();
    const field = a.getByLabel(`Invitation link for ${newcomer.email}`);
    await expect(field).toBeVisible();
    inviteLink = await field.inputValue();
    expect(inviteLink).toMatch(/\/invite\/[0-9a-f-]{36}$/);
  });

  await test.step('2. the new person signs up from the link and lands in exactly that workspace', async () => {
    const page = await freshPage(browser);
    const errors = trackPageErrors(page);
    await page.goto(new URL(inviteLink).pathname);
    await page.waitForURL(/\/signup\?/);
    const form = SIGNUP_FORM(page);
    await expect(form.locator('input[type="email"]')).toHaveValue(newcomer.email.toLowerCase()); // invitations store the address normalized
    await form.getByPlaceholder('Samarth Karale').fill(newcomer.username);
    await form.locator('input[type="password"]').fill(newcomer.password);
    await form.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForURL(new RegExp(`/${apolloId}/c/[0-9a-f-]{36}$`));
    await expect(railButton(page, apollo)).toBeVisible();
    await expect(railButton(page, 'SmartConnect Collab')).toBeVisible();
    await expect(railButton(page, zeus)).toHaveCount(0); // never an unrelated workspace
    expect(errors).toEqual([]);
    await page.context().close();
  });

  const existing = newUser('invOld');
  const u = await freshPage(browser);
  const uErrors = trackPageErrors(u);
  await signUp(u, existing);
  await expect(railButton(u, 'SmartConnect Collab')).toBeVisible();

  await test.step('3. an existing account sees the invitation in the app at once and accepts it', async () => {
    expect((await apiAs(request, tokenA).post(`/api/workspaces/${apolloId}/invites`, { email: existing.email })).status()).toBe(201);
    await invitationsButton(u, 1).click(); // arrives live on the rail
    const dialog = u.getByRole('dialog', { name: 'Workspace invitations' });
    await expect(dialog.getByText(apollo)).toBeVisible();
    await dialog.getByRole('button', { name: `Accept invitation to ${apollo}` }).click();
    await u.waitForURL(new RegExp(`/${apolloId}/c/[0-9a-f-]{36}$`));
    await expect(railButton(u, apollo)).toBeVisible();
    await expect(invitationsButton(u, 1)).toHaveCount(0);
  });

  await test.step('4. a second Team Lead: decline, then accept a new invitation — every membership stays; switch between them', async () => {
    expect((await apiAs(request, tokenB).post(`/api/workspaces/${zeusId}/invites`, { email: existing.email })).status()).toBe(201);
    await invitationsButton(u, 1).click();
    await u.getByRole('dialog', { name: 'Workspace invitations' }).getByRole('button', { name: `Decline invitation to ${zeus}` }).click();
    await expect(u.getByText('No pending invitations.')).toBeVisible();
    await u.keyboard.press('Escape');
    await expect(railButton(u, zeus)).toHaveCount(0);

    expect((await apiAs(request, tokenB).post(`/api/workspaces/${zeusId}/invites`, { email: existing.email })).status()).toBe(201);
    await invitationsButton(u, 1).click();
    await u.getByRole('dialog', { name: 'Workspace invitations' }).getByRole('button', { name: `Accept invitation to ${zeus}` }).click();
    await u.waitForURL(new RegExp(`/${zeusId}/c/`));

    await railButton(u, apollo).click();
    await u.waitForURL(new RegExp(`/${apolloId}/`));
    await railButton(u, zeus).click();
    await u.waitForURL(new RegExp(`/${zeusId}/`));
    await railButton(u, 'SmartConnect Collab').click();
    await expect(u).not.toHaveURL(new RegExp(`/(${apolloId}|${zeusId})/`));
  });

  await test.step('5. a link opened while signed in asks first; a workspace nobody invited them to stays closed', async () => {
    const hera = await apiAs(request, tokenA).post('/api/workspaces', { name: `Hera ${leadA.username.slice(-5)}` });
    expect(hera.status()).toBe(201);
    const heraId = (await hera.json()).workspace.id as string;
    const userToken = await tokenOf(u);
    expect((await apiAs(request, userToken).get(`/api/workspaces/${heraId}/channels`)).status()).toBe(403);

    const issued = await apiAs(request, tokenA).post(`/api/workspaces/${heraId}/invites`, { email: existing.email });
    const link = (await issued.json()).inviteLink as string;
    await u.goto(new URL(link).pathname);
    await expect(u.getByRole('heading', { name: /^Join Hera/ })).toBeVisible();
    expect((await apiAs(request, userToken).get(`/api/workspaces/${heraId}/channels`)).status()).toBe(403); // opening granted nothing
    await u.getByRole('button', { name: 'Accept invitation' }).click();
    await u.waitForURL(new RegExp(`/${heraId}/c/`));
    const ids = ((await (await request.get(`${API_URL}/api/workspaces`, { headers: { Authorization: `Bearer ${userToken}` } })).json()) as { id: string }[]).map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining([apolloId, zeusId, heraId]));
  });

  expect(aErrors).toEqual([]);
  expect(uErrors).toEqual([]);
});
