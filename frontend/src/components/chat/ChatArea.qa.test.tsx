import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { forwardRef, ReactNode, useImperativeHandle } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, WorkspaceContextValue } from '../../pages/workspace/WorkspaceContext';
import { Channel } from '../../types';
import { ChatArea } from './ChatArea';

/**
 * QA H3 / M1 / H2 / L14 — the same harness as ChatArea.p3.test.tsx.
 *
 * P3 — the chat area in a real render (editor included; only the virtual
 * list, emoji picker and link previews are simplified): message actions and
 * attachments are accessible, polls are keyboard-operable, the typing
 * indicator clears when the typist's message lands, and the channel actions
 * stay reachable from a compact header.
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
  messageRequests: 0,
  messagesGate: null as Promise<void> | null,
  failMessages: false,
  failPost: false,
  posts: [] as { url: string; body: unknown }[],
  messages: [] as unknown[],
  capabilities: {} as Record<string, boolean>,
  emits: [] as { event: string; payload: unknown }[],
  ack: { ok: true } as Record<string, unknown>,
  ackError: null as Error | null,
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
      if (url.endsWith('/messages')) {
        h.messageRequests += 1;
        if (h.messagesGate) await h.messagesGate;
        if (h.failMessages) throw new Error('network down');
        return { data: { messages: h.messages, nextCursor: null, hasMore: false } };
      }
      if (url.endsWith('/details')) {
        return {
          data: {
            id: 'c1', workspaceId: 'ws', name: 'design', visibility: 'PUBLIC', type: 'PUBLIC', isAnnouncement: false,
            archived: false, isGeneral: false, memberCount: 3, capabilities: h.capabilities,
          },
        };
      }
      if (url.endsWith('/read-receipts')) return { data: { enabled: false, receipts: [] } };
      return { data: [] };
    },
    post: async (url: string, body: unknown) => {
      h.posts.push({ url, body });
      if (h.failPost) throw { response: { data: { error: 'Reaction refused' } } };
      return { data: {} };
    },
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
        setTimeout(() => (h.ackError ? cb?.(h.ackError, undefined) : cb?.(null, h.ack)), 0);
      },
    };
  }
  fire(event: string, payload: unknown) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }
}

const context = (socket: FakeSocket): WorkspaceContextValue =>
  ({
    workspaceId: 'ws',
    socket: socket as unknown as Socket,
    connectionStatus: 'connected',
    channels: [],
    channelsLoading: false,
    dms: [],
    dmsLoading: false,
    onlineUsers: [],
    users: [],
    readState: {},
    unreadCounts: {},
    clearUnread: vi.fn(),
    markChannelRead: vi.fn(),
    fetchChannels: vi.fn(),
    fetchDMs: vi.fn(),
    upsertDM: vi.fn(),
    removeConversation: vi.fn(),
    addChannel: vi.fn(),
    startDM: vi.fn(),
    startCall: vi.fn(),
    hasActiveCall: false,
    endActiveCall: vi.fn(),
  }) as WorkspaceContextValue;

const channel: Channel = { id: 'c1', name: 'design', workspaceId: 'ws' } as Channel;
const msg = (over: Record<string, unknown>) => ({
  id: `m-${Math.random().toString(36).slice(2)}`,
  channelId: 'c1',
  workspaceId: 'ws',
  senderId: 'bob',
  sender: { id: 'bob', username: 'bob' },
  content: '<p>hello</p>',
  createdAt: new Date().toISOString(),
  reactions: [],
  parentId: null,
  ...over,
});

const renderChat = (socket = new FakeSocket()) => {
  const onStartCall = vi.fn();
  render(
    <WorkspaceContext.Provider value={context(socket)}>
      <MemoryRouter>
        <ChatArea channel={channel} socket={socket as unknown as Socket} onStartCall={onStartCall} />
      </MemoryRouter>
    </WorkspaceContext.Provider>
  );
  return { socket, onStartCall };
};

beforeEach(() => {
  h.messages = [];
  h.capabilities = { canRead: true, canPost: true, canReply: true, canReact: true, canLeave: true, canAddMembers: true };
  h.emits = [];
  h.ack = { ok: true };
  h.ackError = null;
  h.messageRequests = 0;
  h.messagesGate = null;
  h.failMessages = false;
  h.failPost = false;
  h.posts = [];
  localStorage.clear();
});

describe('QA H3 — the message list never claims "no messages" before it knows', () => {
  it('shows a loading skeleton while the history loads, then the empty state only if it is really empty', async () => {
    let open!: () => void;
    h.messagesGate = new Promise<void>((resolve) => (open = resolve));
    renderChat();
    expect(await screen.findByRole('status', { name: 'Loading messages' })).toBeInTheDocument();
    expect(screen.queryByText('No messages yet — say hello!')).not.toBeInTheDocument();
    await act(async () => open());
    expect(await screen.findByText('No messages yet — say hello!')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading messages' })).not.toBeInTheDocument();
  });

  it('shows the history, not the empty state, once it arrives', async () => {
    h.messages = [msg({ id: 'm1', content: '<p>first post</p>' })];
    renderChat();
    expect(await screen.findByText('first post')).toBeInTheDocument();
    expect(screen.queryByText('No messages yet — say hello!')).not.toBeInTheDocument();
  });

  it('a failed load is an error with Retry (never "No messages yet"), and Retry loads it', async () => {
    h.failMessages = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderChat();
    expect(await screen.findByText('Messages couldn’t be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No messages yet — say hello!')).not.toBeInTheDocument();
    h.failMessages = false;
    h.messages = [msg({ id: 'm2', content: '<p>back again</p>' })];
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('back again')).toBeInTheDocument();
    expect(h.messageRequests).toBe(2);
    err.mockRestore();
  });
});

describe('QA H2 / M1 — the reaction picker is a closable popover outside the message list', () => {
  it('opens in <body> (not inside the scrolling list), closes on Escape and on a click on another message', async () => {
    h.messages = [msg({ id: 'a', content: '<p>first</p>' }), msg({ id: 'b', content: '<p>second</p>' })];
    renderChat();
    await screen.findByText('second');
    const [react] = screen.getAllByRole('button', { name: 'Add reaction' });
    fireEvent.click(react);
    const picker = await screen.findByRole('dialog', { name: 'Choose a reaction' });
    expect(picker.parentElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Add reaction' })[0]);
    await screen.findByRole('dialog', { name: 'Choose a reaction' });
    fireEvent.pointerDown(screen.getByText('second'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).not.toBeInTheDocument());
  });
});

describe('QA L14 — reactions show at once and roll back if refused', () => {
  const withReaction = () => [msg({ id: 'r', content: '<p>react to me</p>', reactions: [{ emoji: '👍', count: 1, users: [{ id: 'bob', username: 'bob' }] }] })];

  it('adds my reaction immediately', async () => {
    h.messages = withReaction();
    renderChat();
    const pill = await screen.findByRole('button', { name: /👍 1: react/ });
    fireEvent.click(pill);
    expect(await screen.findByRole('button', { name: /👍 2: remove your reaction/ })).toBeInTheDocument();
    expect(h.posts.at(-1)).toEqual({ url: '/api/messages/r/reactions', body: { emoji: '👍' } });
  });

  it('restores the previous reactions when the server refuses', async () => {
    h.messages = withReaction();
    h.failPost = true;
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: /👍 1: react/ }));
    expect(await screen.findByRole('button', { name: /👍 1: react/ })).toBeInTheDocument();
    expect(await screen.findByText('Reaction refused')).toBeInTheDocument();
  });
});
