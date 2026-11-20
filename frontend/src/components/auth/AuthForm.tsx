import axios from 'axios';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Shield, ShieldCheck, Zap } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isInvitationToken } from '../../lib/invitationToken';
import { type SignupErrors, type SignupInput, passwordStrength, validateResetEmail, validateSignIn, validateSignup } from '../../lib/signupValidation';
import { BrandMark } from '../ui/Brand';

interface AuthFormProps {
  // /signup lands here defaulted to the Sign Up tab instead of Login.
  startOnSignup?: boolean;
  // Comes from ?email=... on an invite-driven signup (see LoginPage.tsx) —
  // the invited address is fixed, so the field is locked rather than editable.
  presetEmail?: string;
  // QA L5: /admin/login opens the Administrator console form directly.
  startInAdminMode?: boolean;
}

const FIELD_ORDER: (keyof SignupInput)[] = ['fullName', 'email', 'password', 'confirmPassword'];
const FIELD_IDS: Record<keyof SignupInput, string> = {
  fullName: 'auth-name',
  email: 'auth-email',
  password: 'auth-password',
  confirmPassword: 'auth-confirm-password',
};

export const AuthForm = ({ startOnSignup = false, presetEmail, startInAdminMode = false }: AuthFormProps) => {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLogin, setIsLogin] = useState(!startOnSignup);
  const [email, setEmail] = useState(presetEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<SignupErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // QA M16: "Forgot password?" opens its own step instead of firing at once.
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'error' | 'success' } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Sign-up is public. An e-mail invitation's token may arrive as
  // ?inviteToken= (InviteHandler → /signup) and goes with the sign-up request,
  // so the new account also joins the invited workspace; the server verifies
  // it. Only a well-formed token is ever sent.
  const [searchParams] = useSearchParams();
  const rawInviteToken = searchParams.get('inviteToken');
  const inviteToken = isInvitationToken(rawInviteToken) ? rawInviteToken : undefined;

  // Admin Portal State
  const [isAdminMode, setIsAdminMode] = useState(startInAdminMode);

  // QA L5: the address follows the screen (/login, /signup, /admin/login), so
  // each can be linked and bookmarked. The query (invite token, preset e-mail)
  // is kept.
  const go = (pathname: string) => {
    if (location.pathname !== pathname) navigate({ pathname, search: location.search }, { replace: true });
  };

  const switchMode = (toLogin: boolean) => {
    setIsLogin(toLogin);
    setResetting(false);
    setMessage(null);
    setFieldErrors({});
    go(toLogin ? '/login' : '/signup');
  };

  /** Clears a field's error as soon as the person edits it. */
  const edit = (field: keyof SignupInput, set: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    if (fieldErrors[field]) setFieldErrors((errors) => ({ ...errors, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const signingUp = !isAdminMode && !isLogin;
    // QA L3: sign-in explains a missing field inline, like sign-up, instead
    // of the browser's own validation bubble.
    const errors = signingUp ? validateSignup({ fullName, email, password, confirmPassword }) : validateSignIn(email, password);
    setFieldErrors(errors);
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>(`#${FIELD_IDS[first]}`)?.focus();
      return;
    }
    setLoading(true);
    try {
      if (!signingUp) {
        await login(email.trim(), password, { adminOnly: isAdminMode });
      } else {
        // Direct signup, no email/OTP round-trip — see auth.service.ts's
        // signup. Only these fields are sent: the server makes every new
        // account a Member of SmartConnect Collab. AuthContext hydrates the
        // session on success; the router then lands them in the workspace.
        await signup({ fullName: fullName.trim(), email: email.trim(), password, confirmPassword, inviteToken });
        toast.success('Account created — welcome to SmartConnect Collab!');
      }
    } catch (err: any) {
      // QA L1: the reason is shown once, inline (no duplicate toast).
      // QA L39: a non-administrator on the Administrator console is told so.
      const text = err?.name === 'NotAnAdministratorError' ? err.message : err.response?.data?.error || 'Authentication failed';
      setMessage({ text, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const openReset = () => {
    setResetting(true);
    setMessage(null);
    setFieldErrors({});
    setPassword('');
  };

  // QA M16 + C2: a reset is only requested from its own step, for the address
  // typed there, and the answer is shown as the server gives it — including
  // "can't send right now" when no e-mail can go out.
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    const problem = validateResetEmail(address);
    if (problem) {
      setFieldErrors({ email: problem });
      formRef.current?.querySelector<HTMLInputElement>('#auth-email')?.focus();
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await axios.post('/api/auth/forgot-password', { email: address });
      setMessage({ text: res.data.message, type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error || 'Could not request a reset link. Check your connection and try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const toggleAdminMode = () => {
    setIsAdminMode(!isAdminMode);
    setIsLogin(true);
    setResetting(false);
    setMessage(null);
    setFieldErrors({});
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    go(isAdminMode ? '/login' : '/admin/login');
  };

  // T.32 design: one sign-in surface for both modes. The administrator mode
  // is a visual variant only — it calls the same login() as everyone else
  // (the server decides who is an administrator).
  const isSignup = !isAdminMode && !isLogin;
  const strength = isSignup && password ? passwordStrength(password) : null;
  const fieldClass =
    'block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-tertiary disabled:text-fg-muted aria-[invalid=true]:border-danger';
  const errorOf = (field: keyof SignupInput) => fieldErrors[field];
  const describedBy = (field: keyof SignupInput, ...more: (string | false)[]) =>
    [errorOf(field) && `${FIELD_IDS[field]}-error`, ...more].filter(Boolean).join(' ') || undefined;
  const fieldError = (field: keyof SignupInput) =>
    errorOf(field) ? (
      <p id={`${FIELD_IDS[field]}-error`} className="mt-1.5 text-xs text-danger">
        {errorOf(field)}
      </p>
    ) : null;

  return (
    <div className="flex min-h-screen bg-surface-secondary font-sans">
      {/* Brand panel */}
      <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-fg lg:flex">
        <span className="inline-flex items-center gap-2.5">
          <BrandMark size={30} />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-white">SmartConnect</span>
        </span>
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">
            {isAdminMode ? 'Run your company’s workspace.' : 'Where your team’s work happens.'}
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-sidebar-fg-muted">
            {isAdminMode
              ? 'Provision team leads, manage people and keep an eye on every workspace — from one console.'
              : 'Channels, direct messages, threads and calls in one calm, fast place.'}
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {(isAdminMode
              ? [
                  { icon: <Shield size={15} aria-hidden="true" />, text: 'Access checked on the server for every request' },
                  { icon: <ShieldCheck size={15} aria-hidden="true" />, text: 'Every administrative action is audit-logged' },
                ]
              : [
                  { icon: <Zap size={15} aria-hidden="true" />, text: 'Real-time messages, reactions and threads' },
                  { icon: <ShieldCheck size={15} aria-hidden="true" />, text: 'Private team workspaces and files' },
                ]
            ).map((item) => (
              <li key={item.text} className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.07] text-accent-300">{item.icon}</span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-fg-muted">© {new Date().getFullYear()} SmartConnect Collab</p>
      </aside>

      {/* Form */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px] animate-fade-in">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark size={28} />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">SmartConnect</span>
          </div>

          {!isAdminMode && !resetting && (
            <div role="tablist" aria-label="Sign in or sign up" className="mb-7 grid grid-cols-2 gap-1 rounded-lg bg-surface-tertiary p-1">
              <button type="button" role="tab" aria-selected={isLogin} onClick={() => switchMode(true)} className={`rounded-md py-1.5 text-sm font-medium transition-colors ${isLogin ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>Login</button>
              <button type="button" role="tab" aria-selected={!isLogin} onClick={() => switchMode(false)} className={`rounded-md py-1.5 text-sm font-medium transition-colors ${!isLogin ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>Sign Up</button>
            </div>
          )}

          <div className="mb-6">
            {isAdminMode && (
              <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                <Shield size={12} aria-hidden="true" /> Administrator
              </span>
            )}
            <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-fg">
              {resetting ? 'Reset your password' : isAdminMode ? 'Workspace administration' : isLogin ? 'Sign In' : 'Create Account'}
            </h2>
            <p className="mt-1.5 text-sm text-fg-muted">
              {resetting
                ? 'Enter the e-mail address of your account. We’ll e-mail you a link to choose a new password.'
                : isAdminMode
                ? 'Sign in with your administrator account to continue.'
                : isLogin
                  ? 'Enter your details to continue.'
                  : inviteToken
                    ? 'Create your account to join the workspace you were invited to.'
                    : 'Join SmartConnect Collab, the shared workspace for everyone.'}
            </p>
          </div>

          {message && (
            <div
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`mb-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${message.type === 'error' ? 'border-danger/25 bg-danger-soft text-danger' : 'border-success/25 bg-success-soft text-success'}`}
            >
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${message.type === 'error' ? 'bg-danger' : 'bg-success'}`} aria-hidden="true" />
              {message.text}
            </div>
          )}

          {resetting ? (
            <form ref={formRef} onSubmit={handleForgotPassword} className="space-y-4" noValidate>
              <div>
                <label htmlFor="auth-email" className="mb-1.5 block text-xs font-medium text-fg-muted">Email address</label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={edit('email', setEmail)}
                  aria-invalid={!!errorOf('email')}
                  aria-describedby={describedBy('email')}
                  className={fieldClass}
                  placeholder="you@company.com"
                  autoFocus
                />
                {fieldError('email')}
              </div>
              <button
                disabled={loading}
                type="submit"
                className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover active:scale-[0.99] disabled:opacity-70"
              >
                {loading ? <Loader2 size={16} className="animate-spin" aria-label="Working" /> : 'Send reset link'}
              </button>
              <button type="button" onClick={() => switchMode(true)} className="w-full text-center text-sm font-medium text-brand hover:text-brand-hover">
                Back to sign in
              </button>
            </form>
          ) : (
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
            {isSignup && (
              <div>
                <label htmlFor="auth-name" className="mb-1.5 block text-xs font-medium text-fg-muted">Full name</label>
                <input
                  id="auth-name"
                  required
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  value={fullName}
                  onChange={edit('fullName', setFullName)}
                  aria-invalid={!!errorOf('fullName')}
                  aria-describedby={describedBy('fullName')}
                  className={fieldClass}
                  placeholder="Jane Doe"
                />
                {fieldError('fullName')}
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-xs font-medium text-fg-muted">{isAdminMode ? 'Administrator e-mail' : 'Email address'}</label>
              <input
                id="auth-email"
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={edit('email', setEmail)}
                disabled={isSignup && !!presetEmail}
                readOnly={isSignup && !!presetEmail}
                aria-invalid={!!errorOf('email')}
                aria-describedby={describedBy('email', isSignup && !!presetEmail && 'auth-email-invite-note')}
                className={fieldClass}
                placeholder="you@company.com"
              />
              {fieldError('email')}
              {isSignup && !!presetEmail && <p id="auth-email-invite-note" className="mt-1.5 text-xs text-fg-subtle">This invite was sent to this address.</p>}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="auth-password" className="block text-xs font-medium text-fg-muted">Password</label>
                {isLogin && !isAdminMode && (
                  <button type="button" onClick={openReset} disabled={loading} className="text-xs font-medium text-brand hover:text-brand-hover disabled:opacity-60">
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={edit('password', setPassword)}
                  aria-invalid={!!errorOf('password')}
                  aria-describedby={describedBy('password', isSignup && 'auth-password-hint')}
                  className={`${fieldClass} pr-10`}
                  placeholder={isSignup ? 'Create a password' : 'Enter your password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle transition-colors hover:text-fg"
                >
                  {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </div>
              {fieldError('password')}
              {isSignup && !errorOf('password') && (
                <p id="auth-password-hint" className="mt-1.5 text-xs text-fg-subtle">
                  At least 6 characters.
                  {/* QA L7: a strength hint (advice only; the server's rule is unchanged). */}
                  {strength && <span className={`ml-1 font-medium ${strength.tone}`}> Strength: {strength.label}.</span>}
                  {strength?.tip && <span> {strength.tip}</span>}
                </p>
              )}
            </div>

            {isSignup && (
              <div>
                <label htmlFor="auth-confirm-password" className="mb-1.5 block text-xs font-medium text-fg-muted">Confirm password</label>
                <div className="relative">
                  <input
                    id="auth-confirm-password"
                    required
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={edit('confirmPassword', setConfirmPassword)}
                    aria-invalid={!!errorOf('confirmPassword')}
                    aria-describedby={describedBy('confirmPassword')}
                    className={`${fieldClass} pr-10`}
                    placeholder="Repeat your password"
                  />
                  {/* QA L6: the confirmation can be shown too. */}
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'}
                    aria-pressed={showConfirm}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle transition-colors hover:text-fg"
                  >
                    {showConfirm ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </button>
                </div>
                {fieldError('confirmPassword')}
              </div>
            )}

            <button
              disabled={loading}
              type="submit"
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover active:scale-[0.99] disabled:opacity-70"
            >
              {loading ? <Loader2 size={16} className="animate-spin" aria-label="Working" /> : <>{isAdminMode || isLogin ? 'Sign In' : 'Create Account'} {isAdminMode ? <Lock size={14} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}</>}
            </button>
          </form>
          )}

          {!isAdminMode && !resetting && (
            <p className="mt-5 text-center text-sm text-fg-muted">
              {/* Labels avoid "Sign In" / "Create Account": the submit button is the only control with those names. */}
              {isLogin ? 'New to SmartConnect?' : 'Already have an account?'}{' '}
              <button type="button" onClick={() => switchMode(!isLogin)} className="font-medium text-brand hover:text-brand-hover">
                {isLogin ? 'Sign up for free' : 'Log in instead'}
              </button>
            </p>
          )}

          <div className="mt-8 border-t border-line pt-5 text-center">
            <button type="button" onClick={toggleAdminMode} className="text-xs font-medium text-fg-subtle transition-colors hover:text-fg">
              {/* Labels avoid the words "Sign In": the submit button is the only control with that name. */}
              {isAdminMode ? '← Use a regular account' : 'Administrator console'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
