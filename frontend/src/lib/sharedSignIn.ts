import { SHARED_TOKEN_KEY } from './devTabSession';

/**
 * One sign-in per browser profile — kept consistent across tabs.
 *
 * Every tab of a browser profile shares one sign-in (localStorage "token",
 * lib/devTabSession.ts). A tab reads it once, when it loads, and then keeps
 * the account in memory. Without the rules below, a tab that was open while
 * another tab signed in as someone else kept acting as the previous account
 * until its next reload — and then silently became the other account, showing
 * that person's conversations at the same address (production incident
 * 2026-11-23). Meanwhile its "Sign out" ended the other account's session and
 * left its own running.
 *
 * Here, a tab that sees the shared sign-in change to another account, or to
 * signed out, starts over from the current sign-in at once (AuthContext).
 */

/**
 * The account id inside a session token (its JWT payload `id`). Not verified —
 * only used to tell whether two tokens this browser already holds belong to
 * the same person. Null when the token cannot be read.
 */
export const accountOfToken = (token: string | null | undefined): string | null => {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64)) as { id?: unknown };
    return typeof payload.id === 'string' && payload.id ? payload.id : null;
  } catch {
    return null;
  }
};

export type SharedSignInChange = 'ignore' | 'signed-out' | 'switched';

/**
 * What a tab holding `mine` must do after another tab changed the shared
 * sign-in to `shared`:
 *  - 'ignore'     — same token, or the same person with another session
 *                   (they signed in again elsewhere; this session still works);
 *  - 'signed-out' — the shared sign-in was removed while this tab was signed in;
 *  - 'switched'   — another account (or a sign-in while this tab had none).
 */
export const sharedSignInChange = (mine: string | null, shared: string | null): SharedSignInChange => {
  if (shared === mine) return 'ignore';
  if (!shared) return mine ? 'signed-out' : 'ignore';
  const mineAccount = accountOfToken(mine);
  if (mineAccount !== null && mineAccount === accountOfToken(shared)) return 'ignore';
  return 'switched';
};

/** True for a `storage` event that touched the shared sign-in (or cleared all of localStorage). */
export const isSharedSignInEvent = (event: Pick<StorageEvent, 'key' | 'storageArea'>): boolean => {
  let shared: Storage | null = null;
  try {
    shared = localStorage;
  } catch {
    return false;
  }
  return event.storageArea === shared && (event.key === SHARED_TOKEN_KEY || event.key === null);
};
