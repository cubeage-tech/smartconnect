import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: after a successful public sign-up, a new Member was shown the
 * "Create a workspace" dialog. The real client path is exercised here —
 * AuthProvider (session), LoginPage + AuthForm (sign-up), ProtectedRoute,
 * WorkspacesProvider (membership loading) and WorkspaceRedirect (landing) —
 * with only the HTTP layer replaced. A new Member must go straight into the
 * existing SmartConnect Collab and never be offered to create a workspace.
 */

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: { request: { use: vi.fn(() => 1), eject: vi.fn() }, response: { use: vi.fn(() => 1), eject: vi.fn() } },
  isAxiosError: (err: unknown) => Boolean((err as { isAxiosError?: boolean })?.isAxiosError),
}));
vi.mock('axios', () => ({ default: axiosMock }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const modal = vi.hoisted(() => ({ opened: vi.fn() }));
vi.mock('../components/sidebar/CreateWorkspaceModal', () => ({
  CreateWorkspaceModal: ({ isOpen }: { isOpen: boolean }) => {
    if (!isOpen) return null;
    modal.opened();
    return <div role="dialog" aria-label="Create a workspace" />;
  },
}));

import { AuthProvider } from '../contexts/AuthContext';
import { LoginPage } from '../pages/auth/LoginPage';
import { WorkspaceRedirect } from '../pages/workspace/WorkspaceRedirect';
import { WorkspacesProvider } from '../pages/workspace/WorkspacesProvider';
import { ProtectedRoute } from '../routes/ProtectedRoute';

const COLLAB_ID = '6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const COLLAB = { id: COLLAB_ID, name: 'SmartConnect Collab', slug: 'default', isDefault: true, myRole: 'MEMBER', isOwner: false, ownerId: 'system' };
const NEW_USER = { id: 'u-new', username: 'nadia.khan', email: 'nadia@acme.io', role: 'USER', lastActiveWorkspaceId: COLLAB_ID };
const PASSWORD = 'Password123!';

const InWorkspace = () => <output data-testid="workspace">{useParams().workspaceId}</output>;

/** The same route structure as routes/router.tsx, reduced to what sign-up touches. */
const renderApp = () =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <WorkspacesProvider>
                  <Outlet />
                </WorkspacesProvider>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<WorkspaceRedirect />} />
            <Route path="/:workspaceId" element={<InWorkspace />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );

const signUpThroughTheForm = () => {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Nadia Khan' } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'nadia@acme.io' } });
  fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole('button', { name: /Create Account/ }));
};

const serve = (workspaces: unknown[]) => {
  axiosMock.post.mockImplementation(async (url: string) => {
    if (url === '/api/auth/signup') return { data: { token: 'tok-new', user: NEW_USER, invitation: null } };
    throw new Error(`unexpected POST ${url}`);
  });
  axiosMock.get.mockImplementation(async (url: string) => {
    if (url === '/api/workspaces') return { data: workspaces };
    if (url === '/api/me/hierarchy') return { data: { role: 'MEMBER', canCreateWorkspaces: false, canProvisionMembers: false } };
    throw new Error(`unexpected GET ${url}`);
  });
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('public sign-up → SmartConnect Collab', () => {
  it('a new Member lands directly in the existing SmartConnect Collab; the create dialog never appears', async () => {
    serve([COLLAB]);
    renderApp();
    signUpThroughTheForm();

    expect(await screen.findByTestId('workspace')).toHaveTextContent(COLLAB_ID);
    // The session was initialised: the workspace list was requested with it.
    expect(axiosMock.defaults.headers.common.Authorization).toBe('Bearer tok-new');
    expect(axiosMock.get).toHaveBeenCalledWith('/api/workspaces');
    expect(axiosMock.post).toHaveBeenCalledWith('/api/auth/signup', expect.objectContaining({ fullName: 'Nadia Khan', email: 'nadia@acme.io' }));
    expect(modal.opened).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/not in a workspace/i)).not.toBeInTheDocument();
  });

  it('if the server lists no workspace (a setup problem), a Member sees an explanation with retry — never a create option', async () => {
    serve([]);
    renderApp();
    signUpThroughTheForm();

    expect(await screen.findByText("SmartConnect Collab isn't available right now")).toBeInTheDocument();
    await waitFor(() => expect(axiosMock.get).toHaveBeenCalledWith('/api/me/hierarchy'));
    expect(screen.queryByRole('button', { name: 'Create a workspace' })).not.toBeInTheDocument();
    expect(modal.opened).not.toHaveBeenCalled();

    // Once the server lists Collab again, "Try again" opens it.
    axiosMock.get.mockImplementation(async (url: string) => ({ data: url === '/api/workspaces' ? [COLLAB] : { role: 'MEMBER', canCreateWorkspaces: false, canProvisionMembers: false } }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('workspace')).toHaveTextContent(COLLAB_ID);
  });
});
