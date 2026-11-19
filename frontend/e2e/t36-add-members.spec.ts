import { Browser, expect, Page, test } from '@playwright/test';
import { apiAs, createWorkspace, logIn, newUser, signUp, tokenOf, trackPageErrors } from './helpers';

/**
 * T.36 — a Team Lead adds members to their workspace with no e-mail provider
 * (E2E runs with BREVO_API_KEY empty, like the local dev setup), from the
 * People page:
 *  - a new person: "Add members" → name/e-mail (role shown as Member) → a clear
 *    one-time result with the activation link and temporary password;
 *  - the new member activates (temporary password → own password), signs in,
 *    sees that workspace and not the lead's other one;
 *  - an existing account gets a workspace invitation it accepts — once; a
 *    second add says it is already a member;
 *  - e-mail invitations say plainly that no e-mail can be sent.
 */
const freshPage = async (browser: Browser) => (await browser.newContext()).newPage();
const UUID = '[0-9a-f-]{36}';

const openPeople = async (page: Page) => {
  await page.getByRole('button', { name: 'People', exact: true }).first().click();
  await page.waitForURL(/\/directory\?tab=People$/);
};

const readCredentials = async (page: Page) => {
  const shown = page.getByRole('dialog', { name: 'Member invitation' });
  await expect(shown.getByText(/only time/i)).toBeVisible();
  const values = shown.locator('code');
  const credentials = {
    activationUrl: (await values.nth(0).textContent())!.trim(),
    loginId: (await values.nth(1).textContent())!.trim(),
    temporaryPassword: (await values.nth(2).textContent())!.trim(),
  };
  await shown.getByRole('button', { name: 'Done' }).click();
  return credentials;
};

test('Team Lead adds members from the People page without e-mail; the member signs in to exactly that workspace', async ({ browser, request }) => {
  const lead = await freshPage(browser);
  const leadErrors = trackPageErrors(lead);
  const leadUser = newUser('t36lead');
  await signUp(lead, leadUser);
  const otherWorkspaceId = await createWorkspace(lead, `T36 Private ${Date.now()}`); // the member is never added here
  const workspaceName = `T36 Team ${Date.now()}`;
  const workspaceId = await createWorkspace(lead, workspaceName);
  const run = Date.now().toString(36);
  const memberEmail = `t36_member_${run}@example.test`;

  await test.step('1. People → Add members: a new account, role Member, a clear one-time result', async () => {
    await openPeople(lead);
    await lead.getByRole('button', { name: 'Add members' }).click();
    const form = lead.getByRole('dialog', { name: 'Add members' });
    await expect(form).toContainText('e-mailed to them when this server can send e-mail');
    await expect(form.getByLabel('Role')).toHaveValue('Member');
    await form.getByLabel('E-mail addresses').fill(memberEmail);
    await form.getByLabel('Display name (optional)').fill(`Mia ${run}`);
    await form.getByRole('button', { name: 'Add members' }).click();
    const result = lead.getByRole('dialog', { name: 'Member invitation' });
    // E2E runs without an e-mail provider: said plainly, and the details are shown to share.
    await expect(result).toContainText(`Account created for Mia ${run}. They join ${workspaceName} when they activate it — no e-mail was sent (e-mail delivery isn't configured).`);
  });
  const credentials = await readCredentials(lead);
  expect(credentials.loginId).toBe(memberEmail);

  const member = await freshPage(browser);
  const memberErrors = trackPageErrors(member);
  const newPassword = `Member-own-${run}-pass`;
  await test.step('2. the member cannot use the temporary password on the sign-in page; they activate and sign in', async () => {
    await logIn(member, { username: 'x', email: memberEmail, password: credentials.temporaryPassword });
    await expect(member.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(member).toHaveURL(/\/login$/);

    await member.goto(credentials.activationUrl);
    await member.getByLabel('Temporary password').fill(credentials.temporaryPassword);
    await member.getByLabel('New password', { exact: true }).fill(newPassword);
    await member.getByLabel('Confirm new password').fill(newPassword);
    await member.getByRole('button', { name: 'Activate account' }).click();
    await expect(member.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
    await member.getByRole('link', { name: 'Go to sign in' }).click();
    await logIn(member, { username: 'x', email: memberEmail, password: newPassword });
    await member.waitForURL(new RegExp(`/${UUID}/`));
  });

  await test.step('3. the member sees that workspace (as a Member) and cannot open the lead’s other workspace', async () => {
    const rail = member.getByRole('navigation', { name: 'Workspaces' });
    await expect(rail.getByRole('button', { name: new RegExp(workspaceName) })).toBeVisible();
    await expect(rail.getByRole('button', { name: /T36 Private/ })).toHaveCount(0);
    const api = apiAs(request, await tokenOf(member));
    const ids = ((await (await api.get('/api/workspaces')).json()) as { id: string; isDefault?: boolean }[]).filter((w) => !w.isDefault).map((w) => w.id);
    expect(ids).toEqual([workspaceId]);
    expect([403, 404]).toContain((await api.get(`/api/workspaces/${otherWorkspaceId}/channels`)).status());
    await member.goto(`/${otherWorkspaceId}/directory?tab=People`);
    await expect(member.getByRole('button', { name: 'Add members' })).toHaveCount(0);
    await expect(member.getByRole('list', { name: 'Workspace members' })).toHaveCount(0);
    // In their own workspace a Member gets no "Add members" either.
    await member.goto(`/${workspaceId}/directory?tab=People`);
    await expect(member.getByRole('list', { name: 'Workspace members' })).toBeVisible();
    await expect(member.getByRole('button', { name: 'Add members' })).toHaveCount(0);
  });

  await test.step('4. an existing account gets an invitation it accepts, once', async () => {
    const existing = await freshPage(browser);
    const existingUser = newUser('t36existing');
    await signUp(existing, existingUser);
    await existing.waitForURL(new RegExp(`/${UUID}/`));

    await openPeople(lead);
    await lead.getByRole('button', { name: 'Add members' }).click();
    const form = lead.getByRole('dialog', { name: 'Add members' });
    await form.getByLabel('E-mail addresses').fill(existingUser.email);
    await form.getByRole('button', { name: 'Add members' }).click();
    await expect(form.getByRole('list', { name: 'Results' })).toContainText('Already has an account — invitation created; they see it in SmartConnect and accept it there');
    await form.getByRole('button', { name: 'Done' }).click();
    await expect(form).toHaveCount(0);
    await expect(lead.getByRole('button', { name: `View profile of ${existingUser.username}` })).toHaveCount(0); // not until they accept

    await existing.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Workspace invitations (1)' }).click();
    await existing.getByRole('dialog', { name: 'Workspace invitations' }).getByRole('button', { name: `Accept invitation to ${workspaceName}` }).click();
    await existing.waitForURL(new RegExp(`/${workspaceId}/c/`));
    await lead.reload();
    await expect(lead.getByRole('button', { name: `View profile of ${existingUser.username}` })).toBeVisible();

    // A second add of the same account says it is already a member, and creates nothing.
    await lead.getByRole('button', { name: 'Add members' }).click();
    const again = lead.getByRole('dialog', { name: 'Add members' });
    await again.getByLabel('E-mail addresses').fill(existingUser.email);
    await again.getByRole('button', { name: 'Add members' }).click();
    await expect(again.getByRole('list', { name: 'Results' })).toContainText(`Already a member of ${workspaceName}`);
    await again.getByRole('button', { name: 'Done' }).click();
    const members = await (await apiAs(request, await tokenOf(lead)).get(`/api/workspaces/${workspaceId}/members?q=${encodeURIComponent(existingUser.username)}`)).json();
    expect(members.members.filter((m: { username: string }) => m.username === existingUser.username)).toHaveLength(1);
    await existing.context().close();
  });

  await test.step('5. e-mail invitations say no e-mail can be sent — never "sent"', async () => {
    await lead.goto(`/${workspaceId}/settings?tab=invitations`);
    await expect(lead.getByRole('note')).toContainText('E-mail invitations are unavailable');
    await lead.getByLabel('E-mail address').fill(`t36_invitee_${run}@example.test`);
    await lead.getByRole('button', { name: 'Create invitation' }).click();
    await expect(lead.getByText(/No e-mail was sent — e-mail delivery isn't configured on this server/)).toBeVisible();
    await expect(lead.getByText(/Invitation sent to/)).toHaveCount(0);
  });

  expect(leadErrors).toEqual([]);
  expect(memberErrors).toEqual([]);
});
