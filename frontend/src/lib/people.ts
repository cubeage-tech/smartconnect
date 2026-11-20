import axios from 'axios';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * QA H4 / L8 / L9 — one way to show a person, everywhere.
 *
 * The full name given at sign-up (or set in Profile & preferences) is the
 * display name; the unique username stays the handle (mentions, search) and
 * the fallback. Screens used to show the username in some places and the full
 * name in others (Team Tasks), and to derive avatar initials and colours from
 * whichever string they had, so one person looked like two.
 *
 * The workspace's people directory (GET /api/users, loaded by WorkspaceLayout)
 * is kept here so any component can resolve an id to the same name, initials,
 * colour and photo without each screen fetching or threading it through props.
 */
export interface Person {
  id: string;
  username: string;
  displayName?: string | null;
  title?: string | null;
  avatarId?: string | null;
}

type NameSource = { username?: string | null; displayName?: string | null } | null | undefined;

/** The name to show: the display name, else the username. */
export const displayNameOf = (person: NameSource, fallback = 'Unknown') => person?.displayName?.trim() || person?.username || fallback;

/**
 * Initials from a display name: the first letters of the first two words
 * ("Nadia Khan" -> "NK"), or the first letter of a single word; usernames
 * split on . _ - ("sam.karale" -> "SK"). `max` 1 for the smallest avatars.
 */
export const initialsOf = (name: string | null | undefined, max: 1 | 2 = 2) => {
  const words = (name ?? '').trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0][0];
  return letters.slice(0, max).toUpperCase();
};

let people = new Map<string, Person>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Replaces the directory (WorkspaceLayout, after GET /api/users). */
export const setPeople = (list: Person[]) => {
  people = new Map(list.map((p) => [p.id, p]));
  notify();
};

/** Updates one person (e.g. after saving your own profile). */
export const updatePerson = (id: string, changes: Partial<Person>) => {
  const current = people.get(id);
  if (!current) return;
  people = new Map(people);
  people.set(id, { ...current, ...changes });
  notify();
};

export const getPerson = (id: string | null | undefined) => (id ? people.get(id) : undefined);

/** The directory entry for an id (re-renders when it changes). */
export const usePerson = (id: string | null | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => getPerson(id),
    () => undefined
  );

/**
 * The name to show for someone the screen knows by id and username (a message
 * sender, a member row): the directory's display name when known, else what
 * the screen already has.
 */
export const usePersonName = (person: { id?: string | null; username?: string | null; displayName?: string | null } | null | undefined, fallback?: string) => {
  const known = usePerson(person?.id);
  return displayNameOf(known ?? person, fallback);
};

// ---- profile photos ------------------------------------------------------

interface CachedLink {
  url: string;
  expiresAt: number;
}
const avatarLinks = new Map<string, CachedLink | null | Promise<CachedLink | null>>();
const MARGIN_MS = 30_000;

const loadAvatarLink = (userId: string, avatarId: string): Promise<CachedLink | null> => {
  const key = `${userId}:${avatarId}`;
  const cached = avatarLinks.get(key);
  if (cached instanceof Promise) return cached;
  if (cached === null) return Promise.resolve(null);
  if (cached && cached.expiresAt - MARGIN_MS > Date.now()) return Promise.resolve(cached);
  const request = axios
    .get<{ url: string; expiresAt: string }>(`/api/users/${encodeURIComponent(userId)}/avatar`)
    .then((res) => {
      const link = { url: res.data.url, expiresAt: new Date(res.data.expiresAt).getTime() };
      avatarLinks.set(key, link);
      return link;
    })
    .catch(() => {
      // No photo / no access / offline: show initials (retried after a reload).
      avatarLinks.set(key, null);
      return null;
    });
  avatarLinks.set(key, request);
  return request;
};

/** A signed link to someone's photo (null while loading or when there is none). */
export const useAvatarUrl = (userId: string | null | undefined, avatarId: string | null | undefined) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!userId || !avatarId) return;
    let alive = true;
    loadAvatarLink(userId, avatarId).then((link) => alive && setUrl(link?.url ?? null));
    return () => {
      alive = false;
    };
  }, [userId, avatarId]);
  return url;
};

/** The whole directory (re-renders when it changes) — for lists that resolve many people in one render. */
export const usePeopleDirectory = () => useSyncExternalStore(subscribe, () => people, () => people);

/** The name to show for `person` using a directory snapshot from usePeopleDirectory(). */
export const nameIn = (directory: Map<string, Person>, person: NameSource & { id?: string | null }, fallback = 'Unknown') =>
  displayNameOf((person?.id ? directory.get(person.id) : undefined) ?? person, fallback);
