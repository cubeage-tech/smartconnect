import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { addToWorkspace, createDM, createWorkspace, seedMessage } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';

/** QA M12 — the workspace rail learns which other workspaces have unread messages. */
const unreadOf = async (token: string) => {
  const res = await request(app).get('/api/me/unread-by-workspace').set(authHeader(token));
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toMatch(/no-store/);
  return Object.fromEntries((res.body.workspaces as { workspaceId: string; unread: number }[]).map((w) => [w.workspaceId, w.unread]));
};

describe('QA M12 — unread messages per workspace', () => {
  it('counts a DM waiting in another workspace, only for the person it is for, and clears once read', async () => {
    const lead = await createAndLoginUser();
    const { workspaceId: other } = await createWorkspace(lead);
    const member = await createAndLoginUser();
    await addToWorkspace(member, other);
    const outsider = await createAndLoginUser();

    expect((await unreadOf(member.token))[other]).toBeUndefined();
    const dm = await createDM(lead, member, other);
    const message = await seedMessage(dm.id, other, lead.user.id, '<p>are you free?</p>');

    expect((await unreadOf(member.token))[other]).toBe(1);
    expect((await unreadOf(lead.token))[other]).toBeUndefined(); // your own messages are never unread
    expect((await unreadOf(outsider.token))[other]).toBeUndefined(); // no access, no count

    await request(app).post(`/api/channels/${dm.id}/read`).set(authHeader(member.token)).send({ messageId: message.id });
    expect((await unreadOf(member.token))[other]).toBeUndefined();
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/me/unread-by-workspace')).status).toBe(401);
  });
});

describe('QA L25 — the channel list has one stable order', () => {
  it('lists a workspace’s channels by name, the same on every load', async () => {
    const lead = await createAndLoginUser();
    const { workspaceId } = await createWorkspace(lead);
    for (const name of ['zeta', 'alpha', 'mid']) {
      const res = await request(app).post('/api/channels').set(authHeader(lead.token)).send({ name, workspaceId });
      expect(res.status).toBe(201);
    }
    const names = async () => ((await request(app).get(`/api/workspaces/${workspaceId}/channels`).set(authHeader(lead.token))).body as { name: string }[]).map((c) => c.name);
    const first = await names();
    expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b)));
    expect(await names()).toEqual(first);
  });
});
