import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Production incident 2026-11-23: on networks where the WebSocket handshake
 * to the API fails (while HTTPS works), the client used to retry WebSocket
 * forever and never fall back to HTTP long-polling — pages loaded over REST,
 * but no live event ever arrived, so new messages appeared only after a
 * reload. The connection must fall back to polling.
 */
const ioMock = vi.hoisted(() =>
  vi.fn(() => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), io: { on: vi.fn(), off: vi.fn() } }))
);
vi.mock('socket.io-client', () => ({ io: ioMock }));
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.resolve()) } }));

import { useSocket } from './useSocket';

afterEach(() => ioMock.mockClear());

describe('useSocket transports', () => {
  it('tries WebSocket first and falls back to HTTP long-polling when it fails', () => {
    renderHook(() => useSocket('token-1'));
    expect(ioMock).toHaveBeenCalledTimes(1);
    const options = (ioMock.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(options.transports).toEqual(['websocket', 'polling']);
    expect(options.tryAllTransports).toBe(true);
    expect(options.auth).toEqual({ token: 'token-1' });
    expect(options.reconnectionAttempts).toBe(Infinity);
  });

  it('opens no connection without a session', () => {
    renderHook(() => useSocket(null));
    expect(ioMock).not.toHaveBeenCalled();
  });
});
