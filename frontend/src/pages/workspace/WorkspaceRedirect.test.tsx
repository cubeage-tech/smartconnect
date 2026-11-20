import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hierarchy } from '../../lib/api/teamManagement';
import type { Workspace } from '../../types';
import { WorkspaceRedirect } from './WorkspaceRedirect';

/**
 * "/" — the landing route after every sign-in and sign-up. Regression: a new
 * Member was shown the "Create a workspace" dialog. The dialog must never
 * open by itself, and only Team Leads / Company Admins may ever be offered it.
 */

const state = vi.hoisted(() => ({
  user: { id: 'u1', username: 'nadia', role: 'USER', lastActiveWorkspaceId: null as string | null },
  workspaces: [] as Partial<Workspace>[],
  loading: false,
  error: null as string | null,
  refresh: vi.fn(() => Promise.resolve([])), // like the real one: a promise of the list
  hierarchy: null as Hierarchy | null,
  modalOpened: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('./WorkspacesProvider', () => ({
  useWorkspaces: () => ({ workspaces: state.workspaces, loading: state.loading, error: state.error, refresh: state.refresh }),
}));
vi.mock('../../hooks/useHierarchy', () => ({ useHierarchy: () => state.hierarchy }));
// Observable stand-in for the real dialog: records every time it is shown open.
vi.mock('../../components/sidebar/CreateWorkspaceModal', () => ({
  CreateWorkspaceModal: ({ isOpen }: { isOpen: boolean }) => {
    if (!isOpen) return null;
    state.modalOpened();
    return <div role="dialog" aria-label="Create a workspace" />;
  },
}));

const COLLAB = { id: 'collab', name: 'SmartConnect Collab', isDefault: true };
const TEAM = { id: 'team-ws', name: 'SmartUnifolio', isDefault: false };
const MEMBER: Hierarchy = { role: 'MEMBER', canCreateWorkspaces: false, canProvisionMembers: false };
const TEAM_LEAD: Hierarchy = { role: 'TEAM_LEAD', canCreateWorkspaces: true, canProvisionMembers: true };

const Opened = () => <output data-testid="opened">{useParams().workspaceId}</output>;
const renderAtRoot = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<WorkspaceRedirect />} />
        <Route path="/:workspaceId" element={<Opened />} />
      </Routes>
    </MemoryRouter>
  );

afterEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { workspaces: [], loading: false, error: null, hierarchy: null });
  state.user.lastActiveWorkspaceId = null;
});

describe('WorkspaceRedirect — landing after sign-in and sign-up', () => {
  it('a newly signed-up Member lands directly in SmartConnect Collab, with no create dialog', () => {
    Object.assign(state, { workspaces: [COLLAB], hierarchy: MEMBER });
    state.user.lastActiveWorkspaceId = 'collab'; // what the server sets at sign-up
    renderAtRoot();
    expect(screen.getByTestId('opened')).toHaveTextContent('collab');
    expect(state.modalOpened).not.toHaveBeenCalled();
  });

  it('lands in Collab even before the account has a last-active workspace', () => {
    Object.assign(state, { workspaces: [COLLAB], hierarchy: MEMBER });
    renderAtRoot();
    expect(screen.getByTestId('opened')).toHaveTextContent('collab');
  });

  it('an existing user keeps their last-active workspace', () => {
    Object.assign(state, { workspaces: [COLLAB, TEAM] });
    state.user.lastActiveWorkspaceId = 'team-ws';
    renderAtRoot();
    expect(screen.getByTestId('opened')).toHaveTextContent('team-ws');
  });

  it('while memberships are still loading it waits — no empty-workspace screen, no dialog', () => {
    Object.assign(state, { loading: true, workspaces: [], hierarchy: TEAM_LEAD });
    renderAtRoot();
    expect(screen.queryByTestId('opened')).not.toBeInTheDocument();
    expect(screen.queryByText(/isn't available/)).not.toBeInTheDocument();
    expect(state.modalOpened).not.toHaveBeenCalled();
  });

  it('a failed load shows a retryable error, never the create dialog', () => {
    Object.assign(state, { error: 'Could not load your workspaces.', hierarchy: TEAM_LEAD });
    renderAtRoot();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your workspaces.');
    expect(screen.queryByRole('button', { name: 'Create a workspace' })).not.toBeInTheDocument();
    expect(state.modalOpened).not.toHaveBeenCalled();
  });

  it('a Member with no workspace listed is never offered to create one — they can retry', () => {
    Object.assign(state, { workspaces: [], hierarchy: MEMBER });
    renderAtRoot();
    expect(screen.getByText("SmartConnect Collab isn't available right now")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.modalOpened).not.toHaveBeenCalled();
  });

  it('while the role is still unknown, no create option is shown', () => {
    Object.assign(state, { workspaces: [], hierarchy: null });
    renderAtRoot();
    expect(screen.queryByRole('button', { name: 'Create a workspace' })).not.toBeInTheDocument();
  });

  it('a Team Lead (or Admin) may create a workspace — but the dialog opens only when they choose to', () => {
    Object.assign(state, { workspaces: [], hierarchy: TEAM_LEAD });
    renderAtRoot();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.modalOpened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create a workspace' }));
    expect(screen.getByRole('dialog', { name: 'Create a workspace' })).toBeInTheDocument();
  });
});
