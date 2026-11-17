import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationsPanel } from './InvitationsPanel';

/**
 * A Team Lead invites by e-mail AND by link: the invitation's own link is
 * shown once to the inviter (so it can be shared when no e-mail goes out),
 * a repeated invitation is reported as already pending, and the history
 * shows invitations the person declined.
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
const api = vi.mocked(axios, true);

const LINK = 'https://app.example/invite/3f1c2a9e-8b7d-4c6e-9a1f-2b3c4d5e6f70';
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  api.get.mockResolvedValue({ data: [] });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => vi.resetAllMocks());

const inviteSam = async (available = false) => {
  render(<InvitationsPanel workspaceId="w1" emailInvitationsAvailable={available} />);
  fireEvent.change(screen.getByLabelText('E-mail address'), { target: { value: 'sam@acme.io' } });
  fireEvent.click(screen.getByRole('button', { name: available ? 'Send invite' : 'Create invitation' }));
};

describe('Invitation link for the inviter', () => {
  it('after creating an invitation the inviter sees its link, can copy it, and is told it opens sign-up for that address only', async () => {
    api.post.mockResolvedValueOnce({ data: { success: true, id: 'i1', emailSent: false, emailUnavailable: true, inviteLink: LINK, existingAccount: false } });
    await inviteSam();
    const field = await screen.findByLabelText('Invitation link for sam@acme.io');
    expect(field).toHaveValue(LINK);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByText(/only for sam@acme\.io/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy invitation link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
  });

  it('an existing account is told they will see the invitation in SmartConnect — never that an e-mail was sent', async () => {
    api.post.mockResolvedValueOnce({ data: { success: true, id: 'i2', emailSent: false, emailUnavailable: true, inviteLink: LINK, existingAccount: true } });
    await inviteSam();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/sam@acme\.io.*see it in SmartConnect/)));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/sent/i));
    expect(await screen.findByLabelText('Invitation link for sam@acme.io')).toHaveValue(LINK);
  });

  it('a repeated invitation is reported as already pending, with the same link', async () => {
    api.post.mockResolvedValueOnce({ data: { success: true, id: 'i1', duplicate: true, emailSent: false, inviteLink: LINK, existingAccount: false } });
    await inviteSam(true);
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/already pending/)));
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Invitation link for sam@acme.io')).toHaveValue(LINK);
  });

  it('lists invitations the person declined, with their own filter', async () => {
    api.get.mockResolvedValue({
      data: [{ id: 'i9', email: 'dee@acme.io', createdAt: '2026-11-01T00:00:00Z', expiresAt: '2026-11-15T00:00:00Z', state: 'declined', inviter: null }],
    });
    render(<InvitationsPanel workspaceId="w1" />);
    expect(await screen.findByText('dee@acme.io')).toBeInTheDocument();
    expect(screen.getAllByText('Declined').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /Declined\s*1/ })).toBeInTheDocument();
  });
});
