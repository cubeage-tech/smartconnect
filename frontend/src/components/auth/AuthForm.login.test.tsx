import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

/** QA C2, M16, L1, L3, L5, L6, L7, L39 — sign-in, password reset and the administrator form. */

const auth = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn() }));
const http = vi.hoisted(() => ({ post: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('axios', () => ({ default: http }));
vi.mock('react-toastify', () => ({ toast: toasts }));

const Location = () => <span data-testid="path">{useLocation().pathname}</span>;
const renderAt = (url = '/login', props: { startInAdminMode?: boolean; startOnSignup?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthForm {...props} />
      <Location />
    </MemoryRouter>
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe('QA — sign-in form', () => {
  it('L3: an empty sign-in is explained inline and nothing is sent', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('L1: a refused sign-in is shown once, inline — no duplicate toast', async () => {
    auth.login.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } });
    renderAt();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(toasts.error).not.toHaveBeenCalled();
    expect(auth.login).toHaveBeenCalledWith('a@b.co', 'wrong-pass', { adminOnly: false });
  });

  it('L3: an administrator-issued sign-in identifier (not a full e-mail address) still reaches the server', async () => {
    auth.login.mockResolvedValueOnce(undefined);
    renderAt();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'sam4f2a@2003' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'sam123' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('sam4f2a@2003', 'sam123', { adminOnly: false }));
    expect(screen.queryByText(/Enter a valid email address/)).not.toBeInTheDocument();
  });

  it('L6: password fields have plain-language placeholders, and the confirmation can be shown', () => {
    renderAt('/signup', { startOnSignup: true });
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveAttribute('placeholder', 'Create a password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('placeholder', 'Repeat your password');
    expect(screen.getByLabelText('Full name')).toHaveAttribute('placeholder', 'Jane Doe');
    fireEvent.click(screen.getByRole('button', { name: 'Show password confirmation' }));
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
  });

  it('L7: a strength hint appears while choosing a password', () => {
    renderAt('/signup', { startOnSignup: true });
    const field = screen.getByLabelText('Password', { selector: 'input' });
    fireEvent.change(field, { target: { value: 'abcdef' } });
    expect(screen.getByText(/Strength: Weak/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Correct-Horse-9' } });
    expect(screen.getByText(/Strength: Strong/)).toBeInTheDocument();
  });

  it('L5: the address follows the tab (/login <-> /signup) and the administrator form (/admin/login)', () => {
    renderAt('/login');
    fireEvent.click(screen.getByRole('tab', { name: 'Sign Up' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/signup');
    fireEvent.click(screen.getByRole('tab', { name: 'Login' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Administrator console' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/login');
  });
});

describe('QA M16 + C2 — password reset has its own step and reports the truth', () => {
  const openReset = () => fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

  it('"Forgot password?" opens a reset step and sends nothing until asked', () => {
    renderAt();
    openReset();
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password', { selector: 'input' })).not.toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('asks for an address before sending', async () => {
    renderAt();
    openReset();
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('shows the server’s neutral reply on success', async () => {
    http.post.mockResolvedValueOnce({ data: { message: 'If an account exists for that address, a password reset link is on its way.' } });
    renderAt();
    openReset();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'me@acme.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/auth/forgot-password', { email: 'me@acme.io' }));
    expect(await screen.findByRole('status')).toHaveTextContent('on its way');
  });

  it('C2: when no e-mail can be sent, says so as an error — never "sent"', async () => {
    http.post.mockRejectedValueOnce({ response: { status: 503, data: { error: 'Password reset e-mails can’t be sent right now.' } } });
    renderAt();
    openReset();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'me@acme.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('can’t be sent right now');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('"Back to sign in" returns to the sign-in form', () => {
    renderAt();
    openReset();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument();
  });
});

describe('QA L39 — the Administrator console signs administrators in only', () => {
  it('asks login() for an administrator and explains a refusal on the form', async () => {
    const refusal = Object.assign(new Error('This account isn’t an administrator. Use the regular sign-in instead.'), { name: 'NotAnAdministratorError' });
    auth.login.mockRejectedValueOnce(refusal);
    renderAt('/admin/login', { startInAdminMode: true });
    expect(screen.getByRole('heading', { name: 'Workspace administration' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Administrator e-mail'), { target: { value: 'lead@acme.io' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t an administrator');
    expect(auth.login).toHaveBeenCalledWith('lead@acme.io', 'secret-1', { adminOnly: true });
  });
});
