import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

/** Public sign-up: full name, e-mail, password and confirmation; an e-mail invitation token is optional. */

const auth = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOKEN = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const PASSWORD = 'Password123!';

const renderAt = (url: string, { presetEmail, startOnSignup = true }: { presetEmail?: string; startOnSignup?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthForm startOnSignup={startOnSignup} presetEmail={presetEmail} />
    </MemoryRouter>
  );

const fill = (values: Partial<Record<'name' | 'email' | 'password' | 'confirm', string>>) => {
  if (values.name !== undefined) fireEvent.change(screen.getByLabelText('Full name'), { target: { value: values.name } });
  if (values.email !== undefined) fireEvent.change(screen.getByLabelText('Email address'), { target: { value: values.email } });
  if (values.password !== undefined) fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: values.password } });
  if (values.confirm !== undefined) fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: values.confirm } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Create Account/ }));

afterEach(() => vi.clearAllMocks());

describe('AuthForm — public sign-up', () => {
  it('is open to everyone: full name, e-mail, password and confirmation create the account', async () => {
    auth.signup.mockResolvedValueOnce(undefined);
    renderAt('/signup');
    expect(screen.getByText('Join SmartConnect Collab, the shared workspace for everyone.')).toBeInTheDocument();
    expect(screen.queryByText(/invitation only/i)).not.toBeInTheDocument();
    fill({ name: '  Nadia Khan ', email: ' nadia@acme.io ', password: PASSWORD, confirm: PASSWORD });
    submit();
    await waitFor(() =>
      expect(auth.signup).toHaveBeenCalledWith({ fullName: 'Nadia Khan', email: 'nadia@acme.io', password: PASSWORD, confirmPassword: PASSWORD, inviteToken: undefined })
    );
    // No role, tier or permission is ever sent.
    expect(Object.keys(auth.signup.mock.calls[0][0]).sort()).toEqual(['confirmPassword', 'email', 'fullName', 'inviteToken', 'password']);
  });

  it('explains every invalid field inline and sends nothing', async () => {
    renderAt('/signup');
    submit();
    expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Choose a password.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Full name')).toHaveFocus();

    fill({ name: 'Nadia', email: 'not-an-email', password: '123', confirm: '123' });
    submit();
    expect(await screen.findByText('Enter a valid email address, like you@company.com.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 6 characters.')).toBeInTheDocument();

    fill({ email: 'nadia@acme.io', password: PASSWORD, confirm: 'Password123?' });
    submit();
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toHaveFocus();
    expect(auth.signup).not.toHaveBeenCalled();
  });

  it('clears a field’s error as soon as it is edited', async () => {
    renderAt('/signup');
    submit();
    expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();
    fill({ name: 'N' });
    expect(screen.queryByText('Enter your full name.')).not.toBeInTheDocument();
  });

  it('shows the server’s answer (e.g. an address that already has an account)', async () => {
    auth.signup.mockRejectedValueOnce({ response: { data: { error: 'An account with this email address already exists.' } } });
    renderAt('/signup');
    fill({ name: 'Nadia Khan', email: 'nadia@acme.io', password: PASSWORD, confirm: PASSWORD });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email address already exists.');
  });

  it('sends the invitation token from an invitation link, with the invited address locked', async () => {
    auth.signup.mockResolvedValueOnce(undefined);
    renderAt(`/signup?inviteToken=${TOKEN}&email=nadia%40acme.io`, { presetEmail: 'nadia@acme.io' });
    expect(screen.getByText('Create your account to join the workspace you were invited to.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    fill({ name: 'Nadia Khan', password: PASSWORD, confirm: PASSWORD });
    submit();
    await waitFor(() =>
      expect(auth.signup).toHaveBeenCalledWith({ fullName: 'Nadia Khan', email: 'nadia@acme.io', password: PASSWORD, confirmPassword: PASSWORD, inviteToken: TOKEN })
    );
  });

  it('never forwards a malformed token', async () => {
    auth.signup.mockResolvedValueOnce(undefined);
    renderAt('/signup?inviteToken=..%2F..%2Fadmin');
    fill({ name: 'Nadia Khan', email: 'nadia@acme.io', password: PASSWORD, confirm: PASSWORD });
    submit();
    await waitFor(() => expect(auth.signup).toHaveBeenCalledWith(expect.objectContaining({ inviteToken: undefined })));
  });

  it('the login page offers sign-up visibly, and back', () => {
    renderAt('/login', { startOnSignup: false });
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign Up' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up for free' }));
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log in instead' }));
    expect(screen.getByRole('button', { name: /Sign In/ })).toBeInTheDocument();
  });
});
