import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: in a video call people saw everyone else but not themselves.
 * The camera stream was put on the self-view <video> once, when the camera
 * started — while the call screen still showed "Requesting camera/microphone
 * access…" and the self-view tile did not exist yet — so the tile rendered a
 * moment later with nothing in it. The self-view must show the local camera
 * (or the shared screen while presenting) whenever it is on screen.
 */
const auth = vi.hoisted(() => ({ user: { id: 'me', username: 'mia' } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../lib/iceConfig', () => ({
  loadIceConfig: vi.fn(async () => ({ iceServers: [{ urls: ['stun:stun.example.test'] }], relay: false })),
  currentIceServers: () => [{ urls: ['stun:stun.example.test'] }],
}));

import { CallOverlay } from './CallOverlay';

class FakeSocket {
  private handlers = new Map<string, Set<(payload?: unknown) => void>>();
  sent: { event: string; payload: Record<string, unknown> }[] = [];
  on(event: string, fn: (payload?: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: (payload?: unknown) => void) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, payload: Record<string, unknown>) {
    this.sent.push({ event, payload });
    return this;
  }
  receive(event: string, payload?: unknown) {
    this.handlers.get(event)?.forEach((fn) => fn(payload));
  }
  emitted(event: string) {
    return this.sent.filter((s) => s.event === event).map((s) => s.payload);
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  constructor() {
    FakePeerConnection.instances.push(this);
  }
  connectionState = 'new';
  signalingState = 'stable';
  remoteDescription: unknown = null;
  onicecandidate: unknown = null;
  ontrack: ((e: { streams: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  setRemoteDescription = vi.fn(async (d: unknown) => {
    this.remoteDescription = d;
  });
  setLocalDescription = vi.fn(async () => undefined);
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'local-offer' }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'local-answer' }));
  addIceCandidate = vi.fn(async () => undefined);
  restartIce = vi.fn();
  close = vi.fn();
  getSenders = () => [];
}

const track = (kind: 'audio' | 'video') => ({ kind, enabled: true, stop: vi.fn(), onended: null as null | (() => void) });
const fakeStream = (label: string, tracks: ReturnType<typeof track>[]) => ({
  label,
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  addTrack: vi.fn(),
  removeTrack: vi.fn(),
});

const CHANNEL = 'chan-1';
let camera: ReturnType<typeof fakeStream>;
let screenCapture: ReturnType<typeof fakeStream>;
let releaseCamera: () => void;

beforeEach(() => {
  FakePeerConnection.instances = [];
  camera = fakeStream('camera', [track('audio'), track('video')]);
  screenCapture = fakeStream('screen', [track('video')]);
  // The camera answers only when the test says so — like a real permission prompt.
  const cameraReady = new Promise<void>((resolve) => (releaseCamera = resolve));
  const getUserMedia = vi.fn(async () => {
    await cameraReady;
    return camera;
  });
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  vi.stubGlobal('RTCSessionDescription', class { constructor(init: object) { Object.assign(this, init); } });
  vi.stubGlobal('RTCIceCandidate', class { constructor(init: object) { Object.assign(this, init); } });
  vi.stubGlobal('AudioContext', class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, getByteFrequencyData() {} }; }
    close() { return Promise.resolve(); }
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, getDisplayMedia: vi.fn(async () => screenCapture), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The <video> inside the "(You)" tile, or null while that tile is not on screen. */
const selfView = () => {
  const label = screen.queryByText('mia (You)', { selector: 'span' });
  return (label?.closest('div')?.querySelector('video') as (HTMLVideoElement & { srcObject: unknown }) | null) ?? null;
};

const startVideoCall = async () => {
  const socket = new FakeSocket();
  render(<CallOverlay channelId={CHANNEL} callType="video" socket={socket as unknown as Socket} onEndCall={vi.fn()} workspaceId="ws-1" />);
  // While the browser asks for the camera, the self-view tile is not rendered yet.
  expect(screen.getByText('Requesting camera/microphone access…')).toBeInTheDocument();
  expect(selfView()).toBeNull();
  await act(async () => {
    releaseCamera();
  });
  await waitFor(() => expect(socket.emitted('webrtc:join')).toHaveLength(1));
  return socket;
};

const deliver = async (socket: FakeSocket, event: string, payload?: unknown) => {
  await act(async () => {
    socket.receive(event, payload);
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('CallOverlay — your own video (self-view)', () => {
  it('shows your camera as soon as the call screen appears, mirrored and muted', async () => {
    await startVideoCall();
    const video = selfView();
    expect(video).not.toBeNull();
    expect(video!.srcObject).toBe(camera);
    expect(video!.muted).toBe(true); // never play your own microphone back to yourself
    expect(video!.className).toContain('-scale-x-100'); // mirrored, like a mirror
    expect(video!.style.display).toBe('block');
  });

  it('keeps showing your camera while waiting, and next to the others once their video arrives', async () => {
    const socket = await startVideoCall();
    await deliver(socket, 'webrtc:existing-participants', { participants: [] });
    expect(screen.getAllByText('Waiting for others to join…').length).toBeGreaterThan(0);
    expect(selfView()!.srcObject).toBe(camera);

    // Bob is in the call: his media arrives over the peer connection.
    await deliver(socket, 'webrtc:existing-participants', { participants: [{ socketId: 'peer-b', userId: 'u-b', username: 'bob' }] });
    const bobStream = fakeStream('bob', [track('audio'), track('video')]);
    await act(async () => {
      FakePeerConnection.instances.at(-1)!.ontrack!({ streams: [bobStream] });
    });
    const bobVideo = screen.getByText('bob', { selector: 'span' }).closest('div')!.querySelector('video') as HTMLVideoElement & { srcObject: unknown };
    expect(bobVideo.srcObject).toBe(bobStream);
    expect(selfView()!.srcObject).toBe(camera); // both: you and them
  });

  it('turning the camera off shows your initial; turning it back on shows your camera again', async () => {
    await startVideoCall();
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera off' }));
    expect(selfView()!.style.display).toBe('none');
    expect(camera.getVideoTracks()[0].enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    expect(selfView()!.style.display).toBe('block');
    expect(selfView()!.srcObject).toBe(camera);
  });

  it('shows the shared screen while presenting (not mirrored), then your camera again', async () => {
    await startVideoCall();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share your screen' }));
    });
    await waitFor(() => expect(selfView()!.srcObject).toBe(screenCapture));
    expect(selfView()!.className).not.toContain('-scale-x-100');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop sharing your screen' }));
    });
    await waitFor(() => expect(selfView()!.srcObject).toBe(camera));
    expect(selfView()!.className).toContain('-scale-x-100');
  });
});
