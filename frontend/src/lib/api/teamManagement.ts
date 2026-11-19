import { http, seg } from './http';

/**
 * Stage 2 (T.20) — Company Admin → Team Lead provisioning and one-time
 * account activation. Authorization is enforced by the server; these are
 * typed wrappers only. One-time credentials are returned by `addTeamLead` /
 * `reissueInvitation` exactly once and must never be stored client-side.
 */

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
export type TeamLeadAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export interface TeamLeadInvitation {
  id: string;
  status: InvitationStatus;
  teamLabel: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokedReason: 'ADMIN' | 'TEAM_LEAD' | 'TOO_MANY_ATTEMPTS' | 'REISSUED' | null;
}

export interface TeamLead {
  id: string;
  username: string;
  loginId: string;
  displayName: string | null;
  status: TeamLeadAccountStatus;
  createdAt: string;
  invitation: TeamLeadInvitation | null;
}

export interface OneTimeCredentials {
  loginId: string;
  temporaryPassword: string;
  activationUrl: string;
  expiresAt: string;
}

/**
 * What happened to the activation e-mail of a newly provisioned account (the
 * one-time credentials come back to the creator either way, to share if the
 * e-mail did not go out). Absent from servers that sent no e-mail at all.
 */
export interface AccountInvitationDelivery {
  emailSent: boolean;
  emailUnavailable?: boolean;
}

export interface ProvisionResult {
  teamLead: TeamLead;
  credentials: OneTimeCredentials;
  delivery?: AccountInvitationDelivery;
}

/** One sentence on the activation e-mail, for the one-time credentials dialog. */
export const activationEmailNote = (delivery: AccountInvitationDelivery | undefined, loginId: string) => {
  if (!delivery) return 'No e-mail is sent.';
  if (delivery.emailSent) return `An activation e-mail with these details was sent to ${loginId}.`;
  if (delivery.emailUnavailable) return "No e-mail was sent — e-mail delivery isn't configured on this server.";
  return 'The activation e-mail could not be sent.';
};

export interface NewTeamLead {
  email: string;
  displayName?: string;
  teamLabel?: string;
}

/**
 * 409 body from addTeamLead when the address already has an account (read
 * from ApiError.data): never a second account — the admin may instead make
 * that account a Team Lead (promoteTeamLead) when `promotable` is true.
 */
export interface TeamLeadConflict {
  error: string;
  existingAccount?: boolean;
  promotable?: boolean;
  reason?: string;
  user?: { id: string; username: string; displayName: string | null; status: TeamLeadAccountStatus };
}

export const listTeamLeads = () => http.get<{ teamLeads: TeamLead[] }>('/api/team-management/team-leads');

export const addTeamLead = (body: NewTeamLead) => http.post<ProvisionResult>('/api/team-management/team-leads', body);

/** Company Admin only: an existing, active account (e.g. a self-registered Member) becomes a Team Lead. */
export const promoteTeamLead = (userId: string) => http.post<{ teamLead: TeamLead }>('/api/team-management/team-leads/promote', { userId });

/** Company Admin only: the Team Lead can no longer sign in (sessions end at once); everything they own is kept. */
export const deactivateTeamLead = (userId: string) => http.post<{ teamLead: TeamLead }>(`/api/team-management/team-leads/${seg(userId)}/deactivate`);

/** Company Admin only: restores a deactivated Team Lead who had activated their account. */
export const reactivateTeamLead = (userId: string) => http.post<{ teamLead: TeamLead }>(`/api/team-management/team-leads/${seg(userId)}/reactivate`);

export const revokeInvitation = (invitationId: string) =>
  http.post<{ invitation: TeamLeadInvitation }>(`/api/team-management/invitations/${seg(invitationId)}/revoke`);

export const reissueInvitation = (userId: string) => http.post<ProvisionResult>(`/api/team-management/team-leads/${seg(userId)}/reissue`);

/** Public, one-time. Issues no session — the person signs in normally afterwards. */
export const activateAccount = (body: { token: string; temporaryPassword: string; newPassword: string }) =>
  http.post<{ activated: true; loginId: string }>('/api/account-activation', body);

// ---- Stage 3 (T.22): Team Lead → Member provisioning and hierarchy hints ----

export type HierarchyRole = 'COMPANY_ADMIN' | 'TEAM_LEAD' | 'MEMBER';
export interface Hierarchy {
  role: HierarchyRole;
  canCreateWorkspaces: boolean;
  canProvisionMembers: boolean;
}
/** UI hints only — every action is enforced by the server. */
export const myHierarchy = () => http.get<Hierarchy>('/api/me/hierarchy');

export interface MemberInvitation extends TeamLeadInvitation {
  account: { id: string; username: string; loginId: string; displayName: string | null; status: TeamLeadAccountStatus };
}
export interface MemberProvisionResult {
  invitation: MemberInvitation;
  credentials: OneTimeCredentials;
  delivery?: AccountInvitationDelivery;
}
/** 409 bodies from addTeamMember (read from ApiError.data). */
export interface MemberProvisionConflict {
  error: string;
  existingAccount?: boolean;
  pendingActivation?: boolean;
  alreadyMember?: boolean;
  user?: { id: string; username: string; displayName: string | null };
}

const memberInvitations = (workspaceId: string) => `/api/workspaces/${seg(workspaceId)}/member-invitations`;

export const listMemberInvitations = (workspaceId: string) => http.get<{ invitations: MemberInvitation[] }>(memberInvitations(workspaceId));

export const addTeamMember = (workspaceId: string, body: { email: string; displayName?: string }) =>
  http.post<MemberProvisionResult>(memberInvitations(workspaceId), body);

export const revokeMemberInvitation = (workspaceId: string, invitationId: string) =>
  http.post<{ invitation: MemberInvitation }>(`${memberInvitations(workspaceId)}/${seg(invitationId)}/revoke`);

export const reissueMemberInvitation = (workspaceId: string, invitationId: string) =>
  http.post<MemberProvisionResult>(`${memberInvitations(workspaceId)}/${seg(invitationId)}/reissue`);
