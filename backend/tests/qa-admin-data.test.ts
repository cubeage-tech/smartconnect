import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { ensureSharedWorkspace } from '../lib/sharedWorkspace';
import { realUsers } from '../lib/systemAccounts';
import { createWorkspace } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';

/** QA M9 / M10 / M11 — the admin console's numbers and labels agree with each other and with the data. */
const as = (token: string) => ({ get: (path: string) => request(app).get(path).set(authHeader(token)) });

describe('QA M9 — user totals agree across admin pages', () => {
  it('the dashboard and the stats count people only, never the internal system accounts', async () => {
    await ensureSharedWorkspace(); // creates the internal system account
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const people = await prisma.user.count({ where: realUsers });
    expect(await prisma.user.count()).toBeGreaterThan(people); // the system account exists
    const analytics = await as(admin.token).get('/api/admin/analytics');
    expect(analytics.status).toBe(200);
    expect(analytics.body.totalUsers).toBe(people);
    const stats = await as(admin.token).get('/api/admin/stats');
    expect(stats.body.totalUsers).toBe(people);
    expect(stats.body.users.some((u: { email: string }) => u.email === 'system@smartconnect.internal')).toBe(false);
  });
});

describe('QA M10 — Channel Administration tells channels apart and shows archived ones', () => {
  it('each channel carries its workspace and archive state', async () => {
    const lead = await createAndLoginUser();
    const { workspaceId } = await createWorkspace(lead);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
    const archived = await prisma.channel.create({
      data: { name: `qa-archived-${Date.now()}`, workspaceId, createdBy: lead.user.id, archivedAt: new Date(), archivedById: lead.user.id },
    });
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const res = await as(admin.token).get('/api/channels/admin/all');
    expect(res.status).toBe(200);
    const row = res.body.find((c: { id: string }) => c.id === archived.id);
    expect(row.workspace).toEqual({ id: workspaceId, name: workspace.name });
    expect(row.archivedAt).not.toBeNull();
  });
});

describe('QA M11 — open workspace e-mail invitations are counted', () => {
  it('in the summary and in the workspace’s Pending column; expired and accepted ones are not', async () => {
    const lead = await createAndLoginUser();
    const { workspaceId } = await createWorkspace(lead);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
    await prisma.invitation.createMany({
      data: [
        { email: `open-${Date.now()}@example.test`, inviterId: lead.user.id, workspaceId },
        { email: `old-${Date.now()}@example.test`, inviterId: lead.user.id, workspaceId, createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
        { email: `done-${Date.now()}@example.test`, inviterId: lead.user.id, workspaceId, status: 'accepted' },
      ],
    });
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const summary = await as(admin.token).get('/api/company-overview/summary');
    expect(summary.body.workspaceInvitations.pending).toBeGreaterThanOrEqual(1);
    const list = await as(admin.token).get(`/api/company-overview/workspaces?q=${encodeURIComponent(workspace.name)}`);
    const item = list.body.workspaces.find((w: { id: string }) => w.id === workspaceId);
    expect(item.pendingInvitations).toBe(1);
  });
});

describe('QA L43 — the audit log can be filtered and names the people entries are about', () => {
  it('filters by action and by text, lists the action types, and adds the target user’s name', async () => {
    const { logAuditEvent } = await import('../lib/auditLog');
    const admin = await createAndLoginUser({ role: 'ADMIN' });
    const target = await createAndLoginUser();
    const tag = `qa-l43-${Date.now()}`;
    await logAuditEvent(admin.user.id, 'SUSPEND_USER', 'USER', target.user.id, `Suspended ${target.user.id} ${tag}`);
    await logAuditEvent(admin.user.id, 'DELETE_CHANNEL', 'CHANNEL', null, `Deleted a channel ${tag}`);

    const byText = await as(admin.token).get(`/api/admin/audit-logs?q=${tag}`);
    expect(byText.status).toBe(200);
    expect(byText.body.logs).toHaveLength(2);
    expect(byText.body.actions).toEqual(expect.arrayContaining(['SUSPEND_USER', 'DELETE_CHANNEL']));

    const byAction = await as(admin.token).get(`/api/admin/audit-logs?q=${tag}&action=SUSPEND_USER`);
    expect(byAction.body.logs).toHaveLength(1);
    expect(byAction.body.logs[0]).toMatchObject({ action: 'SUSPEND_USER', targetId: target.user.id, targetLabel: target.user.username });
    // The stored entry is unchanged.
    expect(byAction.body.logs[0].details).toContain(target.user.id);

    // Members never reach it.
    expect((await as(target.token).get('/api/admin/audit-logs')).status).toBe(403);
  });
});
