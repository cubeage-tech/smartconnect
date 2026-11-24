import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Production incident 2026-11-23 — two accounts in two tabs of ONE browser
 * profile. Every tab shares one sign-in (localStorage "token"). A tab that was
 * open while another tab signed in as someone else used to keep acting as its
 * previous account and then, on its next page load, silently became the other
 * account (showing that person's conversations); its "Sign out" ended the
 * other account's session. Now a tab follows the shared sign-in at once, and
 * sign-out / a 401 only ever touch the tab's own session.
 */
const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  isAxiosError: (err: unknown) => Boolean((err as { isAxiosError?: boolean })?.isAxiosError),
}));
vi.mock('axios', () => ({ default: axiosMock }));

import { AuthProvider, useAuth } from './AuthContext';

const tokenFor = (id: string, sid = 's') =>
  `h.${btoa(JSON.stringify({ id, sid })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.sig`;
const TOKEN_A = tokenFor('user-a', 'sa');
const TOKEN_A2 = tokenFor('user-a', 'sa2');
const TOKEN_B = tokenFor('user-b', 'sb');

const Probe = () => {
  const { user, loading, logout } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : user ? `user:${user.username}` : 'signed-out'}</span>
      <button onClick={logout}>logout</button>
    </div>
  );
};

/** What the browser does in THIS tab when ANOTHER tab writes the shared sign-in. */
const anotherTabStores = (value: string | null) => {
  if (value === null) localStorage.removeItem('token');
  else localStorage.setItem('token', value);
  window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: value, storageArea: localStorage }));
};

const assign = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  localStorage.setItem('token', TOKEN_A);
  axiosMock.get.mockResolvedValue({ data: { id: 'user-a', username: 'alice', email: 'a@x.io', role: 'USER' } });
  axiosMock.post.mockResolvedValue({ data: {} });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const signedInAsAlice = async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:alice'));
};

describe('one sign-in per browser profile, across tabs', () => {
  it('another tab signing in as a different account makes this tab start over as that account at once', async () => {
    await signedInAsAlice();
    act(() => anotherTabStores(TOKEN_B));
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('another tab signing out signs this tab out (to the login page)', async () => {
    await signedInAsAlice();
    act(() => anotherTabStores(null));
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('the same person signing in again in another tab does not disturb this tab', async () => {
    await signedInAsAlice();
    act(() => anotherTabStores(TOKEN_A2));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('state').textContent).toBe('user:alice');
  });

  it('unrelated storage keys are ignored', async () => {
    await signedInAsAlice();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'smartconnect:tablet-sidebar', newValue: 'hidden', storageArea: localStorage }));
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('a T.37 isolated development tab keeps its own sign-in', async () => {
    sessionStorage.setItem('smartconnect:dev:tab-session', '1');
    sessionStorage.setItem('smartconnect:dev:tab-token', TOKEN_A);
    try {
      await signedInAsAlice();
      act(() => anotherTabStores(TOKEN_B));
      expect(assign).not.toHaveBeenCalled();
    } finally {
      sessionStorage.clear();
    }
  });

  it('sign-out ends THIS tab’s session — never the account another tab stored meanwhile', async () => {
    await signedInAsAlice();
    // Another tab signed in as Bob; the storage event is lost (e.g. this tab was frozen).
    localStorage.setItem('token', TOKEN_B);
    act(() => screen.getByText('logout').click());
    expect(axiosMock.post).toHaveBeenCalledWith('/api/auth/logout', null, { headers: { Authorization: `Bearer ${TOKEN_A}` } });
    expect(axiosMock.post).not.toHaveBeenCalledWith('/api/auth/logout', null, { headers: { Authorization: `Bearer ${TOKEN_B}` } });
    // Bob's sign-in is not this tab's to remove.
    expect(localStorage.getItem('token')).toBe(TOKEN_B);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('signed-out'));
  });

  it('signing out clears the shared sign-in when it is this tab’s own', async () => {
    await signedInAsAlice();
    act(() => screen.getByText('logout').click());
    expect(axiosMock.post).toHaveBeenCalledWith('/api/auth/logout', null, { headers: { Authorization: `Bearer ${TOKEN_A}` } });
    expect(localStorage.getItem('token')).toBeNull();
  });
});
