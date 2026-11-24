import { afterEach, describe, expect, it } from 'vitest';
import { accountOfToken, isSharedSignInEvent, sharedSignInChange } from './sharedSignIn';

/** A JWT-shaped token for `id` (header and signature are never read here). */
const tokenFor = (id: string, sid = 's') => {
  const payload = btoa(JSON.stringify({ id, username: id, sid })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
};

afterEach(() => localStorage.clear());

describe('accountOfToken', () => {
  it('reads the account id of a session token', () => {
    expect(accountOfToken(tokenFor('user-a'))).toBe('user-a');
  });
  it('is null for anything that is not a readable token', () => {
    expect(accountOfToken(null)).toBeNull();
    expect(accountOfToken('')).toBeNull();
    expect(accountOfToken('not-a-jwt')).toBeNull();
    expect(accountOfToken('a.%%%.c')).toBeNull();
    expect(accountOfToken(`a.${btoa('{"username":"x"}')}.c`)).toBeNull();
  });
});

describe('sharedSignInChange (one sign-in per browser profile)', () => {
  const a1 = tokenFor('user-a', 's1');
  const a2 = tokenFor('user-a', 's2');
  const b = tokenFor('user-b');

  it('another tab signed in as a different account: this tab switches', () => {
    expect(sharedSignInChange(a1, b)).toBe('switched');
  });
  it('another tab signed out: this signed-in tab signs out too', () => {
    expect(sharedSignInChange(a1, null)).toBe('signed-out');
  });
  it('a signed-out tab (e.g. on the login form) follows a sign-in made elsewhere', () => {
    expect(sharedSignInChange(null, b)).toBe('switched');
  });
  it('the same person signing in again elsewhere does not disturb this tab', () => {
    expect(sharedSignInChange(a1, a2)).toBe('ignore');
    expect(sharedSignInChange(a1, a1)).toBe('ignore');
    expect(sharedSignInChange(null, null)).toBe('ignore');
  });
  it('an unreadable token is treated as a different account (fails safe)', () => {
    expect(sharedSignInChange('opaque-1', 'opaque-2')).toBe('switched');
  });
});

describe('isSharedSignInEvent', () => {
  it('matches changes to the shared token and a full clear of localStorage only', () => {
    expect(isSharedSignInEvent({ key: 'token', storageArea: localStorage })).toBe(true);
    expect(isSharedSignInEvent({ key: null, storageArea: localStorage })).toBe(true);
    expect(isSharedSignInEvent({ key: 'smartconnect:tablet-sidebar', storageArea: localStorage })).toBe(false);
    expect(isSharedSignInEvent({ key: 'token', storageArea: sessionStorage })).toBe(false);
  });
});
