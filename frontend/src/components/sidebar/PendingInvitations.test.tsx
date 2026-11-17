import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, WorkspaceContextValue } from '../../pages/workspace/WorkspaceContext';
import { PendingInvitations } from './PendingInvitations';

/**
 * Existing accounts get workspace invitations in the app: a button on the
 * workspace rail (only when something is pending) opens the list; Accept
 * joins exactly that workspace — every other membership stays — and opens
 * it; Decline joins nothing.
 */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
  },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const refresh = vi.fn().mockResolvedValue(undefined);
vi.mock('../../pages/workspace/WorkspacesProvider', () => ({ useWorkspaces: () => ({ workspaces: [], loading: false, refresh }) }));
const api = vi.mocked(axios, true);

const APOLLO = { id: 'i1', workspace: { id: 'w1', name: 'Apollo' }, inviter: { id: 'l1', username: 'lena', displayName: 'Lena Lead' }, createdAt: '2026-11-17T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' };
const ZEUS = { id: 'i2', workspace: { id: 'w2', name: 'Zeus' }, inviter: { id: 'l2', username: 'omar', displayName: null }, createdAt: '2026-11-16T00:00:00Z', expiresAt: '2026-11-30T00:00:00Z' };

const handlers: Record<string, (payload: unknown) => void> = {};
const socket = { on: vi.fn((event: string, handler: (payload: unknown) => void) => { handlers[event] = handler; }), off: vi.fn() };

const Where = () => <output data-testid="where">{useLocation().pathname}</output>;
const renderRail = () =>
  render(
    <WorkspaceContext.Provider value={{ socket } as unknown as WorkspaceContextValue}>
      <MemoryRouter initialEntries={['/w0/home']}>
        <Routes>
          <Route path="*" element={<><PendingInvitations /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </WorkspaceContext.Provider>
  );
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  refresh.mockResolvedValue(undefined);
  api.get.mockResolvedValue({ data: [APOLLO, ZEUS] });
});
afterEach(() => vi.clearAllMocks());

describe('PendingInvitations (workspace rail)', () => {
  it('shows nothing when there is no pending invitation', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderRail();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/invitations/received'));
    expect(screen.queryByRole('button', { name: /invitations/i })).not.toBeInTheDocument();
  });

  it('lists the invitations: who invited them to which workspace', async () => {
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace invitations (2)' }));
    const dialog = screen.getByRole('dialog', { name: 'Workspace invitations' });
    expect(within(dialog).getByText('Apollo')).toBeInTheDocument();
    expect(within(dialog).getByText(/Invited by Lena Lead/)).toBeInTheDocument();
    expect(within(dialog).getByText('Zeus')).toBeInTheDocument();
    expect(within(dialog).getByText(/Invited by omar/)).toBeInTheDocument();
  });

  it('Accept joins that workspace, refreshes the workspace list and opens it', async () => {
    api.post.mockResolvedValue({ data: { workspaceId: 'w1', generalChannelId: 'c1' } });
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace invitations (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Apollo' }));
    await waitFor(() => expect(where()).toBe('/w1/c/c1'));
    expect(api.post).toHaveBeenCalledWith('/api/invitations/received/i1/accept', undefined);
    expect(refresh).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('You joined Apollo.');
  });

  it('Decline joins nothing and removes the invitation from the list', async () => {
    api.post.mockResolvedValue({ data: { id: 'i2', state: 'declined' } });
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace invitations (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline invitation to Zeus' }));
    await waitFor(() => expect(screen.queryByText('Zeus')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/api/invitations/received/i2/decline', undefined);
    expect(api.post).not.toHaveBeenCalledWith(expect.stringMatching(/accept/), undefined);
    expect(refresh).not.toHaveBeenCalled();
    expect(where()).toBe('/w0/home');
  });

  it('shows the server reason when an invitation can no longer be accepted, and refreshes the list', async () => {
    api.post.mockRejectedValue({ response: { status: 400, data: { error: 'This invitation has been revoked.' } } });
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace invitations (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Apollo' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This invitation has been revoked.'));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(where()).toBe('/w0/home');
  });

  it('refreshes when an invitation arrives or is revoked (live event)', async () => {
    api.get.mockResolvedValueOnce({ data: [] });
    renderRail();
    await waitFor(() => expect(handlers['invitations:changed']).toBeDefined());
    api.get.mockResolvedValue({ data: [APOLLO] });
    handlers['invitations:changed']({ workspaceId: 'w1' });
    expect(await screen.findByRole('button', { name: 'Workspace invitations (1)' })).toBeInTheDocument();
  });
});
