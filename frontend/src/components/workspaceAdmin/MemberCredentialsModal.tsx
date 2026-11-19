import type { MemberProvisionResult } from '../../lib/api/teamManagement';
import { OneTimeCredentialsModal } from '../ui/OneTimeCredentialsModal';

/** What happened to the activation e-mail, as the server reported it. */
const emailOutcome = ({ delivery, credentials }: MemberProvisionResult) => {
  if (!delivery) return 'no e-mail is sent';
  if (delivery.emailSent) return `an activation e-mail was sent to ${credentials.loginId}`;
  if (delivery.emailUnavailable) return "no e-mail was sent (e-mail delivery isn't configured)";
  return 'the activation e-mail could not be sent';
};

/**
 * The one-time result of adding a new team member (Stage 3 provisioning),
 * shared by Workspace settings → Members and the People page (T.36): what
 * happened — including whether the activation e-mail went out — and the
 * link, login and temporary password to hand over if it did not. The
 * temporary password works only on the activation link, where the member
 * chooses their own password before signing in.
 */
export const MemberCredentialsModal = ({ result, workspaceName, onClose }: { result: MemberProvisionResult; workspaceName: string; onClose: () => void }) => {
  const name = result.invitation.account.displayName || result.invitation.account.username;
  return (
    <OneTimeCredentialsModal
      title="Member invitation"
      subtitle={`Account created for ${name}. They join ${workspaceName} when they activate it — ${emailOutcome(result)}. Share these privately: anyone with both the link and the temporary password can activate this account.`}
      intro={`You've been added to SmartConnect as a member of ${workspaceName}.`}
      credentials={result.credentials}
      onClose={onClose}
    />
  );
};
