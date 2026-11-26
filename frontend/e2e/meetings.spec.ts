import { Browser, expect, Page, test } from '@playwright/test';
import { acceptInvitationTo, apiAs, createWorkspace, newUser, signUp, tokenOf, trackPageErrors } from './helpers';

/**
 * Meeting scheduler, end to end with three real people in one workspace:
 * the organizer schedules a meeting in the UI and invites one colleague; the
 * colleague answers the invitation and both join the meeting room — the
 * existing call lobby and call (WebRTC through the meeting's own room); a
 * workspace member who was not invited cannot open the meeting; the
 * organizer ends it for everyone. Real API, LOCAL throwaway database.
 */

const userIdOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).id as string;
const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

/** Local "YYYY-MM-DD" and "HH:mm" in the page's own time zone, `minutes` from now. */
const localSoon = (page: Page, minutes: number) =>
  page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }, minutes);

test('scheduled meeting: invite, answer, join the room together; an uninvited member is refused; the organizer ends it', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [a, b, c] = [await newPage(browser), await newPage(browser), await newPage(browser)];
  const errors = [a, b, c].map(trackPageErrors);
  const [organizer, colleague, bystander] = [newUser('meetOrg'), newUser('meetInv'), newUser('meetOut')];

  await signUp(a, organizer);
  const workspaceId = await createWorkspace(a, `Meet ${organizer.username}`);
  for (const [page, person] of [[b, colleague], [c, bystander]] as const) {
    await signUp(page, person);
    await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();
    const token = await tokenOf(page);
    expect((await apiAs(request, await tokenOf(a)).post(`/api/workspaces/${workspaceId}/members`, { userId: userIdOf(token) })).status()).toBe(201);
    await acceptInvitationTo(request, token, workspaceId);
  }
  const title = `Design review ${Date.now()}`;
  let meetingId = '';

  await test.step('the organizer schedules a meeting from the sidebar and invites one colleague', async () => {
    await a.goto(`/${workspaceId}`);
    await a.getByRole('button', { name: 'Meetings', exact: true }).click();
    await a.waitForURL(new RegExp(`/${workspaceId}/meetings$`));
    await a.getByRole('button', { name: 'Schedule meeting' }).first().click();
    const form = a.getByRole('dialog', { name: 'Schedule a meeting' });
    await form.getByLabel('Title').fill(title);
    const soon = await localSoon(a, 3); // inside the 15-minute early-join window
    await form.getByLabel('Date').fill(soon.date);
    await form.getByLabel('Start time').fill(soon.time);
    await form.getByRole('textbox', { name: 'Search people' }).fill(colleague.username);
    await form.getByRole('checkbox', { name: new RegExp(colleague.username) }).click();
    await form.getByRole('button', { name: 'Schedule meeting' }).click();
    await a.waitForURL(new RegExp(`/${workspaceId}/meetings/[0-9a-f-]{36}$`));
    meetingId = new URL(a.url()).pathname.split('/').pop()!;
    await expect(a.getByRole('heading', { name: title })).toBeVisible();
    await expect(a.getByText(/1 going, 0 maybe, 1 not answered/)).toBeVisible(); // the organizer counts as going
  });

  await test.step('the colleague finds the invitation and accepts; the organizer sees it live', async () => {
    await b.goto(`/${workspaceId}/meetings?tab=invitations`);
    const row = b.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Accept' }).click();
    await expect(b.getByRole('listitem').filter({ hasText: title })).toHaveCount(0); // answered: no longer waiting
    await expect(a.getByText(/2 going, 0 maybe, 0 not answered/)).toBeVisible(); // pushed to the organizer's open page
  });

  await test.step('a workspace member who was not invited cannot see the meeting', async () => {
    expect((await apiAs(request, await tokenOf(c)).get(`/api/meetings/${meetingId}`)).status()).toBe(404);
    await c.goto(`/${workspaceId}/meetings/${meetingId}`);
    await expect(c.getByText('Meeting not found')).toBeVisible();
    await c.goto(`/${workspaceId}/meetings`);
    await expect(c.getByText(title)).toHaveCount(0);
  });

  await test.step('both join through the existing lobby and see each other in the room', async () => {
    for (const page of [a, b]) {
      if (page === b) await b.goto(`/${workspaceId}/meetings/${meetingId}`);
      await page.getByRole('button', { name: 'Join meeting' }).click();
      await page.getByRole('dialog', { name: `Video meeting · ${title}` }).getByRole('button', { name: 'Join meeting' }).click();
    }
    const roomA = a.getByRole('dialog', { name: `Meeting · ${title}` });
    const roomB = b.getByRole('dialog', { name: `Meeting · ${title}` });
    await expect(roomA.getByText(colleague.username).first()).toBeVisible({ timeout: 30_000 });
    await expect(roomB.getByText(organizer.username).first()).toBeVisible({ timeout: 30_000 });
    await expect(roomB.getByRole('button', { name: /End for everyone/ })).toHaveCount(0); // organizer control only
  });

  await test.step('the organizer ends the meeting for everyone', async () => {
    const roomA = a.getByRole('dialog', { name: `Meeting · ${title}` });
    await roomA.getByRole('button', { name: 'End for everyone' }).click();
    await roomA.getByRole('button', { name: 'Confirm: end for everyone' }).click();
    await expect(a.getByRole('dialog', { name: `Meeting · ${title}` })).toHaveCount(0);
    await expect(b.getByRole('dialog', { name: `Meeting · ${title}` })).toHaveCount(0);
    await expect(b.getByText('The organizer ended the meeting.')).toBeVisible();
    await b.goto(`/${workspaceId}/meetings?tab=past`);
    await expect(b.getByRole('listitem').filter({ hasText: title })).toContainText('Ended');
  });

  for (const pageErrors of errors) expect(pageErrors).toEqual([]);
});
