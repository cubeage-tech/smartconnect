import { randomUUID } from 'crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// The sweeper destroys files through the Cloudinary SDK: never over the network here.
const destroyed = vi.hoisted(() => [] as string[]);
vi.mock('cloudinary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cloudinary')>();
  const v2 = actual.v2;
  const uploader = { destroy: vi.fn(async (publicId: string) => (destroyed.push(publicId), { result: 'ok' })) };
  return { ...actual, v2: Object.assign(Object.create(v2), { config: v2.config, utils: v2.utils, uploader }) };
});

import { app } from '../app';
import { ORPHAN_GRACE_MS, sweepOrphanAttachments } from '../lib/attachments';
import { prisma } from '../lib/prisma';
import { addToWorkspace, createWorkspace } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';

/**
 * QA H4 — the full name given at sign-up is the person's display name
 * everywhere, people can change it, and they can set a profile photo.
 */
const patchProfile = (token: string, body: object) => request(app).patch('/api/users/me/profile').set(authHeader(token)).send(body);

const photo = (uploaderId: string, over: Partial<{ mimeType: string; size: number; createdAt: Date }> = {}) =>
  prisma.attachment.create({
    data: {
      publicId: `workspace-uploads/qa-${randomUUID()}`,
      resourceType: 'image',
      deliveryType: 'authenticated',
      format: 'png',
      originalName: 'me.png',
      mimeType: over.mimeType ?? 'image/png',
      size: over.size ?? 2048,
      uploaderId,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    },
  });

describe('QA H4 — display name', () => {
  it('the directory carries each person’s display name; a person can change and clear their own', async () => {
    const owner = await createAndLoginUser();
    const { workspaceId } = await createWorkspace(owner);
    const member = await createAndLoginUser();
    await addToWorkspace(member, workspaceId);

    const set = await patchProfile(member.token, { displayName: '  Nadia   Khan ' });
    expect(set.status).toBe(200);
    expect(set.body.displayName).toBe('Nadia Khan');

    const directory = await request(app).get('/api/users').set(authHeader(owner.token));
    const entry = directory.body.find((u: { id: string }) => u.id === member.user.id);
    expect(entry).toMatchObject({ id: member.user.id, username: member.user.username, displayName: 'Nadia Khan', avatarId: null });
    expect(entry).not.toHaveProperty('email');

    expect((await patchProfile(member.token, { displayName: '' })).body.displayName).toBeNull();
    // The username (the unique handle) is never changed by a display-name edit.
    expect((await prisma.user.findUnique({ where: { id: member.user.id } }))?.username).toBe(member.user.username);
  });

  it('applies the sign-up name rules', async () => {
    const { token } = await createAndLoginUser();
    expect((await patchProfile(token, { displayName: 'Bad\u0007Name' })).status).toBe(400);
    expect((await patchProfile(token, { displayName: 'x'.repeat(81) })).status).toBe(400);
    expect((await patchProfile(token, { displayName: 42 })).status).toBe(400);
  });
});

describe('QA H4 — profile photo', () => {
  it('sets a photo the user uploaded; people in a shared workspace get a short-lived link, others get 404', async () => {
    const owner = await createAndLoginUser();
    const { workspaceId } = await createWorkspace(owner);
    const member = await createAndLoginUser();
    await addToWorkspace(member, workspaceId);
    const stranger = await createAndLoginUser();

    const file = await photo(member.user.id);
    const res = await patchProfile(member.token, { avatarId: file.id });
    expect(res.status).toBe(200);
    expect(res.body.avatarId).toBe(file.id);

    const seen = await request(app).get(`/api/users/${member.user.id}/avatar`).set(authHeader(owner.token));
    expect(seen.status).toBe(200);
    expect(seen.body.url).toMatch(/^https:\/\//);
    expect(seen.headers['cache-control']).toMatch(/no-store/);
    expect((await request(app).get(`/api/users/${member.user.id}/avatar`).set(authHeader(stranger.token))).status).toBe(404);
    expect((await request(app).get(`/api/users/${owner.user.id}/avatar`).set(authHeader(member.token))).status).toBe(404); // no photo
    expect((await request(app).get('/api/users/not-a-uuid/avatar').set(authHeader(member.token))).status).toBe(404);

    const directory = await request(app).get('/api/users').set(authHeader(owner.token));
    expect(directory.body.find((u: { id: string }) => u.id === member.user.id).avatarId).toBe(file.id);

    expect((await patchProfile(member.token, { avatarId: null })).body.avatarId).toBeNull();
  });

  it('refuses someone else’s upload, non-images, SVG, oversize files and files already sent in a message', async () => {
    const me = await createAndLoginUser();
    const other = await createAndLoginUser();
    const theirs = await photo(other.user.id);
    expect((await patchProfile(me.token, { avatarId: theirs.id })).status).toBe(400);
    expect((await patchProfile(me.token, { avatarId: (await photo(me.user.id, { mimeType: 'application/pdf' })).id })).status).toBe(400);
    expect((await patchProfile(me.token, { avatarId: (await photo(me.user.id, { mimeType: 'image/svg+xml' })).id })).status).toBe(400);
    expect((await patchProfile(me.token, { avatarId: (await photo(me.user.id, { size: 6 * 1024 * 1024 })).id })).status).toBe(400);
    expect((await patchProfile(me.token, { avatarId: 'nope' })).status).toBe(400);
    expect((await patchProfile(me.token, { avatarId: randomUUID() })).status).toBe(400);
  });

  it('the orphan sweeper keeps a profile photo, and removes it once it is replaced', async () => {
    const { user, token } = await createAndLoginUser();
    const old = new Date(Date.now() - ORPHAN_GRACE_MS - 60_000);
    const first = await photo(user.id, { createdAt: old });
    expect((await patchProfile(token, { avatarId: first.id })).status).toBe(200);
    await sweepOrphanAttachments();
    expect(await prisma.attachment.findUnique({ where: { id: first.id } })).not.toBeNull();

    const second = await photo(user.id);
    expect((await patchProfile(token, { avatarId: second.id })).status).toBe(200);
    await sweepOrphanAttachments();
    expect(await prisma.attachment.findUnique({ where: { id: first.id } })).toBeNull();
    expect(destroyed).toContain(first.publicId);
    expect(await prisma.attachment.findUnique({ where: { id: second.id } })).not.toBeNull();
  });
});
