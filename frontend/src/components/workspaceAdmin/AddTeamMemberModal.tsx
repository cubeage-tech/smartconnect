import { Copy, UserPlus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { errorMessage, invitationsApi, teamManagementApi, toApiError } from '../../lib/api';
import type { MemberProvisionConflict, MemberProvisionResult } from '../../lib/api/teamManagement';
import { Button, Field, Modal, TextArea, TextInput } from '../ui';
import { invitationText } from '../ui/OneTimeCredentialsModal';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Addresses as typed, split on commas, semicolons, spaces and new lines; repeats (any letter case) dropped. */
const parseAddresses = (raw: string) => {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const value = part.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    addresses.push(value);
  }
  return addresses;
};

type Outcome =
  | { email: string; kind: 'created'; result: MemberProvisionResult }
  | { email: string; kind: 'invited'; emailSent: boolean; duplicate: boolean; inviteLink?: string }
  | { email: string; kind: 'member' | 'pending' | 'invalid' }
  | { email: string; kind: 'failed'; message: string };

/**
 * Stage 3 (T.22) — a Team Lead adds members to one of their workspaces, one
 * or several addresses at once, through the existing endpoints:
 *  - a new address: the server creates an ordinary Member account (SUSPENDED
 *    until activation) bound to this workspace, e-mails it the login,
 *    temporary password and activation link when it can, and returns the
 *    one-time credentials to share when it could not;
 *  - an existing account: never a second account, password or temporary
 *    password — it gets a workspace invitation (in the app, and by e-mail
 *    when possible) that it accepts or declines itself. Nobody is added
 *    behind their back.
 * Only e-mail and display name are sent — no role of any kind.
 */
export const AddTeamMemberModal = ({
  workspaceId,
  workspaceName,
  onClose,
  onCreated,
  onChanged,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  /** A single new account: the caller shows its one-time credentials. */
  onCreated: (result: MemberProvisionResult) => void;
  /** Several addresses: accounts or invitations were created (refresh lists). */
  onChanged: () => void;
}) => {
  const [raw, setRaw] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const addresses = parseAddresses(raw);
  const single = addresses.length <= 1;

  const addOne = async (email: string, name?: string): Promise<Outcome> => {
    try {
      const result = await teamManagementApi.addTeamMember(workspaceId, { email, ...(name ? { displayName: name } : {}) });
      return { email, kind: 'created', result };
    } catch (err) {
      const conflict = toApiError(err).data as MemberProvisionConflict | undefined;
      if (conflict?.alreadyMember) return { email, kind: 'member' };
      if (conflict?.pendingActivation) return { email, kind: 'pending' };
      if (!conflict?.existingAccount) return { email, kind: 'failed', message: errorMessage(err, 'Could not add this address.') };
    }
    // An existing account: a workspace invitation it accepts itself.
    try {
      const invitation = await invitationsApi.inviteByEmail(workspaceId, email);
      return { email, kind: 'invited', emailSent: invitation.emailSent, duplicate: !!invitation.duplicate, inviteLink: invitation.inviteLink };
    } catch (err) {
      return { email, kind: 'failed', message: errorMessage(err, 'Could not invite this account.') };
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!addresses.some((a) => EMAIL_PATTERN.test(a))) {
      setError('Enter at least one valid e-mail address.');
      return;
    }
    setBusy(true);
    setError(null);
    const outcomes: Outcome[] = [];
    for (const email of addresses) {
      if (!EMAIL_PATTERN.test(email)) outcomes.push({ email, kind: 'invalid' });
      else outcomes.push(await addOne(email, single ? displayName.trim() || undefined : undefined));
    }
    setBusy(false);
    // One new account: the familiar one-time credentials dialog.
    if (outcomes.length === 1 && outcomes[0].kind === 'created') {
      onCreated(outcomes[0].result);
      return;
    }
    if (outcomes.some((o) => o.kind === 'created' || (o.kind === 'invited' && !o.duplicate))) onChanged();
    setResults(outcomes);
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };

  const describe = (outcome: Outcome) => {
    switch (outcome.kind) {
      case 'created': {
        const delivery = outcome.result.delivery;
        if (delivery?.emailSent) return 'Account created — activation e-mail sent';
        if (delivery?.emailUnavailable) return "Account created — no e-mail was sent (e-mail delivery isn't configured)";
        if (delivery) return 'Account created — the activation e-mail could not be sent';
        return 'Account created — no e-mail was sent';
      }
      case 'invited':
        if (outcome.duplicate) return `Already has an account — an invitation to ${workspaceName} is already pending`;
        return outcome.emailSent
          ? 'Already has an account — invitation sent by e-mail and in SmartConnect; they accept it there'
          : 'Already has an account — invitation created; they see it in SmartConnect and accept it there (no e-mail was sent)';
      case 'member':
        return `Already a member of ${workspaceName}`;
      case 'pending':
        return 'Already has an account invitation awaiting activation — reissue it under Member activations if it expired';
      case 'invalid':
        return 'Not a valid e-mail address — not sent';
      case 'failed':
        return outcome.message;
    }
  };

  const action = (outcome: Outcome) => {
    if (outcome.kind === 'created' && !outcome.result.delivery?.emailSent) {
      const text = invitationText(outcome.result.credentials, `You've been added to SmartConnect as a member of ${workspaceName}.`);
      return (
        <Button size="sm" variant="secondary" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void copy(outcome.email, text)} aria-label={`Copy activation details for ${outcome.email}`}>
          Copy activation details
        </Button>
      );
    }
    if (outcome.kind === 'invited' && !outcome.emailSent && outcome.inviteLink) {
      const link = outcome.inviteLink;
      return (
        <Button size="sm" variant="secondary" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void copy(outcome.email, link)} aria-label={`Copy invitation link for ${outcome.email}`}>
          Copy invitation link
        </Button>
      );
    }
    return null;
  };

  return (
    <Modal
      title="Add members"
      subtitle={
        results
          ? `Results for ${workspaceName}. Activation details and invitation links are shown only here — copy any you still need to share.`
          : `New people get a Member account for ${workspaceName}: a single-use activation link and temporary password, e-mailed to them when this server can send e-mail and shown to you to share. People who already have an account get an invitation to accept.`
      }
      onClose={onClose}
      footer={
        results ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="add-team-member-form" loading={busy} disabled={addresses.length === 0} icon={<UserPlus size={15} aria-hidden="true" />}>
              Add members
            </Button>
          </>
        )
      }
    >
      {results ? (
        <ul aria-label="Results" className="divide-y divide-line">
          {results.map((outcome) => (
            <li key={outcome.email} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-semibold text-fg break-all">{outcome.email}</div>
                <div className={`text-sm ${outcome.kind === 'invalid' || outcome.kind === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>{describe(outcome)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {action(outcome)}
                {copied === outcome.email && <span className="text-xs font-semibold text-success">Copied.</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <form id="add-team-member-form" onSubmit={submit} className="space-y-4" noValidate>
          {error && <p role="alert" className="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</p>}
          <Field label="E-mail addresses" hint="One or more, separated by commas, spaces or new lines. Each address becomes that person's login.">
            <TextArea autoComplete="off" autoFocus rows={3} value={raw} onChange={(e) => { setRaw(e.target.value); setError(null); }} placeholder="mia@company.com, sam@company.com" />
          </Field>
          {single && (
            <Field label="Display name (optional)">
              <TextInput autoComplete="off" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Mia Chen" />
            </Field>
          )}
          {/* T.36: shown, never sent — the server only ever creates Members here. */}
          <Field label="Role" hint="New people join as Members. Workspace admins must be Team Leads, who are created by the Company Admin.">
            <TextInput value="Member" readOnly aria-readonly="true" tabIndex={-1} className="bg-surface-secondary text-fg-muted" />
          </Field>
        </form>
      )}
    </Modal>
  );
};
