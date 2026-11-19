import axios from 'axios';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Shield, ShieldCheck, Zap } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isInvitationToken } from '../../lib/invitationToken';
import { type SignupErrors, type SignupInput, validateSignup } from '../../lib/signupValidation';
import { BrandMark } from '../ui/Brand';

interface AuthFormProps {
  // /signup lands here defaulted to the Sign Up tab instead of Login.
  startOnSignup?: boolean;
  // Comes from ?email=... on an invite-driven signup (see LoginPage.tsx) —
  // the invited address is fixed, so the field is locked rather than editable.
  presetEmail?: string;
}

const FIELD_ORDER: (keyof SignupInput)[] = ['fullName', 'email', 'password', 'confirmPassword'];
const FIELD_IDS: Record<keyof SignupInput, string> = {
  fullName: 'auth-name',
  email: 'auth-email',
  password: 'auth-password',
  confirmPassword: 'auth-confirm-password',
};

export const AuthForm = ({ startOnSignup = false, presetEmail }: AuthFormProps) => {
  const { login, signup } = useAuth();
  const [isLogin, setIsLogin] = useState(!startOnSignup);
  const [email, setEmail] = useState(presetEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<SignupErrors>({});
  const [showPassword, setShowPassword] = useState(false);
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
  const [isAdminMode, setIsAdminMode] = useState(false);

  const switchMode = (toLogin: boolean) => {
    setIsLogin(toLogin);
    setMessage(null);
    setFieldErrors({});
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
    if (signingUp) {
      const errors = validateSignup({ fullName, email, password, confirmPassword });
      setFieldErrors(errors);
      const first = FIELD_ORDER.find((field) => errors[field]);
      if (first) {
        formRef.current?.querySelector<HTMLInputElement>(`#${FIELD_IDS[first]}`)?.focus();
        return;
      }
    }
    setLoading(true);
    try {
      if (!signingUp) {
        await login(email, password);
      } else {
        // Direct signup, no email/OTP round-trip — see auth.service.ts's
        // signup. Only these fields are sent: the server makes every new
        // account a Member of SmartConnect Collab. AuthContext hydrates the
        // session on success; the router then lands them in the workspace.
        await signup({ fullName: fullName.trim(), email: email.trim(), password, confirmPassword, inviteToken });
        toast.success('Account created — welcome to SmartConnect Collab!');
      }
    } catch (err: any) {
      const text = err.response?.data?.error || 'Authentication failed';
      setMessage({ text, type: 'error' });
      toast.error(text);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setMessage({ text: 'Please enter your email address first.', type: 'error' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await axios.post('/api/auth/forgot-password', { email });
      setMessage({ text: res.data.message || 'Reset link sent to your email!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error || 'Failed to send reset email.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const toggleAdminMode = () => {
    setIsAdminMode(!isAdminMode);
    setIsLogin(true);
    setMessage(null);
    setFieldErrors({});
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  // T.32 design: one sign-in surface for both modes. The administrator mode
  // is a visual variant only — it calls the same login() as everyone else
  // (the server decides who is an administrator).
  const isSignup = !isAdminMode && !isLogin;
  const fieldClass =
    'block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-tertiary disabled:text-fg-muted aria-[invalid=true]:border-danger';
  const errorOf = (field: keyof SignupInput) => (isSignup ? fieldErrors[field] : undefined);
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

          {!isAdminMode && (
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
              {isAdminMode ? 'Workspace administration' : isLogin ? 'Sign In' : 'Create Account'}
            </h2>
            <p className="mt-1.5 text-sm text-fg-muted">
              {isAdminMode
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

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate={isSignup}>
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
                  placeholder="Samarth Karale"
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
                  <button type="button" onClick={handleForgotPassword} disabled={loading} className="text-xs font-medium text-brand hover:text-brand-hover disabled:opacity-60">
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
                  placeholder="••••••••"
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
              {isSignup && !errorOf('password') && <p id="auth-password-hint" className="mt-1.5 text-xs text-fg-subtle">At least 6 characters.</p>}
            </div>

            {isSignup && (
              <div>
                <label htmlFor="auth-confirm-password" className="mb-1.5 block text-xs font-medium text-fg-muted">Confirm password</label>
                <input
                  id="auth-confirm-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={edit('confirmPassword', setConfirmPassword)}
                  aria-invalid={!!errorOf('confirmPassword')}
                  aria-describedby={describedBy('confirmPassword')}
                  className={fieldClass}
                  placeholder="••••••••"
                />
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

          {!isAdminMode && (
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
