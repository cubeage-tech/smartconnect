import { Mail } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { formatDate } from '../../lib/adminAccess';
import { errorMessage, invitationsApi } from '../../lib/api';
import type { ReceivedInvitation } from '../../lib/api';
import { useWorkspace } from '../../pages/workspace/WorkspaceContext';
import { useWorkspaces } from '../../pages/workspace/WorkspacesProvider';
import { Button, Modal } from '../ui';

/**
 * In-app workspace invitations for an existing account (GET
 * /api/invitations/received): a button on the workspace rail, shown only
 * while something is pending, opens the list. Accept joins exactly that
 * workspace as a member — every other membership stays — refreshes the
 * workspace list and opens it; Decline joins nothing. The server re-checks
 * everything (the invitation is this account's, pending, unexpired). Live:
 * 'invitations:changed' arrives when someone invites or revokes.
 */
export const PendingInvitations = () => {
  const { socket } = useWorkspace(); // the rail lives inside WorkspaceLayout's context
  const { refresh } = useWorkspaces();
  const navigate = useNavigate();
  const query = useApiQuery(() => invitationsApi.listReceivedInvitations(), []);
  const invitations: ReceivedInvitation[] = Array.isArray(query.data) ? query.data : [];
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    query.reload({ silent: true }).catch(() => undefined);
  };
  useSocketEvent(socket, 'invitations:changed', reload);

  const remove = (id: string) => query.setData((prev) => (Array.isArray(prev) ? prev.filter((inv) => inv.id !== id) : prev));

  const accept = async (invitation: ReceivedInvitation) => {
    setBusyId(invitation.id);
    try {
      const joined = await invitationsApi.acceptReceivedInvitation(invitation.id);
      remove(invitation.id);
      await refresh().catch(() => undefined);
      toast.success(`You joined ${invitation.workspace.name}.`);
      setOpen(false);
      navigate(`/${joined.workspaceId}/c/${joined.generalChannelId}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not accept the invitation.'));
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (invitation: ReceivedInvitation) => {
    setBusyId(invitation.id);
    try {
      await invitationsApi.declineReceivedInvitation(invitation.id);
      remove(invitation.id);
      toast.success(`Invitation to ${invitation.workspace.name} declined.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not decline the invitation.'));
      reload();
    } finally {
      setBusyId(null);
    }
  };

  if (invitations.length === 0 && !open) return null;
  const count = invitations.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Workspace invitations"
        aria-label={`Workspace invitations (${count})`}
        className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors active:scale-95 shrink-0 bg-white/[0.07] text-sidebar-fg-muted hover:bg-white/[0.13] hover:text-sidebar-fg"
      >
        <Mail size={18} aria-hidden="true" />
        {count > 0 && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count}
          </span>
        )}
      </button>
      {open && (
        <Modal title="Workspace invitations" subtitle="Accept to join. Your other workspaces stay as they are." onClose={() => setOpen(false)}>
          {count === 0 ? (
            <p className="text-sm text-fg-muted">No pending invitations.</p>
          ) : (
            <ul aria-label="Pending workspace invitations" className="divide-y divide-line">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-fg truncate">{invitation.workspace.name}</div>
                    <div className="text-xs text-fg-muted">
                      Invited by {invitation.inviter.displayName || invitation.inviter.username} · expires {formatDate(invitation.expiresAt)}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => decline(invitation)}
                      disabled={busyId !== null}
                      aria-label={`Decline invitation to ${invitation.workspace.name}`}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => accept(invitation)}
                      loading={busyId === invitation.id}
                      disabled={busyId !== null}
                      aria-label={`Accept invitation to ${invitation.workspace.name}`}
                    >
                      Accept
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
};
