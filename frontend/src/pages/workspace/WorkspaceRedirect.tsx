import { Globe, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CreateWorkspaceModal } from '../../components/sidebar/CreateWorkspaceModal';
import { Button, EmptyState, ErrorState } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useHierarchy } from '../../hooks/useHierarchy';
import { pickLandingWorkspace } from '../../lib/workspaceLanding';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { useWorkspaces } from './WorkspacesProvider';

/**
 * Shown only if the server lists no workspace at all — normally impossible,
 * since every account belongs to SmartConnect Collab (sign-up refuses to
 * create an account without it). It is a setup problem, not onboarding:
 *  - nobody is pushed into creating a workspace — the create dialog opens
 *    only when someone allowed to create workspaces (Team Lead, Company
 *    Admin; the server decides, useHierarchy) explicitly asks for it;
 *  - a Member is told what happened and can retry; they never see a create
 *    option (and the server refuses them anyway).
 */
const NoWorkspaceAvailable = ({ onRetry }: { onRetry: () => void }) => {
  const hierarchy = useHierarchy();
  const canCreate = hierarchy?.canCreateWorkspaces === true;
  const [creating, setCreating] = useState(false);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-secondary p-6">
      <EmptyState
        icon={<Globe size={24} />}
        title="SmartConnect Collab isn't available right now"
        description="Your account is fine, but the shared workspace couldn't be loaded. Try again in a moment — if it keeps happening, contact your administrator."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" icon={<RefreshCw size={15} aria-hidden="true" />} onClick={onRetry}>
              Try again
            </Button>
            {canCreate && (
              <Button icon={<Plus size={15} aria-hidden="true" />} onClick={() => setCreating(true)}>
                Create a workspace
              </Button>
            )}
          </div>
        }
      />
      {canCreate && <CreateWorkspaceModal isOpen={creating} onClose={() => setCreating(false)} onCreated={onRetry} />}
    </div>
  );
};

// Landing route for "/" — every sign-in, sign-up and invitation lands here.
// It waits for the user's workspace list (WorkspacesProvider, F1), then opens
// their last-active workspace (User.lastActiveWorkspaceId — SmartConnect
// Collab for a new sign-up, set by the server), or failing that one of their
// own/shared workspaces before Collab (lib/workspaceLanding.ts).
export const WorkspaceRedirect = () => {
  const { user } = useAuth();
  const { workspaces, loading, error, refresh } = useWorkspaces();
  const retry = () => {
    refresh().catch(() => undefined);
  };

  if (loading) return <LoadingScreen />;
  if (error && workspaces.length === 0) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-secondary p-6">
        <ErrorState title="Couldn't load your workspaces" message={error} onRetry={retry} />
      </div>
    );
  }

  const target = pickLandingWorkspace(workspaces, user?.lastActiveWorkspaceId);
  if (target) return <Navigate to={`/${target}`} replace />;

  return <NoWorkspaceAvailable onRetry={retry} />;
};
