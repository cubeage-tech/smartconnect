import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { applyTabSessionUrl, clearStoredToken, isTabSessionActive, readStoredToken, writeStoredToken } from '../lib/devTabSession';
import { isSharedSignInEvent, sharedSignInChange } from '../lib/sharedSignIn';
import { User } from '../types';

/** Public sign-up fields. No role or permission is ever sent — the server makes every sign-up a Member. */
export interface SignupDetails {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  inviteToken?: string;
}

/** QA L39: the Administrator console was used with an account that is not an administrator. */
export class NotAnAdministratorError extends Error {
  constructor() {
    super('This account isn’t an administrator. Use the regular sign-in instead.');
    this.name = 'NotAnAdministratorError';
  }
}

interface AuthContextType {
  user: User | null;
  token: string | null;

  /** P2: keeps the in-session copy of User.lastActiveWorkspaceId current ("/" lands there). */
  setLastActiveWorkspace?: (workspaceId: string) => void;

  /**
   * QA L39: `adminOnly` (the Administrator console form) refuses a non-admin
   * account: the session it just created is ended and NotAnAdministratorError
   * is thrown, so the person stays on the form instead of being signed into
   * the regular app.
   */
  login: (
    email: string,
    password: string,
    options?: { adminOnly?: boolean }
  ) => Promise<void>;

  // Public, single-step signup — active path right now (no email/OTP
  // round-trip). Creates a Member account in SmartConnect Collab and hydrates
  // the session immediately. inviteToken (optional) is the e-mail invitation
  // this address was invited with; the server applies it only if still valid.
  signup: (details: SignupDetails) => Promise<void>;

  // Step 1 of sign-up: requests an email OTP. No session exists yet — the
  // account isn't created until verifySignupOtp succeeds.
  requestSignupOtp: (
    username: string,
    email: string,
    password: string
  ) => Promise<{ expiresAt: string }>;

  // Step 2: submits the code, and on success the backend has already
  // created the account and issued a token — hydrates that into session
  // state the same way hydrateSession does.
  verifySignupOtp: (
    email: string,
    code: string
  ) => Promise<void>;

  forgotPassword: (
    email: string
  ) => Promise<void>;

  // Hydrates an already-issued {token, user} pair into session state without
  // making a login/register call — used internally by verifySignupOtp once
  // the backend has already created the account and signed a token.
  hydrateSession: (
    token: string,
    user: User
  ) => void;

  /** Signs out: ends the server-side session (T.32), then clears this tab. */
  logout: () => void;
  loading: boolean;
  /**
   * T.32 (audit M17): set when the session could not be checked for a reason
   * other than "the session is over" (network error, server 5xx, rate limit).
   * The token is kept — the user is not signed out by a transient failure.
   */
  sessionError: string | null;
  retrySession: () => void;
}

const AuthContext = createContext<
  AuthContextType | undefined
>(undefined);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [user, setUser] =
    useState<User | null>(null);

  const [token, setToken] =
    useState<string | null>(() => {
      // T.37: the shared localStorage token, or — for an isolated local
      // development tab (?tabSession=1) — this tab's own one.
      applyTabSessionUrl();
      const validToken = readStoredToken();

      if (validToken) {
        axios.defaults.headers.common[
          'Authorization'
        ] = `Bearer ${validToken}`;
      }

      return validToken;
    });

  const [loading, setLoading] =
    useState(true);

  const [sessionError, setSessionError] =
    useState<string | null>(null);
  const [sessionAttempt, setSessionAttempt] =
    useState(0);

  // Allows logout inside effects
  const logoutRef = useRef<
    () => void
  >(() => {});

  // This tab's own session token. Kept in step synchronously (not only on
  // render) so sign-out and 401 handling always act on this tab's session.
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  // Local sign-out only: the server already considers the session over
  // (a 401), or logout() below has asked it to end the session.
  const clearSession = useCallback(() => {
    // The shared sign-in is removed only when it is still this tab's own: if
    // another tab has meanwhile signed in (possibly as someone else), that
    // sign-in is not this tab's to end.
    const stored = readStoredToken();
    if (!stored || stored === tokenRef.current) clearStoredToken();
    tokenRef.current = null;
    // Older builds kept a copy of the user object here; nothing reads it.
    localStorage.removeItem('user');

    delete axios.defaults.headers
      .common['Authorization'];

    setSessionError(null);
    setToken(null);
    setUser(null);
  }, []);

  // T.32 (audit H1): logging out ends the server-side session, so the token
  // stops working everywhere it may have been copied. Local sign-out never
  // waits for the network.
  const logout = useCallback(() => {
    // This tab's session — never whatever another tab last stored, which may
    // belong to a different account (it used to end that account's session
    // and leave this one running).
    const current = tokenRef.current;
    if (current) {
      void axios
        .post('/api/auth/logout', null, { headers: { Authorization: `Bearer ${current}` } })
        .catch(() => undefined);
    }
    clearSession();
  }, [clearSession]);

  logoutRef.current = clearSession;

  // One sign-in per browser profile (lib/sharedSignIn.ts): when another tab
  // signs in as a different account, or signs out, this tab starts over from
  // the current sign-in right away. A full page load is the only way to be
  // sure nothing the previous account loaded (messages, people, the socket)
  // stays on screen or keeps acting under the new one. (T.37 isolated
  // development tabs keep their own sign-in and are not affected.)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!isSharedSignInEvent(event) || isTabSessionActive()) return;
      const change = sharedSignInChange(tokenRef.current, readStoredToken());
      if (change === 'ignore') return;
      window.location.assign(change === 'signed-out' ? '/login' : '/');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // A stale copy of the user object from older builds (never read).
  useEffect(() => {
    try {
      localStorage.removeItem('user');
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common[
        'Authorization'
      ] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers
        .common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const checkAuth = async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      setSessionError(null);
      // T.32 (audit M17): only a 401 means the session is over. Anything else
      // (offline, a cold-starting server, 5xx, 429) is retried briefly and
      // then shown as a recoverable error — never a silent sign-out.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await axios.get<User>('/api/auth/me');
          if (cancelled) return;
          setUser(res.data);
          setLoading(false);
          return;
        } catch (err) {
          if (cancelled) return;
          if (axios.isAxiosError(err) && err.response?.status === 401) {
            logoutRef.current();
            setLoading(false);
            return;
          }
          if (attempt < 2) await wait(800 * 2 ** attempt);
        }
      }
      if (cancelled) return;
      setSessionError('We could not reach SmartConnect. Check your connection and try again.');
      setLoading(false);
    };

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [token, sessionAttempt]);

  const retrySession = useCallback(() => {
    setLoading(true);
    setSessionAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const interceptor =
      axios.interceptors.response.use(
        (response) => response,
        (error) => {
          if (
            error.response?.status ===
            401
          ) {
            logoutRef.current();
          }

          return Promise.reject(error);
        }
      );

    return () =>
      axios.interceptors.response.eject(
        interceptor
      );
  }, []);

  const login = async (
    email: string,
    password: string,
    options?: { adminOnly?: boolean }
  ) => {
    const res = await axios.post<{
      token: string;
      user: User;
    }>('/api/auth/login', {
      email,
      password,
    });

    const {
      token: newToken,
      user: newUser,
    } = res.data;

    if (options?.adminOnly && newUser.role !== 'ADMIN') {
      // End the session the server just created; nothing is stored in this tab.
      try {
        await axios.post('/api/auth/logout', null, { headers: { Authorization: `Bearer ${newToken}` } });
      } catch (err) {
        console.warn('Could not end the non-administrator session:', err);
      }
      throw new NotAnAdministratorError();
    }

    writeStoredToken(newToken);
    tokenRef.current = newToken;

    axios.defaults.headers.common[
      'Authorization'
    ] = `Bearer ${newToken}`;

    setToken(newToken);
    setUser(newUser);
  };

  const signup = async ({ fullName, email, password, confirmPassword, inviteToken }: SignupDetails) => {
    const res = await axios.post<{
      token: string;
      user: User;
    }>('/api/auth/signup', {
      fullName,
      email,
      password,
      confirmPassword,
      ...(inviteToken ? { inviteToken } : {}),
    });

    hydrateSession(res.data.token, res.data.user);
  };

  const requestSignupOtp = async (
    username: string,
    email: string,
    password: string
  ) => {
    const res = await axios.post<{
      message: string;
      expiresAt: string;
    }>('/api/auth/signup-request', {
      username,
      email,
      password,
    });

    return { expiresAt: res.data.expiresAt };
  };

  const verifySignupOtp = async (
    email: string,
    code: string
  ) => {
    const res = await axios.post<{
      token: string;
      user: User;
    }>('/api/auth/verify-otp', {
      email,
      code,
    });

    hydrateSession(res.data.token, res.data.user);
  };

  const forgotPassword = async (
    email: string
  ) => {
    await axios.post(
      '/api/auth/forgot-password',
      { email }
    );
  };

  const hydrateSession = (
    newToken: string,
    newUser: User
  ) => {
    writeStoredToken(newToken);
    tokenRef.current = newToken;

    axios.defaults.headers.common[
      'Authorization'
    ] = `Bearer ${newToken}`;

    setToken(newToken);
    setUser(newUser);
  };

  const setLastActiveWorkspace = useCallback((workspaceId: string) => {
    setUser((prev) => {
      if (!prev || prev.lastActiveWorkspaceId === workspaceId) return prev;
      return { ...prev, lastActiveWorkspaceId: workspaceId };
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        signup,
        requestSignupOtp,
        verifySignupOtp,
        forgotPassword,
        hydrateSession,
        logout,
        loading,
        sessionError,
        retrySession,
        setLastActiveWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return context;
};