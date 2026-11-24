import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, ReactNode, useImperativeHandle } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, WorkspaceContextValue } from '../../pages/workspace/WorkspaceContext';
import { Channel } from '../../types';
import { ChatArea } from './ChatArea';

/**
 * Production incident 2026-11-23 — conversation isolation in the open chat.
 * Every authorized conversation's events reach the one socket a user has, so
 * the open conversation must show only its own messages: live events for
 * other conversations are ignored, a repeated event renders once, switching
 * conversations carries nothing over (not even a late send acknowledgement),
 * and a reconnect backfills this conversation only.
 */
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  const rects = Object.assign([rect], { item: () => rect }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Element.prototype, Text.prototype] as unknown as { getClientRects?: () => DOMRectList; getBoundingClientRect?: () => DOMRect }[]) {
    if (!proto.getClientRects) proto.getClientRects = () => rects;
    if (!proto.getBoundingClientRect) proto.getBoundingClientRect = () => rect;
  }
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

const h = vi.hoisted(() => ({
  byChannel: {} as Record<string, unknown[]>,
  fetches: [] as string[],
  emits: [] as { event: string; payload: unknown }[],
  pendingAcks: [] as ((res: unknown) => void)[],
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(
    (
      { data, itemContent, components }: { data: { id: string }[]; itemContent: (i: number, d: unknown) => ReactNode; components?: { Header?: () => ReactNode } },
      ref
    ) => {
      useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined }));
      return (
        <div>
          {components?.Header?.()}
          {data.map((d, i) => (
            <div key={d.id}>{itemContent(i, d)}</div>
          ))}
        </div>
      );
    }
  ),
}));
vi.mock('emoji-picker-react', () => ({ default: () => null, Theme: { DARK: 'dark', LIGHT: 'light' } }));
vi.mock('./LinkPreview', () => ({ LinkPreview: () => null }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', username: 'mia' } }) }));
vi.mock('axios', () => ({
  default: {
    get: async (url: string) => {
      const m = /^\/api\/channels\/([^/]+)\/messages$/.exec(url);
      if (m) {
        h.fetches.push(m[1]);
        return { data: { messages: h.byChannel[m[1]] ?? [], nextCursor: null, hasMore: false } };
      }
      if (url.endsWith('/details')) {
        return {
          data: {
            id: 'x', workspaceId: 'ws', name: 'x', visibility: 'PUBLIC', type: 'PUBLIC', isAnnouncement: false, archived: false, isGeneral: false, memberCount: 2,
            capabilities: { canRead: true, canPost: true, canReply: true, canReact: true },
          },
        };
      }
      if (url.endsWith('/read-receipts')) return { data: { enabled: false, receipts: [] } };
      return { data: [] };
    },
    post: async () => ({ data: {} }),
    defaults: { headers: { common: {} } },
  },
}));

type Handler = (payload: unknown) => void;
class FakeSocket {
  handlers = new Map<string, Set<Handler>>();
  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler?: Handler) {
    if (handler) this.handlers.get(event)?.delete(handler);
    return this;
  }
  emit(event: string, payload?: unknown) {
    h.emits.push({ event, payload });
    return this;
  }
  timeout() {
    return {
      emit: (event: string, payload: unknown, cb?: (err: Error | null, res: unknown) => void) => {
        h.emits.push({ event, payload });
        // The acknowledgement is released by the test (simulates a slow server).
        h.pendingAcks.push((res) => cb?.(null, res));
      },
    };
  }
  fire(event: string, payload: unknown) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }
  count(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }
}

const context = (socket: FakeSocket): WorkspaceContextValue =>
  ({
    workspaceId: 'ws', socket: socket as unknown as Socket, connectionStatus: 'connected', channels: [], channelsLoading: false, dms: [], dmsLoading: false,
    onlineUsers: [], users: [], readState: {}, unreadCounts: {}, clearUnread: vi.fn(), markChannelRead: vi.fn(), fetchChannels: vi.fn(), fetchDMs: vi.fn(),
    upsertDM: vi.fn(), removeConversation: vi.fn(), addChannel: vi.fn(), startDM: vi.fn(), startCall: vi.fn(), hasActiveCall: false, endActiveCall: vi.fn(),
  }) as WorkspaceContextValue;

const dmWithBob: Channel = { id: 'dm-bob', name: 'bob', isDM: true, otherUserId: 'bob', workspaceId: 'ws' } as Channel;
const dmWithCara: Channel = { id: 'dm-cara', name: 'cara', isDM: true, otherUserId: 'cara', workspaceId: 'ws' } as Channel;

let seq = 0;
const msg = (channelId: string, content: string, over: Record<string, unknown> = {}) => ({
  id: `m-${++seq}`,
  channelId,
  workspaceId: 'ws',
  senderId: 'bob',
  sender: { id: 'bob', username: 'bob' },
  content: `<p>${content}</p>`,
  createdAt: new Date(Date.UTC(2026, 10, 23, 9, 0, seq)).toISOString(),
  reactions: [],
  parentId: null,
  ...over,
});

/** Mirrors ChannelPage: one ChatArea per conversation, keyed by its id. */
const Chat = ({ channel, socket }: { channel: Channel; socket: FakeSocket }) => (
  <WorkspaceContext.Provider value={context(socket)}>
    <MemoryRouter>
      <ChatArea key={channel.id} channel={channel} socket={socket as unknown as Socket} onStartCall={vi.fn()} />
    </MemoryRouter>
  </WorkspaceContext.Provider>
);

beforeEach(() => {
  h.byChannel = {};
  h.fetches = [];
  h.emits = [];
  h.pendingAcks = [];
  localStorage.clear();
});

const listed = () => Array.from(document.querySelectorAll('[data-message-id]')).map((el) => el.textContent ?? '');

describe('ChatArea conversation isolation', () => {
  it('shows a live message for this conversation and ignores events for every other conversation', async () => {
    h.byChannel['dm-bob'] = [msg('dm-bob', 'history with bob')];
    const socket = new FakeSocket();
    render(<Chat channel={dmWithBob} socket={socket} />);
    await screen.findByText('history with bob');

    act(() => socket.fire('message:received', msg('dm-bob', 'live from bob')));
    act(() => socket.fire('message:received', msg('dm-cara', 'cara private note', { senderId: 'cara', sender: { id: 'cara', username: 'cara' } })));
    act(() => socket.fire('message:received', msg('other-channel', 'someone else entirely', { workspaceId: 'ws-2' })));
    await screen.findByText('live from bob');
    expect(screen.queryByText('cara private note')).not.toBeInTheDocument();
    expect(screen.queryByText('someone else entirely')).not.toBeInTheDocument();
    // Updates for another conversation never touch this list either.
    act(() => socket.fire('message:updated', { ...msg('dm-cara', 'edited elsewhere'), id: 'm-1' }));
    expect(screen.queryByText('edited elsewhere')).not.toBeInTheDocument();
  });

  it('renders a repeated event once and keeps server order when events arrive out of order', async () => {
    const socket = new FakeSocket();
    render(<Chat channel={dmWithBob} socket={socket} />);
    await waitFor(() => expect(h.fetches).toContain('dm-bob'));
    const first = msg('dm-bob', 'first');
    const second = msg('dm-bob', 'second');
    act(() => socket.fire('message:received', second));
    act(() => socket.fire('message:received', first));
    act(() => socket.fire('message:received', second));
    await screen.findByText('first');
    expect(screen.getAllByText('second')).toHaveLength(1);
    expect(listed().map((t) => (t.includes('first') ? 'first' : t.includes('second') ? 'second' : t))).toEqual(['first', 'second']);
  });

  it('switching conversations carries nothing over — not even a late send acknowledgement — and removes the old listeners', async () => {
    h.byChannel['dm-bob'] = [msg('dm-bob', 'bob thread')];
    h.byChannel['dm-cara'] = [msg('dm-cara', 'cara thread', { senderId: 'cara', sender: { id: 'cara', username: 'cara' } })];
    const socket = new FakeSocket();
    localStorage.setItem('smartconnect:draft:me:dm-bob', JSON.stringify({ html: '<p>to bob</p>', text: 'to bob' }));
    const view = render(<Chat channel={dmWithBob} socket={socket} />);
    await screen.findByText('bob thread');
    const listenersBefore = socket.count('message:received');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.pendingAcks).toHaveLength(1));
    const sent = h.emits.find((e) => e.event === 'message:send')!.payload as { clientId: string; channelId: string };
    expect(sent.channelId).toBe('dm-bob');

    view.rerender(<Chat channel={dmWithCara} socket={socket} />);
    await screen.findByText('cara thread');
    expect(screen.queryByText('bob thread')).not.toBeInTheDocument();
    expect(screen.queryByText('to bob')).not.toBeInTheDocument();

    // The server answers the send made in Bob's conversation only now.
    act(() => h.pendingAcks[0]({ ok: true, message: msg('dm-bob', 'to bob', { senderId: 'me', sender: { id: 'me', username: 'mia' }, clientId: sent.clientId }) }));
    act(() => socket.fire('message:received', msg('dm-bob', 'bob again')));
    expect(screen.queryByText('to bob')).not.toBeInTheDocument();
    expect(screen.queryByText('bob again')).not.toBeInTheDocument();
    // One conversation's listeners at a time (no leak per switch).
    expect(socket.count('message:received')).toBe(listenersBefore);
  });

  it('after a reconnect, backfills this conversation only and keeps its order', async () => {
    h.byChannel['dm-bob'] = [msg('dm-bob', 'before drop')];
    const socket = new FakeSocket();
    render(<Chat channel={dmWithBob} socket={socket} />);
    await screen.findByText('before drop');
    h.byChannel['dm-bob'] = [...h.byChannel['dm-bob'], msg('dm-bob', 'missed while offline')];
    h.byChannel['dm-cara'] = [msg('dm-cara', 'not for this view')];
    h.fetches = [];
    act(() => socket.fire('subscriptions:ready', { channelIds: ['dm-bob', 'dm-cara'] }));
    await screen.findByText('missed while offline');
    expect(h.fetches).toEqual(['dm-bob']);
    expect(screen.queryByText('not for this view')).not.toBeInTheDocument();
  });
});
