import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useHierarchy } from '../../hooks/useHierarchy';
import type { MemberProvisionResult } from '../../lib/api/teamManagement';
import { Button } from '../ui';
import { AddMembersModal } from './AddMembersModal';
import { AddTeamMemberModal } from './AddTeamMemberModal';
import { MemberCredentialsModal } from './MemberCredentialsModal';

/**
 * T.36 — "Add members" on a workspace's People page, opening the same flows as
 * Workspace settings → Members:
 *  - a Team Lead who manages the workspace: one or several addresses — new
 *    people get a Member account (activation e-mail with a temporary
 *    password when e-mail can be sent, one-time details to share otherwise);
 *    existing accounts get a workspace invitation they accept themselves;
 *  - any other manager: invite existing accounts (Add people), who accept it.
 * Shown only to people who may add members; the server enforces every rule.
 */
export const AddWorkspaceMemberButton = ({
  workspaceId,
  workspaceName,
  canManageInvitations,
  onChanged,
}: {
  workspaceId: string;
  workspaceName: string;
  canManageInvitations: boolean;
  onChanged: () => void;
}) => {
  const hierarchy = useHierarchy();
  const canProvision = canManageInvitations && hierarchy?.canProvisionMembers === true;
  const [open, setOpen] = useState(false);
  const [provisioned, setProvisioned] = useState<MemberProvisionResult | null>(null);
  if (!canManageInvitations) return null;

  return (
    <>
      <Button icon={<UserPlus size={15} aria-hidden="true" />} onClick={() => setOpen(true)}>
        Add members
      </Button>
      {open && canProvision && (
        <AddTeamMemberModal
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onClose={() => setOpen(false)}
          onCreated={(result) => {
            setOpen(false);
            setProvisioned(result);
          }}
          onChanged={onChanged}
        />
      )}
      {open && !canProvision && <AddMembersModal workspaceId={workspaceId} workspaceName={workspaceName} onClose={() => setOpen(false)} onInvited={onChanged} />}
      {provisioned && <MemberCredentialsModal result={provisioned} workspaceName={workspaceName} onClose={() => setProvisioned(null)} />}
    </>
  );
};
