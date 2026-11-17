import axios from 'axios';
import { ArrowRight, Loader2, MailPlus, MailWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Button } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { isInvitationToken } from '../../lib/invitationToken';

interface InvitationLookup {
  valid: true;
  email: string;
  workspaceId: string;
  workspaceName: string;
  isExistingUser: boolean;
}

/**
 * The traffic controller for `/invite/:token` — never renders a form itself,
 * just inspects the token and routes to wherever the visitor actually needs
 * to go:
 *   - signed in -> shows the invitation: the invited account chooses
 *     "Accept invitation" (joins that workspace as a member and lands in its
 *     #general; every other membership stays) or "Decline". Opening the link
 *     never joins anything by itself. Signed in as another account -> says
 *     so, with neither button (the server would refuse anyway).
 *   - existing account, signed out -> /login?inviteToken=..., which comes
 *     back here after the login succeeds (see LoginPage.tsx).
 *   - brand-new email -> /signup?inviteToken=...&email=..., where the sign-up
 *     itself accepts the invitation (server side) and lands in the workspace.
 */
export const InviteHandler = () => {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // Signed in: the looked-up invitation, shown with Accept / Decline.
  const [invitation, setInvitation] = useState<InvitationLookup | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  // This whole flow must run exactly once, but AuthContext's own checkAuth
  // effect hands us a *new* `user` object reference shortly after mount
  // (StrictMode double-invokes it in dev, and even outside StrictMode,
  // /api/auth/me refreshing `user` after login is a real second update) —
  // depending on `user` directly would re-run this effect mid-flight. Refs
  // let the one-shot effect below read the latest auth state without being
  // retriggered by it; `authLoading` is a primitive boolean, so it only ever
  // flips false once and is safe to depend on directly.
  const userRef = useRef(user);
  userRef.current = user;
  const startedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return; // wait until we actually know if there's a session
    if (startedRef.current) return;
    if (!token) {
      setError('No invitation token was provided.');
      return;
    }
    // FA-SEC-04: the token comes from the address bar. Only a canonical UUID
    // is ever used — encoded — in a request path or a redirect; anything else
    // stops here, before any request.
    if (!isInvitationToken(token)) {
      setError('This invitation link is invalid or has expired.');
      return;
    }
    startedRef.current = true;
    const encodedToken = encodeURIComponent(token);

    axios.get<InvitationLookup>(`/api/invitations/${encodedToken}`)
      .then(({ data }) => {
        if (userRef.current) {
          setInvitation(data); // the signed-in account decides below
          return;
        }

        if (data.isExistingUser) {
          navigate(`/login?inviteToken=${encodedToken}`, { replace: true });
          return;
        }

        navigate(`/signup?inviteToken=${encodedToken}&email=${encodeURIComponent(data.email)}`, { replace: true });
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'This invitation link is invalid or has expired.');
      });
  }, [token, authLoading, navigate]);

  const encodedToken = token ? encodeURIComponent(token) : '';

  const accept = async () => {
    setBusy('accept');
    try {
      const res = await axios.post<{ workspaceId: string; generalChannelId: string }>(`/api/invitations/accept/${encodedToken}`);
      navigate(`/${res.data.workspaceId}/c/${res.data.generalChannelId}`, { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to join the workspace.');
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy('decline');
    try {
      await axios.post(`/api/invitations/decline/${encodedToken}`);
      toast.success(`Invitation to ${invitation?.workspaceName ?? 'the workspace'} declined.`);
      navigate('/', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to decline the invitation.');
      setBusy(null);
    }
  };

  if (invitation && user && !error) {
    const signedInAs = user.email?.trim().toLowerCase();
    // The invited address has no account yet, or is not the signed-in one.
    const otherAccount = !invitation.isExistingUser || (!!signedInAs && signedInAs !== invitation.email.trim().toLowerCase());
    return (
      <div className="min-h-screen bg-[#faf9fa] flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 lg:p-10 rounded-2xl shadow-xl max-w-md w-full border border-gray-100 text-center">
          <div className="w-16 h-16 bg-brand-soft text-brand rounded-full flex items-center justify-center mx-auto mb-6">
            {otherAccount ? <MailWarning size={32} aria-hidden="true" /> : <MailPlus size={32} aria-hidden="true" />}
          </div>
          {otherAccount ? (
            <>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">This invitation is for another account</h2>
              <p className="text-gray-500 font-medium text-sm mb-8">
                It was sent to <strong>{invitation.email}</strong>
                {user.email ? <>, but you're signed in as <strong>{user.email}</strong></> : null}. Sign out, then open the link again.
              </p>
              <a href="/" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:text-brand-hover">
                Back to SmartConnect <ArrowRight size={16} />
              </a>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Join {invitation.workspaceName}</h2>
              <p className="text-gray-500 font-medium text-sm mb-1">
                You've been invited to join <strong>{invitation.workspaceName}</strong> as a member. Your other workspaces stay as they are.
              </p>
              <p className="text-gray-400 text-xs mb-8">Invitation for {invitation.email}</p>
              <div className="flex justify-center gap-2">
                <Button variant="secondary" onClick={decline} loading={busy === 'decline'} disabled={busy !== null}>
                  Decline
                </Button>
                <Button onClick={accept} loading={busy === 'accept'} disabled={busy !== null}>
                  Accept invitation
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#faf9fa] flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 lg:p-10 rounded-2xl shadow-xl max-w-md w-full border border-gray-100 text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <MailWarning size={32} />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Invitation not valid</h2>
          <p className="text-gray-500 font-medium text-sm mb-8">{error}</p>
          <a href="/login" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:text-brand-hover">
            Go to sign in <ArrowRight size={16} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9fa] flex items-center justify-center p-4">
      <Loader2 className="animate-spin text-brand" size={32} />
    </div>
  );
};
