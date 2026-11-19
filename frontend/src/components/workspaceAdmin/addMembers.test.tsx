import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddTeamMemberModal } from './AddTeamMemberModal';

/**
 * People → Add members: one or several addresses at once. New people get a
 * Member account (activation e-mail with a temporary password, or details to
 * share when no e-mail went out); existing accounts get a workspace
 * invitation they must accept — never a second account, a password, or a
 * direct add. Every address gets its own clear result.
 */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
  },
}));
const api = vi.mocked(axios, true);

const created = (email: string, delivery: Record<string, unknown>) => ({
  data: {
    invitation: {
      id: `inv-${email}`, status: 'PENDING', teamLabel: null, expiresAt: '2026-12-01T00:00:00.000Z', createdAt: '2026-11-19T00:00:00.000Z', acceptedAt: null, revokedAt: null, revokedReason: null,
      account: { id: `u-${email}`, username: email.split('@')[0], loginId: email, displayName: null, status: 'SUSPENDED' },
    },
    credentials: { loginId: email, temporaryPassword: `Tmp-${email.split('@')[0]}-pass`, activationUrl: `https://app.example/activate#token=${'a'.repeat(43)}`, expiresAt: '2026-12-01T00:00:00.000Z' },
    delivery,
  },
});
const conflict = (data: Record<string, unknown>) => Promise.reject({ response: { status: 409, data } });
const INVITE_LINK = 'https://app.example/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70';

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => vi.resetAllMocks());

const open = (props: Partial<Parameters<typeof AddTeamMemberModal>[0]> = {}) => {
  const handlers = { onClose: vi.fn(), onCreated: vi.fn(), onChanged: vi.fn() };
  render(<AddTeamMemberModal workspaceId="w1" workspaceName="Design" {...handlers} {...props} />);
  return { ...handlers, dialog: screen.getByRole('dialog', { name: 'Add members' }) };
};
const submit = (dialog: HTMLElement, value: string) => {
  fireEvent.change(within(dialog).getByLabelText('E-mail addresses'), { target: { value } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add members' }));
};
const resultFor = async (dialog: HTMLElement, email: string) => within(await within(dialog).findByRole('list', { name: 'Results' })).getByText(email).closest('li') as HTMLElement;

describe('People → Add members', () => {
  it('several addresses at once: new people get accounts, existing accounts get an invitation to accept, and nobody is added directly', async () => {
    api.post.mockImplementation(async (url: string, body?: unknown) => {
      const email = (body as { email?: string } | undefined)?.email;
      if (url === '/api/workspaces/w1/member-invitations') {
        if (email === 'ana@acme.io') return created(email, { emailSent: true });
        if (email === 'Ben@acme.io') return created(email, { emailSent: false, emailUnavailable: true });
        if (email === 'omar@acme.io') return conflict({ error: 'This person already has an account. Invite them to the workspace instead.', existingAccount: true, user: { id: 'u9', username: 'omar', displayName: 'Omar' } });
        if (email === 'mia@acme.io') return conflict({ error: 'This person is already a member of this workspace.', alreadyMember: true });
        if (email === 'zoe@acme.io') return conflict({ error: 'This person already has an account invitation awaiting activation.', pendingActivation: true });
      }
      if (url === '/api/workspaces/w1/invites' && email === 'omar@acme.io') {
        return { data: { success: true, id: 'wi1', emailSent: true, existingAccount: true, inviteLink: INVITE_LINK } };
      }
      throw new Error(`unexpected POST ${url} ${JSON.stringify(body)}`);
    });
    const { dialog, onChanged, onCreated } = open();
    submit(dialog, 'ana@acme.io, Ben@acme.io\nANA@acme.io omar@acme.io; mia@acme.io zoe@acme.io not-an-email');

    expect(await resultFor(dialog, 'ana@acme.io')).toHaveTextContent('Account created — activation e-mail sent');
    expect(await resultFor(dialog, 'Ben@acme.io')).toHaveTextContent("Account created — no e-mail was sent (e-mail delivery isn't configured)");
    expect(await resultFor(dialog, 'omar@acme.io')).toHaveTextContent('Already has an account — invitation sent by e-mail and in SmartConnect; they accept it there');
    expect(await resultFor(dialog, 'mia@acme.io')).toHaveTextContent('Already a member of Design');
    expect(await resultFor(dialog, 'zoe@acme.io')).toHaveTextContent('Already has an account invitation awaiting activation');
    expect(await resultFor(dialog, 'not-an-email')).toHaveTextContent('Not a valid e-mail address — not sent');

    const posted = api.post.mock.calls.map(([url, body]) => `${url} ${(body as { email?: string } | undefined)?.email ?? ''}`);
    expect(posted.filter((p) => p.includes('member-invitations'))).toHaveLength(5); // the duplicate and the invalid address were never sent
    expect(posted.filter((p) => p.includes('/invites'))).toEqual(['/api/workspaces/w1/invites omar@acme.io']);
    expect(posted.some((p) => p.startsWith('/api/workspaces/w1/members '))).toBe(false); // no direct add, ever
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();

    // Ben got no e-mail: the lead copies the activation details to share privately.
    fireEvent.click(within(await resultFor(dialog, 'Ben@acme.io')).getByRole('button', { name: 'Copy activation details for Ben@acme.io' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Temporary password: Tmp-Ben-pass')));
    expect(writeText.mock.calls[0][0]).toContain(`https://app.example/activate#token=${'a'.repeat(43)}`);
  });

  it('an existing account whose invitation e-mail could not be sent gets its invitation link to share', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/api/workspaces/w1/member-invitations') return conflict({ error: 'This person already has an account.', existingAccount: true, user: { id: 'u9', username: 'omar', displayName: null } });
      return { data: { success: true, id: 'wi1', emailSent: false, emailUnavailable: true, existingAccount: true, inviteLink: INVITE_LINK } };
    });
    const { dialog, onChanged } = open();
    submit(dialog, 'omar@acme.io');
    const row = await resultFor(dialog, 'omar@acme.io');
    expect(row).toHaveTextContent('Already has an account — invitation created; they see it in SmartConnect and accept it there (no e-mail was sent)');
    fireEvent.click(within(row).getByRole('button', { name: 'Copy invitation link for omar@acme.io' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVITE_LINK));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('an invitation that is already pending is reported, not repeated', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/api/workspaces/w1/member-invitations') return conflict({ error: 'This person already has an account.', existingAccount: true, user: { id: 'u9', username: 'omar', displayName: null } });
      return { data: { success: true, id: 'wi1', duplicate: true, emailSent: false, existingAccount: true, inviteLink: INVITE_LINK } };
    });
    const { dialog } = open();
    submit(dialog, 'omar@acme.io');
    expect(await resultFor(dialog, 'omar@acme.io')).toHaveTextContent('Already has an account — an invitation to Design is already pending');
  });

  it('nothing valid to send: says so and sends nothing', async () => {
    const { dialog } = open();
    submit(dialog, 'nope, also nope');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter at least one valid e-mail address.');
    expect(api.post).not.toHaveBeenCalled();
  });
});
