import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUND_PREFERENCES, SoundPreferences } from '../../lib/api/soundPreferences';
import { resetSoundCoordinatorForTests } from '../../lib/sounds/coordinator';
import { getSoundPreferences } from '../../lib/sounds/preferences';
import { WorkspaceLayout } from './WorkspaceLayout';

/**
 * Personal sounds wired into the workspace: the right ringtone for 1:1 audio,
 * 1:1 video and group calls; ringing stops on accept, decline, cancel,
 * timeout, an answer in another tab and a lost connection; Do Not Disturb;
 * no duplicates; and the direct-message, mention and meeting-reminder alerts.
 * The audio engine is a recorder (jsdom has no Web Audio).
 */

class FakeSocket {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  sent: { event: string; payload: unknown }[] = [];
  on(event: string, fn: (payload: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: (payload: unknown) => void) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, payload: unknown) {
    this.sent.push({ event, payload });
    return this;
  }
  receive(event: string, payload: unknown) {
    this.handlers.get(event)?.forEach((fn) => fn(payload));
  }
  emitted(event: string) {
    return this.sent.filter((s) => s.event === event).map((s) => s.payload);
  }
}

const h = vi.hoisted(() => ({
  auth: { user: { id: 'me', username: 'mia' }, token: 'token' },
  socket: null as unknown,
  status: 'connected',
  statusListeners: new Set<() => void>(),
  workspaces: { getWorkspace: () => ({ id: 'ws1', name: 'Apollo' }), loading: false, refresh: async () => [] },
  sounds: null as unknown as SoundPreferences,
  channelsGate: null as Promise<void> | null,
  plays: [] as { sound: string; volume: number; loop: boolean; stopped: boolean; stop: () => void }[],
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../hooks/useSocket', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSocket: () => h.socket,
    useConnectionStatus: () =>
      useSyncExternalStore(
        (fn: () => void) => {
          h.statusListeners.add(fn);
          return () => h.statusListeners.delete(fn);
        },
        () => h.status
      ),
  };
});
vi.mock('./WorkspacesProvider', () => ({ useWorkspaces: () => h.workspaces, useWorkspaceLiveUpdates: () => undefined }));
vi.mock('axios', () => ({
  default: {
    get: async (url: string) => {
      if (url.endsWith('/channels') && h.channelsGate) await h.channelsGate;
      return {
      data: url.endsWith('/sound-preferences')
        ? { preferences: h.sounds, isDefault: false, defaults: DEFAULT_SOUND_PREFERENCES }
        : url.endsWith('/unread')
          ? { channels: [] }
          : url.endsWith('/channels')
            ? [{ id: 'chan-1', name: 'general', isDM: false }]
            : url.endsWith('/dms')
              ? [
                  { id: 'dm-1', isDM: true, isGroupDM: false, members: [] },
                  { id: 'gdm-1', isDM: true, isGroupDM: true, members: [] },
                ]
              : [],
      };
    },
    post: async () => ({ data: {} }),
    patch: async () => ({ data: {} }),
    defaults: { headers: { common: {} } },
  },
}));
vi.mock('../../lib/sounds/engine', () => ({
  installUnlock: () => undefined,
  soundReady: () => true,
  unlockSound: async () => true,
  playSound: (sound: string, { volume, loop = false }: { volume: number; loop?: boolean }) => {
    const p = { sound, volume, loop, stopped: false, stop: () => void (p.stopped = true) };
    h.plays.push(p);
    return p;
  },
}));
vi.mock('react-toastify', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/layout/Header', () => ({ Header: () => null }));
vi.mock('../../components/sidebar/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../components/sidebar/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../../components/chat/CallOverlay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/chat/CallOverlay')>()),
  CallOverlay: () => <div data-testid="call-overlay" />,
}));
vi.mock('../../components/chat/CallLobby', () => ({
  CallLobby: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="call-lobby">
      <button type="button" onClick={onCancel}>
        lobby: cancel
      </button>
    </div>
  ),
}));

const Page = () => <p>page</p>;
const renderLayout = async (path = '/ws1/c/chan-1') => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:workspaceId" element={<WorkspaceLayout />}>
          <Route path="c/:channelId" element={<Page />} />
          <Route path="home" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText('page');
  // The user's own preferences are in use before anything rings.
  await waitFor(() => expect(getSoundPreferences()).toEqual(h.sounds));
  return h.socket as FakeSocket;
};
const ring = (socket: FakeSocket, payload: Record<string, unknown>) =>
  act(() => socket.receive('call:incoming', { callerName: 'bob', from: 'u2', ...payload }));
const playing = () => h.plays.filter((p) => !p.stopped);
const message = (id: string, channelId: string, senderId = 'u2') => ({ id, channelId, senderId, workspaceId: 'ws1', content: 'hi', createdAt: new Date().toISOString() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  resetSoundCoordinatorForTests();
  localStorage.clear();
  h.socket = new FakeSocket();
  h.status = 'connected';
  h.sounds = structuredClone(DEFAULT_SOUND_PREFERENCES);
  h.sounds.categories.groupCall.sound = 'bells';
  h.plays = [];
  h.channelsGate = null;
});
afterEach(() => vi.restoreAllMocks());

describe('ringtones', () => {
  it('a 1:1 audio call rings with the audio-call ringtone; accepting stops it and tells the other tabs', async () => {
    const otherTab = new BroadcastChannel('smartconnect:ringing');
    const told: unknown[] = [];
    otherTab.onmessage = (e) => told.push(e.data);
    const socket = await renderLayout();
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'aurora', volume: 70, loop: true, stopped: false })]);
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    expect(playing()).toEqual([]);
    expect(screen.getByTestId('call-lobby')).toBeInTheDocument();
    await waitFor(() => expect(told).toEqual([{ type: 'ring-handled', userId: 'me', key: 'dm-1' }]));
    otherTab.close();
  });

  it('a 1:1 video call has its own ringtone; declining stops it', async () => {
    const socket = await renderLayout();
    ring(socket, { channelId: 'dm-1', callType: 'video', oneToOne: true });
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'marimba', loop: true })]);
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }));
    expect(playing()).toEqual([]);
    expect(socket.emitted('call:decline')).toEqual([{ channelId: 'dm-1' }]);
  });

  it('a group call uses the group ringtone; the caller cancelling stops it', async () => {
    const socket = await renderLayout();
    ring(socket, { channelId: 'chan-1', callType: 'video', oneToOne: false });
    expect(h.plays).toEqual([expect.objectContaining({ sound: 'bells', volume: 60 })]);
    act(() => socket.receive('call:ring_ended', { channelId: 'chan-1', reason: 'cancelled' }));
    expect(playing()).toEqual([]);
    expect(screen.queryByText(/Incoming/)).toBeNull();
  });

  it('without the server hint (older server), the conversation decides 1:1 or group', async () => {
    const socket = await renderLayout();
    await waitFor(async () => {
      // DMs load asynchronously; ring until the DM is known.
      h.plays = [];
      ring(socket, { channelId: 'dm-1', callType: 'audio' });
      expect(h.plays.at(-1)?.sound).toBe('aurora');
    });
    ring(socket, { channelId: 'gdm-1', callType: 'audio' });
    expect(h.plays.at(-1)?.sound).toBe('bells');
    ring(socket, { channelId: 'chan-1', callType: 'audio' });
    expect(h.plays.at(-1)?.sound).toBe('bells');
    expect(playing()).toHaveLength(1); // each new ring replaced the previous one
  });

  it('never rings twice for the same call', async () => {
    const socket = await renderLayout();
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    expect(playing()).toHaveLength(1);
  });

  it('stops on timeout and when answered on another device', async () => {
    const socket = await renderLayout();
    ring(socket, { channelId: 'chan-1', callType: 'audio', oneToOne: false });
    act(() => socket.receive('call:ring_ended', { channelId: 'chan-1', reason: 'timeout' }));
    expect(playing()).toEqual([]);
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    act(() => socket.receive('call:ring_ended', { channelId: 'dm-1', reason: 'answered' }));
    expect(playing()).toEqual([]);
  });

  it('stops when the connection drops (the banner stays until the ring ends)', async () => {
    const socket = await renderLayout();
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    act(() => {
      h.status = 'reconnecting';
      h.statusListeners.forEach((fn) => fn());
    });
    expect(playing()).toEqual([]);
    expect(screen.getByText(/Incoming audio call/)).toBeInTheDocument();
    act(() => {
      h.status = 'connected';
      h.statusListeners.forEach((fn) => fn());
    });
    expect(playing()).toEqual([]); // not restarted for a ring we may have lost track of
  });

  it('accepted or declined in another tab: stops and dismisses the banner here', async () => {
    const socket = await renderLayout();
    ring(socket, { channelId: 'chan-1', callType: 'audio', oneToOne: false });
    const otherTab = new BroadcastChannel('smartconnect:ringing');
    otherTab.postMessage({ type: 'ring-handled', userId: 'me', key: 'chan-1' });
    await waitFor(() => expect(screen.queryByText(/Incoming/)).toBeNull());
    expect(playing()).toEqual([]);
    otherTab.close();
  });

  it('Do Not Disturb: the call still shows, silently', async () => {
    h.sounds.doNotDisturb = true;
    const socket = await renderLayout();
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    expect(screen.getByText(/Incoming audio call/)).toBeInTheDocument();
    expect(h.plays).toEqual([]);
  });

  it('a switched-off category is silent', async () => {
    h.sounds.categories.oneToOneVideo.enabled = false;
    const socket = await renderLayout();
    ring(socket, { channelId: 'dm-1', callType: 'video', oneToOne: true });
    expect(h.plays).toEqual([]);
  });
});

describe('notification sounds', () => {
  it('a direct message from someone else chimes once, however often it is delivered', async () => {
    const socket = await renderLayout('/ws1/home');
    act(() => socket.receive('message:received', message('m1', 'dm-1')));
    act(() => socket.receive('message:received', message('m1', 'dm-1')));
    await waitFor(() => expect(h.plays).toEqual([expect.objectContaining({ sound: 'pop', volume: 50, loop: false })]));
    await sleep(30);
    expect(h.plays).toHaveLength(1);
  });

  it('no sound for your own messages, for channel messages, or for the DM you are looking at', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const socket = await renderLayout('/ws1/c/dm-1');
    await waitFor(() => expect(screen.getByText('page')).toBeInTheDocument());
    act(() => socket.receive('message:received', message('m1', 'dm-1', 'me')));
    act(() => socket.receive('message:received', message('m2', 'chan-1')));
    await sleep(50); // the DM list has loaded by now
    act(() => socket.receive('message:received', message('m3', 'dm-1')));
    await sleep(30);
    expect(h.plays).toEqual([]);
  });

  it('a brand-new DM (not yet in the list) chimes; nothing while the channel list is still loading', async () => {
    let open!: () => void;
    h.channelsGate = new Promise<void>((resolve) => (open = resolve));
    const socket = await renderLayout('/ws1/home');
    act(() => socket.receive('message:received', message('m1', 'chan-1'))); // a channel, but the list isn't in yet
    await sleep(50);
    expect(h.plays).toEqual([]);
    await act(async () => open());
    await sleep(20);
    act(() => socket.receive('message:received', message('m2', 'brand-new-dm')));
    await waitFor(() => expect(h.plays.map((p) => p.sound)).toEqual(['pop']));
  });

  it('an @mention plays the mention sound', async () => {
    const socket = await renderLayout('/ws1/home');
    act(() => socket.receive('notification:new', { type: 'MENTION', isRead: false, workspaceId: 'ws1', channel: { id: 'chan-1' }, message: { id: 'm9' } }));
    await waitFor(() => expect(h.plays.map((p) => p.sound)).toEqual(['ping']));
  });

  it('a DM that also mentions you is one sound, not two', async () => {
    const socket = await renderLayout('/ws1/home');
    act(() => socket.receive('message:received', message('m1', 'dm-1')));
    act(() => socket.receive('notification:new', { type: 'MENTION', isRead: false, workspaceId: 'ws1', channel: { id: 'dm-1' }, message: { id: 'm1' } }));
    await sleep(50);
    expect(h.plays.map((p) => p.sound)).toEqual(['pop']);
  });

  it('a meeting reminder plays the reminder sound', async () => {
    const socket = await renderLayout('/ws1/home');
    act(() => socket.receive('meeting:reminder', { meetingId: 'mt-1', workspaceId: 'ws1', title: 'Standup', minutesLeft: 5 }));
    await waitFor(() => expect(h.plays.map((p) => p.sound)).toEqual(['chime']));
  });

  it('nothing plays over a call (or its lobby)', async () => {
    const socket = await renderLayout('/ws1/home');
    ring(socket, { channelId: 'dm-1', callType: 'audio', oneToOne: true });
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    h.plays = [];
    act(() => socket.receive('message:received', message('m1', 'dm-1')));
    act(() => socket.receive('meeting:reminder', { meetingId: 'mt-1', workspaceId: 'ws1', title: 'Standup', minutesLeft: 5 }));
    await sleep(50);
    expect(h.plays).toEqual([]);
  });

  it('Do Not Disturb silences notifications too', async () => {
    h.sounds.doNotDisturb = true;
    const socket = await renderLayout('/ws1/home');
    act(() => socket.receive('message:received', message('m1', 'dm-1')));
    act(() => socket.receive('meeting:reminder', { meetingId: 'mt-1', workspaceId: 'ws1', title: 'Standup', minutesLeft: 5 }));
    await sleep(50);
    expect(h.plays).toEqual([]);
  });
});
