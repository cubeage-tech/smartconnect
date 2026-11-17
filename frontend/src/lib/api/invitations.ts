import { http, seg } from './http';

/**
 * Workspace invitations, invite links and join requests (Batch 3/E,
 * lib/policy 'workspace.manageInvitations'). Per-email invitation TOKENS are
 * never listed: the manager list endpoint doesn't return them, and the
 * create response's raw `token` field is dropped here. The one exception is
 * deliberate: the inviter gets the invitation's shareable `inviteLink` once,
 * at creation, to send when no e-mail goes out. The link grants nothing by
 * itself — signing up needs that exact address, and accepting needs that
 * account's own session.
 */

export type InvitationState = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';

export interface WorkspaceInvitation {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  state: InvitationState;
  inviter: { id: string; username: string } | null;
}

export interface JoinRequest {
  id: string;
  createdAt: string;
  user: { id: string; username: string; email: string };
}

export interface InviteResult {
  id: string;
  /** False when the invitation exists but the e-mail couldn't be delivered. */
  emailSent: boolean;
  /** T.36: true when no e-mail could be sent because this server has no e-mail provider. */
  emailUnavailable?: true;
  /** The invitation's own link, for the inviter to share (sign-up for that address, or accept/decline in the app). */
  inviteLink?: string;
  /** True when the address already has an account: they also see the invitation in the app. */
  existingAccount?: boolean;
  /** True when an invitation for this address was already pending — it is returned instead of a new one. */
  duplicate?: true;
}

/** An invitation addressed to the signed-in account (GET /api/invitations/received). Never carries a token. */
export interface ReceivedInvitation {
  id: string;
  workspace: { id: string; name: string };
  inviter: { id: string; username: string; displayName: string | null };
  createdAt: string;
  expiresAt: string;
}

/** GET /api/workspaces/:id/invitations — newest first, state computed server-side, no tokens. */
export const listWorkspaceInvitations = (workspaceId: string) =>
  http.get<WorkspaceInvitation[]>(`/api/workspaces/${seg(workspaceId)}/invitations`);

/** POST /api/workspaces/:id/invites { email } */
export const inviteByEmail = async (workspaceId: string, email: string): Promise<InviteResult> => {
  const body = await http.post<{
    id: string;
    token?: string;
    emailError?: string;
    emailSent?: boolean;
    emailUnavailable?: boolean;
    inviteLink?: string;
    existingAccount?: boolean;
    duplicate?: boolean;
  }>(`/api/workspaces/${seg(workspaceId)}/invites`, { email });
  // Deliberately NOT returning body.token (the raw field) or the provider
  // error text. T.36: the server's own emailSent wins (older servers only
  // reported failures through emailError).
  const emailSent = typeof body.emailSent === 'boolean' ? body.emailSent : !body.emailError;
  return {
    id: body.id,
    emailSent,
    ...(body.emailUnavailable ? { emailUnavailable: true as const } : {}),
    ...(typeof body.inviteLink === 'string' ? { inviteLink: body.inviteLink } : {}),
    ...(typeof body.existingAccount === 'boolean' ? { existingAccount: body.existingAccount } : {}),
    ...(body.duplicate ? { duplicate: true as const } : {}),
  };
};

/** GET /api/invitations/received — the signed-in account's pending workspace invitations. */
export const listReceivedInvitations = () => http.get<ReceivedInvitation[]>('/api/invitations/received');

/** Accept: joins exactly that workspace as a member; every other membership stays. */
export const acceptReceivedInvitation = (invitationId: string) =>
  http.post<{ workspaceId: string; generalChannelId: string }>(`/api/invitations/received/${seg(invitationId)}/accept`);

/** Decline: joins nothing; the invitation can no longer be used. */
export const declineReceivedInvitation = (invitationId: string) =>
  http.post<{ id: string; state: 'declined' }>(`/api/invitations/received/${seg(invitationId)}/decline`);

export const revokeInvitation = (workspaceId: string, invitationId: string) =>
  http.delete<{ id: string; state: 'revoked' }>(`/api/workspaces/${seg(workspaceId)}/invitations/${seg(invitationId)}`);

/** GET …/invite-link — reuses or creates the shareable join link (joining still needs approval). */
export const getInviteLink = (workspaceId: string) =>
  http.get<{ url: string; expiresAt: string }>(`/api/workspaces/${seg(workspaceId)}/invite-link`);

/** DELETE …/invite-link — revokes every active link; a new one can be generated afterwards. */
export const revokeInviteLinks = (workspaceId: string) => http.delete<{ revoked: number }>(`/api/workspaces/${seg(workspaceId)}/invite-link`);

export const listJoinRequests = async (workspaceId: string): Promise<JoinRequest[]> => {
  const rows = await http.get<(JoinRequest & Record<string, unknown>)[]>(`/api/workspaces/${seg(workspaceId)}/requests`);
  return rows.map(({ id, createdAt, user }) => ({ id, createdAt, user }));
};

export const resolveJoinRequest = (workspaceId: string, requestId: string, action: 'APPROVE' | 'REJECT') =>
  http.put<{ status: 'APPROVED' | 'REJECTED' }>(`/api/workspaces/${seg(workspaceId)}/requests/${seg(requestId)}`, { action });
