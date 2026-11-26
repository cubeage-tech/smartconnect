import { EmailSendError, emailSettings, type EmailSettings } from '../lib/emailDelivery';

// E-mail goes through Brevo's transactional HTTP API, over HTTPS — never SMTP:
// Render's free tier silently blocks/times-out outbound SMTP (ports 587 and
// 465 both hung for minutes instead of failing), a known anti-spam measure on
// several free PaaS tiers; HTTPS (443) is not subject to it.
//
// Settings (lib/emailDelivery.ts): BREVO_API_KEY, BREVO_FROM_EMAIL — a sender
// verified in Brevo (or on a domain verified there) — and optionally
// BREVO_FROM_NAME. Only Brevo's message id or error status is ever logged:
// never the key, a password, a token or a link.
export const EMAIL_BRAND = 'SmartConnect';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
/** A send Brevo has not answered by then is aborted and reported as failed. */
export const BREVO_TIMEOUT_MS = 10_000;
const MAX_REASON_LENGTH = 200;

interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
type SendResult = { data: { id?: string }; error: null } | { data: null; error: { message: string; status?: number } };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const withoutRecipient = (text: string, recipient: string) =>
  recipient ? text.replace(new RegExp(escapeRegExp(recipient), 'gi'), '[recipient]') : text;

/**
 * Brevo's error answer in one line — HTTP status, Brevo's code and reason —
 * never repeating the key or the recipient's address (a rejection can echo
 * it, and this text is logged and passed up to callers).
 */
const describeBrevoError = (status: number, body: unknown, apiKey: string, recipient: string) => {
  const { code, message } = (body && typeof body === 'object' ? body : {}) as { code?: unknown; message?: unknown };
  const reason =
    typeof message === 'string' ? withoutRecipient(message.split(apiKey).join('[redacted]'), recipient).slice(0, MAX_REASON_LENGTH) : '';
  return `Brevo API error (HTTP ${status}${typeof code === 'string' ? ` ${code}` : ''})${reason ? `: ${reason}` : ''}`;
};

/**
 * Sends one e-mail through Brevo (POST /v3/smtp/email). It answers
 * { data } or { error } — API errors, timeouts and network failures alike,
 * never thrown raw — so each sender below keeps its own failure handling.
 */
const sendViaBrevo = async ({ apiKey, sender }: EmailSettings, email: OutgoingEmail): Promise<SendResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender,
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        ...(email.text ? { textContent: email.text } : {}),
      }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { data: null, error: { message: describeBrevoError(response.status, body, apiKey, email.to), status: response.status } };
    const messageId = (body as { messageId?: unknown } | null)?.messageId;
    return { data: { id: typeof messageId === 'string' ? messageId : undefined }, error: null };
  } catch (err) {
    if (controller.signal.aborted) {
      return { data: null, error: { message: `Brevo did not respond within ${BREVO_TIMEOUT_MS / 1000} s` } };
    }
    const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
    return { data: null, error: { message: `Could not reach Brevo${typeof code === 'string' ? ` (${code})` : ''}` } };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Workspace names, display names and addresses are chosen by users: every
 * value put into an e-mail's HTML is escaped, so nobody can inject markup or
 * links into a SmartConnect-branded message.
 */
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 1. Send Invite Email Function — a workspace invitation (new or existing
// account): which workspace, which address it is for, and its link. Never a
// password: existing accounts sign in with their own and accept.
export const sendInviteEmail = async (to: string, inviteLink: string, workspaceName: string) => {
  const settings = emailSettings();
  if (!settings) {
    console.warn('E-mail delivery (Brevo) is not configured - invitations will not be sent');
    return { success: false, message: 'Email service not configured' };
  }

  const workspace = escapeHtml(workspaceName);
  const link = escapeHtml(inviteLink);
  const { data, error } = await sendViaBrevo(settings, {
    to,
    subject: `You've been invited to join ${workspaceName} on ${EMAIL_BRAND}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h1>Join your team on ${workspace}</h1>
        <p>You have been invited to collaborate on <strong>${workspace}</strong>!</p>
        <p style="color: #555; font-size: 14px;">This invitation is for <strong>${escapeHtml(to)}</strong>. Open it, then create your account with this address or sign in with your existing ${EMAIL_BRAND} account to accept it.</p>
        <p>
          <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #4a154b; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Accept Invite
          </a>
        </p>
        <p style="color: #999; font-size: 12px;">Or copy this link: ${link}</p>
      </div>
    `,
  });

  if (error) {
    console.error('Email error:', error.message);
    throw new Error(`Failed to send invitation email: ${error.message}`);
  }

  console.log('Email sent successfully:', data?.id);
  return { success: true, messageId: data?.id };
};

export interface AccountInvitationEmail {
  to: string;
  /** TEAM_LEAD: added by the Company Admin. MEMBER: added to `workspaceName` by its Team Lead. */
  role: 'TEAM_LEAD' | 'MEMBER';
  loginId: string;
  temporaryPassword: string;
  activationUrl: string;
  expiresAt: Date;
  workspaceName: string | null;
}

// 1b. Newly provisioned accounts only (Team Leads, new Members): the login,
// the temporary password and the single-use activation link. Existing
// accounts never get this e-mail (they get sendInviteEmail). Nothing about
// the message is logged except the provider's message id.
export const sendAccountInvitationEmail = async (details: AccountInvitationEmail) => {
  const settings = emailSettings();
  if (!settings) throw new Error('Email service is not configured.');

  const { to, role, loginId, temporaryPassword, activationUrl, expiresAt, workspaceName } = details;
  const expires = expiresAt.toUTCString();
  const subject =
    role === 'TEAM_LEAD' ? `Activate your ${EMAIL_BRAND} Team Lead account` : `You've been invited to ${workspaceName ?? 'a workspace'} on ${EMAIL_BRAND}`;
  const headline =
    role === 'TEAM_LEAD'
      ? `You've been added to ${EMAIL_BRAND} as a Team Lead.`
      : `You've been added to <strong>${escapeHtml(workspaceName ?? '')}</strong> on ${EMAIL_BRAND} as a member.`;
  const link = escapeHtml(activationUrl);
  const { data, error } = await sendViaBrevo(settings, {
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #111827;">Activate your ${EMAIL_BRAND} account</h2>
        <p>${headline}</p>
        <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          ${workspaceName ? `<tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Workspace</td><td style="padding: 4px 0;"><strong>${escapeHtml(workspaceName)}</strong></td></tr>` : ''}
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Login (e-mail / user ID)</td><td style="padding: 4px 0;"><strong>${escapeHtml(loginId)}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Temporary password</td><td style="padding: 4px 0; font-family: monospace; font-size: 15px;"><strong>${escapeHtml(temporaryPassword)}</strong></td></tr>
        </table>
        <p>
          <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #4a154b; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Activate account
          </a>
        </p>
        <p style="font-size: 14px; color: #374151;">Open the link, enter the temporary password and choose your own password. Then sign in with your login and your new password.</p>
        <p style="color: #999; font-size: 12px;">The link and the temporary password work once and expire on ${escapeHtml(expires)}. Or copy this link: ${link}</p>
        <p style="color: #999; font-size: 12px;">If you weren't expecting this, you can ignore this e-mail.</p>
      </div>
    `,
    text: [
      role === 'TEAM_LEAD' ? `You've been added to ${EMAIL_BRAND} as a Team Lead.` : `You've been added to ${workspaceName ?? 'a workspace'} on ${EMAIL_BRAND} as a member.`,
      '',
      ...(workspaceName ? [`Workspace: ${workspaceName}`] : []),
      `Login (e-mail / user ID): ${loginId}`,
      `Temporary password: ${temporaryPassword}`,
      `Activation link: ${activationUrl}`,
      '',
      'Open the link, enter the temporary password and choose your own password. Then sign in with your login and your new password.',
      `The link and the temporary password work once and expire on ${expires}.`,
    ].join('\n'),
  });

  if (error) {
    console.error('Account invitation email error:', error.message);
    throw new Error(`Failed to send the account invitation email: ${error.message}`);
  }

  console.log('Account invitation email sent:', data?.id);
};

// 1c. Meeting scheduler: an invitation, a change, a cancellation or a
// reminder, sent to ONE participant (never a shared To/Cc list, so nobody
// learns another invitee's address). Times are shown in the recipient's time
// zone. Best effort: answers { sent: false } when e-mail is not configured;
// a provider failure throws, and callers log it without failing the request.
export type MeetingEmailKind = 'invited' | 'updated' | 'rescheduled' | 'cancelled' | 'reminder';

export interface MeetingEmail {
  to: string;
  kind: MeetingEmailKind;
  title: string;
  organizerName: string;
  workspaceName: string;
  startsAt: Date;
  endsAt: Date;
  /** IANA zone the times are shown in (the recipient's, else the meeting's). */
  timeZone: string;
  meetingUrl: string;
  /** Reminders only: minutes until the start. */
  minutesBefore?: number;
}

const MEETING_SUBJECTS: Record<MeetingEmailKind, (title: string, minutes?: number) => string> = {
  invited: (title) => `Invitation: ${title}`,
  updated: (title) => `Updated: ${title}`,
  rescheduled: (title) => `New time: ${title}`,
  cancelled: (title) => `Cancelled: ${title}`,
  reminder: (title, minutes) => `Reminder: ${title} starts in ${minutes ?? 0} minutes`,
};

const MEETING_HEADLINES: Record<MeetingEmailKind, (organizer: string) => string> = {
  invited: (organizer) => `${organizer} invited you to a meeting.`,
  updated: (organizer) => `${organizer} updated this meeting.`,
  rescheduled: (organizer) => `${organizer} moved this meeting to a new time. Please respond again.`,
  cancelled: (organizer) => `${organizer} cancelled this meeting.`,
  reminder: () => 'Your meeting is starting soon.',
};

export const formatMeetingTime = (startsAt: Date, endsAt: Date, timeZone: string) => {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(startsAt);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time.format(startsAt)} – ${time.format(endsAt)} (${timeZone})`;
};

export const sendMeetingEmail = async (email: MeetingEmail): Promise<{ sent: boolean }> => {
  const settings = emailSettings();
  if (!settings) return { sent: false };

  const subject = MEETING_SUBJECTS[email.kind](email.title, email.minutesBefore);
  const headline = MEETING_HEADLINES[email.kind](email.organizerName);
  const when = formatMeetingTime(email.startsAt, email.endsAt, email.timeZone);
  const link = escapeHtml(email.meetingUrl);
  const action = email.kind === 'cancelled' ? 'View meeting' : email.kind === 'reminder' ? 'Join meeting' : 'Respond to invitation';
  const { data, error } = await sendViaBrevo(settings, {
    to: email.to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #111827;">${escapeHtml(email.title)}</h2>
        <p>${escapeHtml(headline)}</p>
        <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">When</td><td style="padding: 4px 0;"><strong>${escapeHtml(when)}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Organizer</td><td style="padding: 4px 0;">${escapeHtml(email.organizerName)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Workspace</td><td style="padding: 4px 0;">${escapeHtml(email.workspaceName)}</td></tr>
        </table>
        <p>
          <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #0b7c86; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">${action}</a>
        </p>
        <p style="color: #999; font-size: 12px;">Or copy this link: ${link}. You need to be signed in to ${EMAIL_BRAND} to open it.</p>
      </div>
    `,
    text: [headline, '', email.title, `When: ${when}`, `Organizer: ${email.organizerName}`, `Workspace: ${email.workspaceName}`, '', `${action}: ${email.meetingUrl}`].join('\n'),
  });
  if (error) throw new Error(`Failed to send the meeting e-mail: ${error.message}`);
  console.log('Meeting email sent:', data?.id);
  return { sent: true };
};

// 2. Send Sign-Up OTP Email Function
export const sendOtpEmail = async (to: string, code: string) => {
  const settings = emailSettings();
  if (!settings) {
    // Unlike invites/reset links, there's no fallback way to hand someone a
    // verification code if the email never sends — fail the signup request
    // loudly rather than leave them stuck on a code that never arrives.
    throw new Error('Email service is not configured — cannot send verification codes.');
  }

  const { data, error } = await sendViaBrevo(settings, {
    to,
    subject: `${code} is your ${EMAIL_BRAND} verification code`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; border: 1px solid #ece9f4; border-radius: 16px;">
        <div style="width: 40px; height: 40px; background: #2e1065; border-radius: 10px; color: white; font-weight: bold; font-size: 18px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">S</div>
        <h2 style="color: #111827; margin: 0 0 8px;">Verify your email</h2>
        <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">Enter this code to finish creating your ${EMAIL_BRAND} account. It expires in 5 minutes.</p>
        <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4c1d95;">${code}</span>
        </div>
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you didn't request this, you can safely ignore this email — no account will be created without this code.</p>
      </div>
    `,
  });

  if (error) {
    console.error('OTP email error:', error.message);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }

  console.log('OTP email sent:', data?.id);
};

// 3. Send Reset Password Email Function — used by both self-service
// "forgot password" and the admin "force reset" action.
export type ResetEmailResult = { sent: true; messageId?: string } | { sent: false; reason: 'not_configured' };

// QA C2: the result says what happened. "sent" means Brevo accepted the
// message for delivery (its API cannot confirm the inbox); a refusal throws
// EmailSendError instead of being reported as sent.
export const sendResetPasswordEmail = async (to: string, resetLink: string): Promise<ResetEmailResult> => {
  const settings = emailSettings();
  if (!settings) {
    console.warn('E-mail delivery (Brevo) is not configured - reset email will not be sent');
    return { sent: false, reason: 'not_configured' };
  }

  const { data, error } = await sendViaBrevo(settings, {
    to,
    subject: `Password Reset Request - ${EMAIL_BRAND}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #350d36;">Reset Your Password</h2>
        <p>We received a request to reset your password for your ${EMAIL_BRAND} account.</p>
        <p>Click the button below to set a new password. This link is valid for <strong>15 minutes</strong>.</p>
        <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #e8912d; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px;">Set New Password</a>
        <p style="margin-top: 25px; font-size: 12px; color: #888;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    console.error('Reset email error:', error.message);
    throw new EmailSendError(error.message, error.status === 401 || error.status === 403);
  }

  console.log('Reset email accepted by Brevo:', data?.id);
  return { sent: true, messageId: data?.id };
};
