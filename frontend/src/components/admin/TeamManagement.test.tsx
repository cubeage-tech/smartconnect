import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamManagement } from './TeamManagement';

/** Stage 2 (T.20) — Admin → Team Management: list, add (credentials shown once), revoke, reissue, promote, deactivate, reactivate. */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
  },
}));
const api = vi.mocked(axios, true);

const invitation = (status: string, extra: Record<string, unknown> = {}) => ({
  id: `inv-${status}`,
  status,
  teamLabel: 'Design',
  expiresAt: '2026-11-13T00:00:00.000Z',
  createdAt: '2026-11-10T00:00:00.000Z',
  acceptedAt: status === 'ACCEPTED' ? '2026-11-11T00:00:00.000Z' : null,
  revokedAt: status === 'REVOKED' ? '2026-11-11T00:00:00.000Z' : null,
  revokedReason: status === 'REVOKED' ? 'ADMIN' : null,
  ...extra,
});
const lead = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  username: name.toLowerCase(),
  loginId: `${name.toLowerCase()}@acme.io`,
  displayName: name,
  status: 'ACTIVE',
  createdAt: '2026-11-10T00:00:00.000Z',
  invitation: invitation(status),
  ...extra,
});
// T.21: accounts stay SUSPENDED until activation.
const LEADS = [
  lead('u1', 'Priya', 'PENDING', { status: 'SUSPENDED' }),
  lead('u2', 'Omar', 'ACCEPTED'),
  lead('u3', 'Lena', 'EXPIRED', { status: 'SUSPENDED' }),
  lead('u4', 'Kenji', 'REVOKED', { status: 'SUSPENDED' }),
  lead('u5', 'Zara', 'ACCEPTED', { status: 'SUSPENDED' }), // activated, later deactivated by an admin
];
const CREDENTIALS = {
  loginId: 'nadia@acme.io',
  temporaryPassword: 'Kp7Qm-3xTzR-hW9aB-c4NvE',
  activationUrl: 'http://localhost:5174/activate#token=abcDEF_ghi-0123456789abcdefghijklmnopqrstuvw',
  expiresAt: '2026-11-13T00:00:00.000Z',
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  api.get.mockResolvedValue({ data: { teamLeads: LEADS } });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Team Management (Stage 2)', () => {
  it('lists Team Leads with their invitation status and account status', async () => {
    render(<TeamManagement />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(5);
    const row = (name: string) => within(screen.getByText(name).closest('li') as HTMLElement);
    expect(row('Priya').getByText('Pending')).toBeInTheDocument();
    expect(row('Omar').getByText('Accepted')).toBeInTheDocument();
    expect(row('Lena').getByText('Expired')).toBeInTheDocument();
    expect(row('Kenji').getByText('Revoked')).toBeInTheDocument();
    // Never activated: shown as awaiting activation, not as an admin suspension.
    for (const name of ['Priya', 'Lena', 'Kenji']) {
      expect(row(name).getByText('Awaiting activation')).toBeInTheDocument();
      expect(row(name).queryByText('Deactivated')).not.toBeInTheDocument();
    }
    expect(row('Omar').getByText('Active')).toBeInTheDocument();
    expect(row('Zara').getByText('Deactivated')).toBeInTheDocument();
    expect(row('Priya').getByText('priya@acme.io')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/team-management/team-leads');
  });

  it('adds a Team Lead and shows the invitation link and temporary password exactly once', async () => {
    api.post.mockResolvedValueOnce({ data: { teamLead: lead('u6', 'Nadia', 'PENDING', { status: 'SUSPENDED' }), credentials: CREDENTIALS } });
    render(<TeamManagement />);
    await screen.findByText('Priya');
    fireEvent.click(screen.getByRole('button', { name: 'Add Team Lead' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Team Lead' });
    fireEvent.change(within(dialog).getByLabelText(/E-mail address/), { target: { value: ' Nadia@Acme.io ' } });
    fireEvent.change(within(dialog).getByLabelText(/Display name/), { target: { value: 'Nadia Khan' } });
    fireEvent.change(within(dialog).getByLabelText(/Team label/), { target: { value: 'Growth' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Team Lead' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/team-management/team-leads', { email: 'Nadia@Acme.io', displayName: 'Nadia Khan', teamLabel: 'Growth' })
    );
    const shown = await screen.findByRole('dialog', { name: 'Team Lead invitation' });
    expect(within(shown).getByText(CREDENTIALS.temporaryPassword)).toBeInTheDocument();
    expect(within(shown).getByText(CREDENTIALS.activationUrl)).toBeInTheDocument();
    expect(within(shown).getByText(CREDENTIALS.loginId)).toBeInTheDocument();
    expect(within(shown).getByText(/only time/i)).toBeInTheDocument();

    fireEvent.click(within(shown).getByRole('button', { name: 'Copy invitation' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    for (const part of [CREDENTIALS.activationUrl, CREDENTIALS.temporaryPassword, CREDENTIALS.loginId]) expect(copied).toContain(part);

    fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(CREDENTIALS.temporaryPassword)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CREDENTIALS.temporaryPassword);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(CREDENTIALS.temporaryPassword);
  });

  it('says whether the activation e-mail went out — sent, not configured, or failed — and keeps the details to share either way', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ emailSent: true }, /An activation e-mail with these details was sent to nadia@acme\.io/],
      [{ emailSent: false, emailUnavailable: true }, /No e-mail was sent — e-mail delivery isn't configured on this server/],
      [{ emailSent: false }, /The activation e-mail could not be sent/],
    ];
    for (const [delivery, says] of cases) {
      api.get.mockResolvedValue({ data: { teamLeads: [] } });
      api.post.mockResolvedValueOnce({ data: { teamLead: lead('u6', 'Nadia', 'PENDING', { status: 'SUSPENDED' }), credentials: { ...CREDENTIALS, loginId: 'nadia@acme.io' }, delivery } });
      const { unmount } = render(<TeamManagement />);
      fireEvent.click(await screen.findByRole('button', { name: 'Add Team Lead' }));
      const dialog = screen.getByRole('dialog', { name: 'Add Team Lead' });
      fireEvent.change(within(dialog).getByLabelText(/E-mail address/), { target: { value: 'nadia@acme.io' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Team Lead' }));
      const shown = await screen.findByRole('dialog', { name: 'Team Lead invitation' });
      expect(shown).toHaveTextContent(says);
      expect(within(shown).getByText(CREDENTIALS.temporaryPassword)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows why an add failed (for example, a duplicate e-mail) and keeps the form open', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'An account with this e-mail address already exists.' } } });
    render(<TeamManagement />);
    await screen.findByText('Priya');
    fireEvent.click(screen.getByRole('button', { name: 'Add Team Lead' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Team Lead' });
    fireEvent.change(within(dialog).getByLabelText(/E-mail address/), { target: { value: 'priya@acme.io' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Team Lead' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.queryByRole('dialog', { name: 'Team Lead invitation' })).not.toBeInTheDocument();
  });

  it('revokes a pending invitation after confirmation', async () => {
    api.post.mockResolvedValueOnce({ data: { invitation: invitation('REVOKED', { id: 'inv-PENDING' }) } });
    render(<TeamManagement />);
    const row = within((await screen.findByText('Priya')).closest('li') as HTMLElement);
    fireEvent.click(row.getByRole('button', { name: 'Revoke invitation for Priya' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/team-management/invitations/inv-PENDING/revoke', undefined));
    expect(await row.findByText('Revoked')).toBeInTheDocument();
    // Only pending invitations offer revoke.
    expect(within(screen.getByText('Omar').closest('li') as HTMLElement).queryByRole('button', { name: /Revoke invitation/ })).not.toBeInTheDocument();
  });

  it('reissues an expired invitation and shows the new credentials once', async () => {
    api.post.mockResolvedValueOnce({ data: { teamLead: lead('u3', 'Lena', 'PENDING'), credentials: { ...CREDENTIALS, loginId: 'lena@acme.io' } } });
    render(<TeamManagement />);
    const row = within((await screen.findByText('Lena')).closest('li') as HTMLElement);
    fireEvent.click(row.getByRole('button', { name: 'Reissue invitation for Lena' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/team-management/team-leads/u3/reissue', undefined));
    const shown = await screen.findByRole('dialog', { name: 'Team Lead invitation' });
    expect(within(shown).getByText(CREDENTIALS.temporaryPassword)).toBeInTheDocument();
    // Accepted invitations can't be reissued.
    expect(within(screen.getByText('Omar').closest('li') as HTMLElement).queryByRole('button', { name: /Reissue/ })).not.toBeInTheDocument();
  });

  it('offers to make an existing (e.g. self-registered) account a Team Lead instead of creating a duplicate', async () => {
    const conflict = {
      error: 'An account with this e-mail address already exists.',
      existingAccount: true,
      promotable: true,
      user: { id: 'u9', username: 'mia', displayName: 'Mia Chen', status: 'ACTIVE' },
    };
    api.post
      .mockRejectedValueOnce({ response: { status: 409, data: conflict } })
      .mockResolvedValueOnce({ data: { teamLead: lead('u9', 'Mia', 'ACCEPTED', { invitation: null }) } });
    render(<TeamManagement />);
    await screen.findByText('Priya');
    fireEvent.click(screen.getByRole('button', { name: 'Add Team Lead' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Team Lead' });
    fireEvent.change(within(dialog).getByLabelText(/E-mail address/), { target: { value: 'mia@acme.io' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Team Lead' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Make Mia Chen a Team Lead' }));

    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/api/team-management/team-leads/promote', { userId: 'u9' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Team Lead' })).not.toBeInTheDocument());
    expect(await screen.findByText('Mia is now a Team Lead.')).toBeInTheDocument();
    const row = within(screen.getByText('Mia').closest('li') as HTMLElement);
    expect(row.getByText('Existing account — no activation needed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Team Lead invitation' })).not.toBeInTheDocument(); // no credentials for an existing account
  });

  it('explains why an existing account cannot be promoted', async () => {
    api.post.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'An account with this e-mail address already exists.', existingAccount: true, promotable: false, reason: 'This account is already a Team Lead.', user: { id: 'u2', username: 'omar', displayName: 'Omar', status: 'ACTIVE' } } },
    });
    render(<TeamManagement />);
    await screen.findByText('Priya');
    fireEvent.click(screen.getByRole('button', { name: 'Add Team Lead' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Team Lead' });
    fireEvent.change(within(dialog).getByLabelText(/E-mail address/), { target: { value: 'omar@acme.io' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Team Lead' }));
    expect(await within(dialog).findByText('This account is already a Team Lead.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Make .* a Team Lead/ })).not.toBeInTheDocument();
  });

  it('deactivates an active Team Lead after confirmation, and reactivates a deactivated one', async () => {
    api.post
      .mockResolvedValueOnce({ data: { teamLead: lead('u2', 'Omar', 'ACCEPTED', { status: 'SUSPENDED' }) } })
      .mockResolvedValueOnce({ data: { teamLead: lead('u5', 'Zara', 'ACCEPTED', { status: 'ACTIVE' }) } });
    render(<TeamManagement />);
    const omar = within((await screen.findByText('Omar')).closest('li') as HTMLElement);
    fireEvent.click(omar.getByRole('button', { name: 'Deactivate Omar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/team-management/team-leads/u2/deactivate', undefined));
    expect(await omar.findByText('Deactivated')).toBeInTheDocument();
    expect(omar.getByRole('button', { name: 'Reactivate Omar' })).toBeInTheDocument();

    const zara = within(screen.getByText('Zara').closest('li') as HTMLElement);
    fireEvent.click(zara.getByRole('button', { name: 'Reactivate Zara' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/team-management/team-leads/u5/reactivate', undefined));
    expect(await zara.findByText('Active')).toBeInTheDocument();

    // Team Leads still awaiting activation are neither deactivated nor reactivated here (revoke / reissue instead).
    for (const name of ['Priya', 'Lena', 'Kenji']) {
      const row = within(screen.getByText(name).closest('li') as HTMLElement);
      expect(row.queryByRole('button', { name: /Deactivate|Reactivate/ })).not.toBeInTheDocument();
    }
  });
});
