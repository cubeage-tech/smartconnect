import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Channel, User } from '../../types';
import { HomeView } from './HomeView';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', username: 'sam.karale' } }) }));

const channel = (id: string, name: string, extra: Partial<Channel> = {}) => ({ id, name, workspaceId: 'ws', ...extra }) as Channel;
const dm = (id: string, name: string, otherUserId: string, extra: Partial<Channel> = {}) =>
  ({ id, name, otherUserId, isDM: true, workspaceId: 'ws', lastActivityAt: '2026-11-01T08:00:00.000Z', ...extra }) as Channel;
const person = (id: string, username: string) => ({ id, username, email: `${username}@example.com`, status: 'active' }) as unknown as User;

const channels = [channel('c-general', 'General', { description: 'Company-wide' }), channel('c-random', 'Random'), channel('c-ann', 'Announcements')];
const dms = [
  dm('d-priya', 'priya', 'u-priya', { lastActivityAt: '2026-11-01T09:00:00.000Z', lastMessage: { id: 'm1', preview: 'Can you review the PR?', senderId: 'u-priya', createdAt: '2026-11-01T09:00:00.000Z' } }),
  dm('d-arjun', 'arjun', 'u-arjun', { lastActivityAt: '2026-11-01T10:00:00.000Z', lastMessage: { id: 'm2', preview: 'Merged it', senderId: 'me', createdAt: '2026-11-01T10:00:00.000Z' } }),
];

const renderHome = (props: Partial<Parameters<typeof HomeView>[0]> = {}) => {
  const onSelectChannel = vi.fn();
  const onViewChange = vi.fn();
  render(<HomeView channels={channels} dms={dms} onSelectChannel={onSelectChannel} onViewChange={onViewChange} workspaceName="SmartConnect Collab" {...props} />);
  return { onSelectChannel, onViewChange };
};

beforeEach(() => localStorage.clear());

describe('Home', () => {
  it('summarises what is unread across channels and conversations', () => {
    renderHome({ unreadCounts: { 'c-general': 2, 'd-priya': 3, 'c-ann': 0 } });
    expect(screen.getByText('5 unread messages in 2 conversations since you last looked.')).toBeInTheDocument();
  });

  it('says so when everything is read', () => {
    renderHome({ unreadCounts: {} });
    expect(screen.getByText("You're all caught up in SmartConnect Collab.")).toBeInTheDocument();
  });

  it('shows who else is online now (never yourself)', () => {
    renderHome({ onlineUsers: [person('me', 'sam.karale'), person('u-priya', 'priya'), person('u-arjun', 'arjun')] });
    const online = screen.getByRole('region', { name: 'Online now' });
    expect(within(online).getByText('2 people online now')).toBeInTheDocument();
    expect(within(online).getAllByRole('listitem')).toHaveLength(2);
    expect(within(online).queryByText('sam.karale')).not.toBeInTheDocument();
  });

  it('lists recent conversations newest first, with previews, and opens one', () => {
    const { onSelectChannel } = renderHome({ unreadCounts: { 'd-priya': 3 } });
    const recent = screen.getByRole('region', { name: 'Pick up where you left off' });
    const rows = within(recent).getAllByRole('button').filter((b) => b.textContent?.includes('ago'));
    expect(rows[0]).toHaveTextContent('arjun');
    expect(rows[0]).toHaveTextContent('You: Merged it');
    expect(rows[1]).toHaveTextContent('priya');
    expect(rows[1]).toHaveTextContent('Can you review the PR?');
    expect(rows[1]).toHaveTextContent('3 unread');
    fireEvent.click(rows[1]);
    expect(onSelectChannel).toHaveBeenCalledWith(dms[0]);
  });

  it('puts channels with unread messages first', () => {
    renderHome({ unreadCounts: { 'c-random': 4 } });
    const list = screen.getByRole('region', { name: 'Your channels' });
    const names = within(list).getAllByRole('button').map((b) => b.textContent ?? '').filter((t) => !t.startsWith('See all'));
    expect(names[0]).toContain('Random');
    expect(names[0]).toContain('4 unread');
    expect(names.slice(1).map((n) => n.split(/Company|Public/)[0])).toEqual(['Announcements', 'General']);
  });

  it('offers a way forward when there are no conversations or channels yet', () => {
    const { onViewChange } = renderHome({ channels: [], dms: [] });
    expect(screen.getByText('No conversations yet. Say hello to someone on your team.')).toBeInTheDocument();
    expect(screen.getByText("You're not in any channels yet.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Find people' })[0]);
    expect(onViewChange).toHaveBeenCalledWith('directory?tab=People');
  });
});
