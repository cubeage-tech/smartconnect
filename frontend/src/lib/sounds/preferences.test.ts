import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUND_PREFERENCES, SoundPreferencesView } from '../api/soundPreferences';

/**
 * The page's copy of the signed-in user's sound preferences: loaded once per
 * user, malformed answers ignored, saves shared with this user's other tabs
 * (and nobody else's), cleared on sign-out.
 */

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api/soundPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/soundPreferences')>()),
  soundPreferencesApi: { get: api.get },
}));

const view = (patch: (p: typeof DEFAULT_SOUND_PREFERENCES) => void): SoundPreferencesView => {
  const preferences = structuredClone(DEFAULT_SOUND_PREFERENCES);
  patch(preferences);
  return { preferences, isDefault: false, defaults: DEFAULT_SOUND_PREFERENCES };
};

const openTab = async () => {
  vi.resetModules();
  return import('./preferences');
};

beforeEach(() => api.get.mockReset());

describe('sound preferences store', () => {
  it('uses the defaults until loaded, then the user’s own, fetched once', async () => {
    const store = await openTab();
    expect(store.getSoundPreferences()).toEqual(DEFAULT_SOUND_PREFERENCES);
    api.get.mockResolvedValue(view((p) => (p.doNotDisturb = true)));
    await Promise.all([store.loadSoundPreferences('u1'), store.loadSoundPreferences('u1')]);
    await store.loadSoundPreferences('u1');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(store.getSoundPreferences().doNotDisturb).toBe(true);
  });

  it('keeps the defaults when the server fails or answers something unexpected', async () => {
    const store = await openTab();
    api.get.mockRejectedValueOnce(new Error('offline'));
    await store.loadSoundPreferences('u1');
    expect(store.getSoundPreferences()).toEqual(DEFAULT_SOUND_PREFERENCES);
    store.clearSoundPreferences();
    api.get.mockResolvedValueOnce([]);
    await store.loadSoundPreferences('u1');
    expect(store.getSoundPreferences()).toEqual(DEFAULT_SOUND_PREFERENCES);
  });

  it('a save in one tab reaches this user’s other tabs, not another user’s', async () => {
    api.get.mockResolvedValue(view(() => undefined));
    const a = await openTab();
    await a.loadSoundPreferences('u1');
    const b = await openTab();
    await b.loadSoundPreferences('u1');
    const other = await openTab();
    await other.loadSoundPreferences('u2');

    a.publishSoundPreferences('u1', view((p) => (p.categories.mention.sound = 'knock')));
    expect(a.getSoundPreferences().categories.mention.sound).toBe('knock');
    await vi.waitFor(() => expect(b.getSoundPreferences().categories.mention.sound).toBe('knock'));
    expect(other.getSoundPreferences().categories.mention.sound).toBe('ping');
  });

  it('signing out forgets the choices', async () => {
    const store = await openTab();
    api.get.mockResolvedValue(view((p) => (p.doNotDisturb = true)));
    await store.loadSoundPreferences('u1');
    store.clearSoundPreferences();
    expect(store.getSoundPreferences()).toEqual(DEFAULT_SOUND_PREFERENCES);
  });
});
