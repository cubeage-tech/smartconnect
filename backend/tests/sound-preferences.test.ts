import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { reconcileSharedWorkspace } from '../lib/sharedWorkspace';
import { ALERT_IDS, DEFAULT_SOUND_PREFERENCES, RINGTONE_IDS, SOUND_CATEGORIES } from '../modules/users/soundPreferences';
import { addToWorkspace, createWorkspace, TestUser } from './collab-helpers';
import { authHeader, createAndLoginUser } from './helpers';

/**
 * Personal call and notification sounds: per-user persistence through
 * /api/users/me/sound-preferences only, strict validation, reset to defaults,
 * tolerant reads of older stored values, and no way to see anyone else's.
 * Disposable test database only.
 */

const PATH = '/api/users/me/sound-preferences';
const as = (u: { token: string }) => ({
  get: (p: string) => request(app).get(p).set(authHeader(u.token)),
  put: (p: string, b: unknown) => request(app).put(p).set(authHeader(u.token)).send(b as object),
  delete: (p: string) => request(app).delete(p).set(authHeader(u.token)),
});
const custom = () => {
  const p = structuredClone(DEFAULT_SOUND_PREFERENCES);
  p.doNotDisturb = true;
  p.categories.oneToOneVideo = { enabled: true, sound: 'bells', volume: 35 };
  p.categories.groupCall.enabled = false;
  p.categories.mention = { enabled: true, sound: 'knock', volume: 90 };
  return p;
};

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  await reconcileSharedWorkspace();
  [alice, bob] = await Promise.all([createAndLoginUser(), createAndLoginUser()]);
});

describe('sound preferences', () => {
  it('starts from the defaults', async () => {
    const res = await as(alice).get(PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: DEFAULT_SOUND_PREFERENCES, isDefault: true, defaults: DEFAULT_SOUND_PREFERENCES });
  });

  it('saves and reads back the caller’s own choices, which survive a new session', async () => {
    const saved = await as(alice).put(PATH, custom());
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ preferences: custom(), isDefault: false });
    const again = await as(alice).get(PATH);
    expect(again.body.preferences).toEqual(custom());
    // A fresh login of the same account (new session) sees the same.
    const relogin = await request(app).post('/api/auth/login').send({ email: alice.user.email, password: 'Password123!' });
    expect((await as({ token: relogin.body.token }).get(PATH)).body.preferences).toEqual(custom());
  });

  it('is per user: someone else’s choices never show up, and there is no way to ask for them', async () => {
    await as(alice).put(PATH, custom());
    expect((await as(bob).get(PATH)).body).toMatchObject({ preferences: DEFAULT_SOUND_PREFERENCES, isDefault: true });
    // No user id is accepted anywhere: other paths are not sound-preference routes.
    expect((await as(bob).get(`/api/users/${alice.user.id}/sound-preferences`)).status).toBe(404);
    // Nor do they leak through profile responses.
    const { workspaceId } = await createWorkspace(alice, `Sounds ${Date.now()}`);
    await addToWorkspace(bob, workspaceId);
    const profile = await as(bob).get(`/api/workspaces/${workspaceId}/members/${alice.user.id}`);
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.body)).not.toMatch(/soundPreferences|doNotDisturb|knock/);
    expect(JSON.stringify((await as(alice).get('/api/users/me/profile')).body)).not.toMatch(/soundPreferences/);
  });

  it.each([
    ['not an object', 'loud'],
    ['missing doNotDisturb', { categories: DEFAULT_SOUND_PREFERENCES.categories }],
    ['an unknown top-level key', { ...DEFAULT_SOUND_PREFERENCES, theme: 'dark' }],
    ['an unknown category', { ...DEFAULT_SOUND_PREFERENCES, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, sms: { enabled: true, sound: 'pop', volume: 5 } } }],
    ['a missing category', { doNotDisturb: false, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, mention: undefined } }],
    ['a ringtone for a message', { ...DEFAULT_SOUND_PREFERENCES, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, directMessage: { enabled: true, sound: 'aurora', volume: 50 } } }],
    ['an alert for a call', { ...DEFAULT_SOUND_PREFERENCES, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, oneToOneAudio: { enabled: true, sound: 'pop', volume: 50 } } }],
    ['a volume above 100', { ...DEFAULT_SOUND_PREFERENCES, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, mention: { enabled: true, sound: 'ping', volume: 101 } } }],
    ['a fractional volume', { ...DEFAULT_SOUND_PREFERENCES, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, mention: { enabled: true, sound: 'ping', volume: 5.5 } } }],
    ['a non-boolean enabled', { ...DEFAULT_SOUND_PREFERENCES, categories: { ...DEFAULT_SOUND_PREFERENCES.categories, mention: { enabled: 'yes', sound: 'ping', volume: 5 } } }],
  ])('refuses %s (400) and keeps what was saved', async (_label, body) => {
    await as(bob).delete(PATH);
    const res = await as(bob).put(PATH, body);
    expect(res.status).toBe(400);
    expect((await as(bob).get(PATH)).body.isDefault).toBe(true);
  });

  it('reset goes back to the defaults', async () => {
    await as(alice).put(PATH, custom());
    const reset = await as(alice).delete(PATH);
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ preferences: DEFAULT_SOUND_PREFERENCES, isDefault: true });
    expect((await as(alice).get(PATH)).body.isDefault).toBe(true);
  });

  it('reads older or partly invalid stored values field by field, never failing', async () => {
    await prisma.userProfile.upsert({
      where: { userId: bob.user.id },
      create: { userId: bob.user.id, soundPreferences: { doNotDisturb: 'sometimes', categories: { mention: { enabled: false, sound: 'removed-sound', volume: 250 }, groupCall: 'nope' } } },
      update: { soundPreferences: { doNotDisturb: 'sometimes', categories: { mention: { enabled: false, sound: 'removed-sound', volume: 250 }, groupCall: 'nope' } } },
    });
    const res = await as(bob).get(PATH);
    expect(res.status).toBe(200);
    expect(res.body.preferences.doNotDisturb).toBe(false);
    expect(res.body.preferences.categories.mention).toEqual({ enabled: false, sound: DEFAULT_SOUND_PREFERENCES.categories.mention.sound, volume: DEFAULT_SOUND_PREFERENCES.categories.mention.volume });
    expect(res.body.preferences.categories.groupCall).toEqual(DEFAULT_SOUND_PREFERENCES.categories.groupCall);
  });

  it('needs a signed-in user', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
    expect((await request(app).put(PATH).send(DEFAULT_SOUND_PREFERENCES)).status).toBe(401);
  });

  it('every default names a sound of the right kind', () => {
    for (const [name, kind] of Object.entries(SOUND_CATEGORIES)) {
      const ids: readonly string[] = kind === 'ringtone' ? RINGTONE_IDS : ALERT_IDS;
      expect(ids).toContain(DEFAULT_SOUND_PREFERENCES.categories[name as keyof typeof SOUND_CATEGORIES].sound);
    }
  });
});
