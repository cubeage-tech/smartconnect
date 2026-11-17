import axios from 'axios';
import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { AuthForm } from '../../components/auth/AuthForm';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminAccount } from '../../lib/admin';
import { isInvitationToken } from '../../lib/invitationToken';
import { LoadingScreen } from '../../components/ui/LoadingScreen';

// Shown instead of redirecting into the workspace when a join link now
// requires admin approval (see PendingRequests in Directory.tsx) — a
// `joinToken` that resolves to 'already_member' still goes straight in. An
// `inviteToken` (the email-bound invitation) is decided on its own page
// (InviteHandler: Accept / Decline), except right after a sign-up made
// here, which already accepted it.
const PendingApprovalScreen = () => (
  <div className="min-h-screen bg-[#faf9fa] flex items-center justify-center p-4 font-sans">
    <div className="bg-white p-8 lg:p-10 rounded-2xl shadow-xl max-w-md w-full border border-gray-100 text-center">
      <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
        <Clock size={32} />
      </div>
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">Request sent successfully!</h2>
      <p className="text-gray-500 font-medium text-sm">Waiting for a workspace admin to approve your request. You'll be able to access the workspace once it's approved.</p>
      <a href="/" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:text-brand-hover mt-8">
        Go to home
      </a>
    </div>
  </div>
);

// Serves both /login and /signup — same form, different default tab (see
// AuthForm's startOnSignup prop below). Owning the post-auth invite-accept
// step here (rather than inside AuthForm's own submit handlers) means it
// fires identically whichever way `user` got set — a normal login, or a
// brand-new signup completing its OTP step — without duplicating the logic
// or racing AuthForm's own navigation.
export const LoginPage = () => {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const inviteToken = searchParams.get('inviteToken');
  // Reusable invite-link token (see JoinWorkspacePage.tsx) — a separate query
  // param from inviteToken since it goes through a different backend
  // endpoint (POST /api/workspaces/join, not email-bound) and isn't tied to
  // any specific account, but otherwise follows the exact same "consume once
  // authenticated" shape.
  const joinToken = searchParams.get('joinToken');
  // StrictMode double-invokes effects in dev, which would otherwise fire two
  // near-simultaneous accept calls for the same token — guard so it only
  // ever actually runs once per token, not just tolerate the race server-side.
  const acceptedTokenRef = useRef<string | null>(null);
  const joinedTokenRef = useRef<string | null>(null);
  const [joinPending, setJoinPending] = useState(false);
  // Was someone already signed in when this page opened? (null until the
  // session check finishes.) Tells a sign-up made here apart from an
  // existing account that merely opened an invitation link.
  const arrivedSignedInRef = useRef<boolean | null>(null);
  if (!loading && arrivedSignedInRef.current === null) arrivedSignedInRef.current = !!user;

  useEffect(() => {
    if (!user || !inviteToken) return;
    if (acceptedTokenRef.current === inviteToken) return;
    acceptedTokenRef.current = inviteToken;
    // FA-SEC-04: the token comes from the address bar. Anything that isn't a
    // canonical UUID (e.g. "../../admin/users/<id>/ban") is refused here,
    // before any request is made; a valid one is still encoded into the path.
    if (!isInvitationToken(inviteToken)) {
      toast.error('This invitation link is invalid.');
      navigate('/', { replace: true });
      return;
    }
    const signedUpHere = location.pathname === '/signup' && arrivedSignedInRef.current === false;
    if (!signedUpHere) {
      // An existing account decides: the invitation page offers Accept /
      // Decline. Signing in (or opening a link) never accepts by itself.
      navigate(`/invite/${encodeURIComponent(inviteToken)}`, { replace: true });
      return;
    }
    // A new account created on this page: the sign-up itself accepted the
    // invitation (server side). Confirm it — idempotent for the same person —
    // and open the invited workspace.
    axios.post<{ workspaceId: string; generalChannelId: string }>(`/api/invitations/accept/${encodeURIComponent(inviteToken)}`)
      .then(({ data }) => navigate(`/${data.workspaceId}/c/${data.generalChannelId}`, { replace: true }))
      .catch((err) => {
        toast.error(err.response?.data?.error || 'Failed to join the invited workspace.');
        navigate('/', { replace: true });
      });
  }, [user, inviteToken, navigate, location.pathname]);

  useEffect(() => {
    if (!user || !joinToken) return;
    if (joinedTokenRef.current === joinToken) return;
    joinedTokenRef.current = joinToken;
    axios.post<
      { status: 'pending' } | { status: 'already_member'; workspaceId: string; generalChannelId: string }
    >('/api/workspaces/join', { token: joinToken })
      .then(({ data }) => {
        if (data.status === 'already_member') {
          navigate(`/${data.workspaceId}/c/${data.generalChannelId}`, { replace: true });
        } else {
          setJoinPending(true);
        }
      })
      .catch((err) => {
        toast.error(err.response?.data?.error || 'Failed to join the workspace.');
        navigate('/', { replace: true });
      });
  }, [user, joinToken, navigate]);

  if (loading) return <LoadingScreen />;
  if (joinPending) return <PendingApprovalScreen />;
  if (user) {
    if (inviteToken || joinToken) return <LoadingScreen />; // the effects above take it from here
    return <Navigate to={isAdminAccount(user) ? '/admin' : '/'} replace />;
  }

  return (
    <AuthForm
      startOnSignup={location.pathname === '/signup'}
      presetEmail={searchParams.get('email') ?? undefined}
    />
  );
};
