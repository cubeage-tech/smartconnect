import { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import { prisma } from '../../lib/prisma';

/**
 * Personal call and notification sounds (stored on UserProfile.soundPreferences,
 * read and written only through /api/users/me/sound-preferences — never part
 * of any other profile response).
 *
 * The sound ids name tones the web app synthesizes (frontend/src/lib/sounds):
 * ringtones loop while a call rings; alerts play once. The catalogue is kept
 * in sync by a test on each side.
 */

export const RINGTONE_IDS = ['aurora', 'pulse', 'marimba', 'bells', 'classic', 'soft'] as const;
export const ALERT_IDS = ['chime', 'pop', 'ping', 'drop', 'knock'] as const;

export const SOUND_CATEGORIES = {
  oneToOneAudio: 'ringtone',
  oneToOneVideo: 'ringtone',
  groupCall: 'ringtone',
  meetingReminder: 'alert',
  directMessage: 'alert',
  mention: 'alert',
} as const;
export type SoundCategory = keyof typeof SOUND_CATEGORIES;

export interface CategoryPreference {
  enabled: boolean;
  sound: string;
  /** 0–100. */
  volume: number;
}
export interface SoundPreferences {
  /** Silences every sound below (calls still show on screen). */
  doNotDisturb: boolean;
  categories: Record<SoundCategory, CategoryPreference>;
}

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  doNotDisturb: false,
  categories: {
    oneToOneAudio: { enabled: true, sound: 'aurora', volume: 70 },
    oneToOneVideo: { enabled: true, sound: 'marimba', volume: 70 },
    groupCall: { enabled: true, sound: 'pulse', volume: 60 },
    meetingReminder: { enabled: true, sound: 'chime', volume: 60 },
    directMessage: { enabled: true, sound: 'pop', volume: 50 },
    mention: { enabled: true, sound: 'ping', volume: 60 },
  },
};

const allowedSounds = (category: SoundCategory): readonly string[] => (SOUND_CATEGORIES[category] === 'ringtone' ? RINGTONE_IDS : ALERT_IDS);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Strict validation of a full preferences object from the client (400 on anything unexpected). */
export const parseSoundPreferences = (body: unknown): SoundPreferences => {
  if (!isPlainObject(body)) throw new HttpError(400, 'Sound preferences must be an object.');
  const unknownTop = Object.keys(body).filter((k) => k !== 'doNotDisturb' && k !== 'categories');
  if (unknownTop.length > 0) throw new HttpError(400, `Unknown setting: ${unknownTop[0].slice(0, 40)}.`);
  if (typeof body.doNotDisturb !== 'boolean') throw new HttpError(400, 'doNotDisturb must be true or false.');
  if (!isPlainObject(body.categories)) throw new HttpError(400, 'categories must be an object.');
  const given = body.categories;
  const names = Object.keys(SOUND_CATEGORIES) as SoundCategory[];
  const unknown = Object.keys(given).filter((k) => !names.includes(k as SoundCategory));
  if (unknown.length > 0) throw new HttpError(400, `Unknown sound category: ${unknown[0].slice(0, 40)}.`);
  const categories = {} as Record<SoundCategory, CategoryPreference>;
  for (const name of names) {
    const c = given[name];
    if (!isPlainObject(c)) throw new HttpError(400, `Missing settings for ${name}.`);
    if (typeof c.enabled !== 'boolean') throw new HttpError(400, `${name}.enabled must be true or false.`);
    if (typeof c.sound !== 'string' || !allowedSounds(name).includes(c.sound)) throw new HttpError(400, `${name}.sound is not an available sound.`);
    if (typeof c.volume !== 'number' || !Number.isInteger(c.volume) || c.volume < 0 || c.volume > 100) throw new HttpError(400, `${name}.volume must be a whole number from 0 to 100.`);
    categories[name] = { enabled: c.enabled, sound: c.sound, volume: c.volume };
  }
  return { doNotDisturb: body.doNotDisturb, categories };
};

/**
 * What is stored, merged over the defaults field by field. Tolerant: a stored
 * value that is no longer valid (e.g. a sound later removed) falls back to the
 * default for that field instead of failing.
 */
export const effectiveSoundPreferences = (stored: Prisma.JsonValue | null | undefined): SoundPreferences => {
  const result: SoundPreferences = structuredClone(DEFAULT_SOUND_PREFERENCES);
  if (!isPlainObject(stored)) return result;
  if (typeof stored.doNotDisturb === 'boolean') result.doNotDisturb = stored.doNotDisturb;
  const categories = isPlainObject(stored.categories) ? stored.categories : {};
  for (const name of Object.keys(SOUND_CATEGORIES) as SoundCategory[]) {
    const c = categories[name];
    if (!isPlainObject(c)) continue;
    if (typeof c.enabled === 'boolean') result.categories[name].enabled = c.enabled;
    if (typeof c.sound === 'string' && allowedSounds(name).includes(c.sound)) result.categories[name].sound = c.sound;
    if (typeof c.volume === 'number' && Number.isInteger(c.volume) && c.volume >= 0 && c.volume <= 100) result.categories[name].volume = c.volume;
  }
  return result;
};

const view = (stored: Prisma.JsonValue | null | undefined) => ({
  preferences: effectiveSoundPreferences(stored),
  isDefault: stored === null || stored === undefined,
  defaults: DEFAULT_SOUND_PREFERENCES,
});

export const getSoundPreferences = async (userId: string) => {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { soundPreferences: true } });
  return view(profile?.soundPreferences);
};

export const saveSoundPreferences = async (userId: string, body: unknown) => {
  const preferences = parseSoundPreferences(body);
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, soundPreferences: preferences as unknown as Prisma.InputJsonValue },
    update: { soundPreferences: preferences as unknown as Prisma.InputJsonValue },
    select: { soundPreferences: true },
  });
  return view(profile.soundPreferences);
};

/** Back to the defaults (the stored value is cleared, so later default changes apply). */
export const resetSoundPreferences = async (userId: string) => {
  await prisma.userProfile.updateMany({ where: { userId }, data: { soundPreferences: Prisma.DbNull } });
  return view(null);
};
