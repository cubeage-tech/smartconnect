import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacesProvider } from '../../pages/workspace/WorkspacesProvider';
import { ProfileSettingsModal } from '../profile/ProfileSettingsModal';
import { PeopleDirectory } from './PeopleDirectory';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', username: 'mia' } }) }));
const api = vi.mocked(axios, true);

const member = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
  id,
  username,
  email: `${username}@example.com`,
  title: null,
  role: 'MEMBER',
  isOwner: false,
  joinedAt: '2026-01-01T00:00:00.000Z',
  presence: null,
  ...extra,
});

const profile = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
  ...member(id, username, extra),
  bio: 'Builds the design system',
  timezone: 'UTC',
  sharedChannels: [{ id: 'c1', name: 'General' }],
  ...extra,
});

interface Routes {
  viewerRole?: 'ADMIN' | 'MEMBER';
  isDefault?: boolean;
}

const mockApi = ({ viewerRole = 'MEMBER', isDefault = false }: Routes = {}) => {
  api.get.mockImplementation(async (url: string, config?: { params?: { q?: string } }) => {
    // The server's real shape: capabilities are computed by lib/policy (F1 reads them).
    if (url === '/api/workspaces') {
      return { data: [{ id: 'ws', isDefault, isOwner: false, organizationRole: null, myRole: viewerRole, capabilities: { canManage: viewerRole === 'ADMIN' } }] };
    }
    if (url === '/api/workspaces/ws/members/me') return { data: profile('me', 'me', { role: viewerRole }) };
    if (url === '/api/workspaces/ws/members/u1') return { data: profile('u1', 'alice', { title: 'Designer', presence: { id: 'u1', username: 'alice', status: 'away', emoji: '' } }) };
    if (url === '/api/workspaces/ws/members') {
      const all = [member('me', 'me'), member('u1', 'alice', { title: 'Designer' }), member('u2', 'bob')];
      const q = config?.params?.q;
      return { data: { members: q ? all.filter((m) => m.username.includes(q)) : all, nextCursor: null } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
};

beforeEach(() => vi.resetAllMocks());

describe('PeopleDirectory', () => {
  it('lists workspace members and searches on the server', async () => {
    mockApi();
    render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={vi.fn()} />, { wrapper: WorkspacesProvider });
    // The (empty) list renders while loading; wait for the members themselves.
    await screen.findByRole('button', { name: 'View profile of alice' });
    const list = screen.getByRole('list', { name: 'Workspace members' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Designer')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people' }), { target: { value: 'bob' } });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Workspace members' })).getAllByRole('listitem')).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith('/api/workspaces/ws/members', expect.objectContaining({ params: expect.objectContaining({ q: 'bob' }) }));
  });

  it('opens a profile; only admins can remove members', async () => {
    mockApi({ viewerRole: 'MEMBER' });
    const onMessage = vi.fn();
    const { unmount } = render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={onMessage} />, { wrapper: WorkspacesProvider });
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of alice' }));
    const dialog = await screen.findByRole('dialog', { name: 'alice' });
    expect(await within(dialog).findByText('Builds the design system')).toBeInTheDocument();
    expect(within(dialog).getByText('Away')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /remove from workspace/i })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Message' }));
    expect(onMessage).toHaveBeenCalledWith('u1');
    unmount();

    mockApi({ viewerRole: 'ADMIN' });
    api.delete.mockResolvedValue({ data: {} });
    render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={vi.fn()} />, { wrapper: WorkspacesProvider });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/workspaces'));
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of alice' }));
    const adminDialog = await screen.findByRole('dialog', { name: 'alice' });
    fireEvent.click(await within(adminDialog).findByRole('button', { name: /remove from workspace/i }));
    fireEvent.click(within(adminDialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/workspaces/ws/members/u1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'View profile of alice' })).not.toBeInTheDocument());
  });

  it('hides member management in the default workspace', async () => {
    mockApi({ viewerRole: 'ADMIN', isDefault: true });
    render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={vi.fn()} />, { wrapper: WorkspacesProvider });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/workspaces'));
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of alice' }));
    const dialog = await screen.findByRole('dialog', { name: 'alice' });
    await within(dialog).findByText('Builds the design system');
    expect(within(dialog).queryByRole('button', { name: /remove from workspace/i })).not.toBeInTheDocument();
  });
});

describe('People → selecting a person (production incident 2026-11-23)', () => {
  const directoryWith = (profileResponse: () => Promise<unknown>) => {
    let calls = 0;
    api.get.mockImplementation(async (url: string) => {
      if (url === '/api/workspaces') return { data: [{ id: 'ws', isDefault: false, isOwner: false, organizationRole: null, myRole: 'MEMBER', capabilities: {} }] };
      if (url === '/api/workspaces/ws/members') return { data: { members: [member('me', 'me'), member('u3', 'zoe')], nextCursor: null } };
      if (url === '/api/workspaces/ws/members/u3') {
        calls += 1;
        return profileResponse();
      }
      throw new Error(`unexpected GET ${url}`);
    });
    return { profileCalls: () => calls };
  };
  const httpError = (status: number, error: string) => Object.assign(new Error(error), { response: { status, data: { error } } });

  it('opens a profile whose optional fields are all missing', async () => {
    directoryWith(async () => ({
      data: { id: 'u3', username: 'zoe', email: null, role: 'MEMBER', isOwner: false, joinedAt: '2026-01-01T00:00:00.000Z', displayName: null, title: null, bio: null, timezone: null, presence: null, sharedChannels: [] },
    }));
    const onMessage = vi.fn();
    render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={onMessage} />, { wrapper: WorkspacesProvider });
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of zoe' }));
    const dialog = await screen.findByRole('dialog', { name: 'zoe' });
    expect(await within(dialog).findByText('Offline')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Message' }));
    expect(onMessage).toHaveBeenCalledWith('u3');
  });

  it('a server failure is shown with Try again, and Message still opens the conversation', async () => {
    let fail = true;
    const { profileCalls } = directoryWith(async () => {
      if (fail) throw httpError(500, 'Something went wrong on our side. Please try again.');
      return { data: profile('u3', 'zoe') };
    });
    const onMessage = vi.fn();
    render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={onMessage} />, { wrapper: WorkspacesProvider });
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of zoe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Profile' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'zoe' })).toBeInTheDocument();
    expect(profileCalls()).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fail = true;
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of zoe' }));
    const again = await screen.findByRole('dialog', { name: 'Profile' });
    await within(again).findByRole('alert');
    fireEvent.click(within(again).getByRole('button', { name: 'Message' }));
    expect(onMessage).toHaveBeenCalledWith('u3');
  });

  it('a person who is not (or no longer) a member gets a controlled error and no Message button', async () => {
    directoryWith(async () => {
      throw httpError(404, 'This person is not a member of this workspace.');
    });
    render(<PeopleDirectory workspaceId="ws" currentUserId="me" onMessage={vi.fn()} />, { wrapper: WorkspacesProvider });
    fireEvent.click(await screen.findByRole('button', { name: 'View profile of zoe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Profile' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('not a member of this workspace');
    expect(within(dialog).queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('ProfileSettingsModal', () => {
  it('loads and saves profile fields and the read-receipt preference', async () => {
    api.get.mockResolvedValue({ data: { displayName: 'Mia Lee', avatarId: null, title: 'Engineer', bio: null, timezone: null, readReceiptsEnabled: true } });
    api.patch.mockImplementation(async (_url: string, body: unknown) => ({ data: body }));
    const onClose = vi.fn();
    render(<ProfileSettingsModal onClose={onClose} />);

    const title = await screen.findByDisplayValue('Engineer');
    fireEvent.change(title, { target: { value: 'Staff Engineer' } });
    // QA H4: the display name is editable too.
    fireEvent.change(screen.getByDisplayValue('Mia Lee'), { target: { value: 'Mia Lee-Park' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /read receipts/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/users/me/profile', {
        displayName: 'Mia Lee-Park',
        title: 'Staff Engineer',
        bio: '',
        timezone: '',
        readReceiptsEnabled: false,
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape (accessible dialog)', async () => {
    api.get.mockResolvedValue({ data: { displayName: null, avatarId: null, title: null, bio: null, timezone: null, readReceiptsEnabled: true } });
    const onClose = vi.fn();
    render(<ProfileSettingsModal onClose={onClose} />);
    await screen.findByRole('dialog', { name: 'Profile & preferences' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
