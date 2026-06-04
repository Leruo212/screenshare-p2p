// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ---- Minimal DOM scaffold ---------------------------------------------------
//
// Matches the production template (screenshare.template.html). Each panel is
// a <section> with class "panel"; a "hidden" utility class flips display:none.
// Buttons and elements are referenced by id by both ui-controller and app.js.

function buildDOM() {
  document.body.innerHTML = `
    <div id="statusBar">
      <span id="statusText"></span>
      <span id="statusDot"></span>
    </div>

    <div id="errorToast" class="hidden"></div>

    <section id="landingPanel" class="panel">
      <button id="createBtn">Create</button>
      <button id="joinBtn">Join</button>
    </section>

    <section id="hostLobbyPanel" class="panel hidden">
      <a id="shareLink" href="#"></a>
      <button id="copyBtn">Copy</button>
      <select id="qualitySelect">
        <option value="720p">720p</option>
        <option value="1080p" selected>1080p</option>
        <option value="1440p">1440p</option>
        <option value="source">source</option>
      </select>
      <button id="startShareBtn" disabled>Start</button>
      <button id="stopShareBtn" class="hidden">Stop</button>
    </section>

    <section id="viewerWaitingPanel" class="panel hidden">
      <button id="reconnectBtn" class="hidden">Reconnect</button>
    </section>

    <section id="viewerStreamPanel" class="panel hidden">
      <div id="videoArea">
        <video id="remoteVideo"></video>
        <button id="fullscreenBtn">Fullscreen</button>
        <button id="unmuteBtn" class="unmute-btn hidden">
          <span class="unmute-icon"></span>
          <span class="unmute-label"></span>
        </button>
      </div>
    </section>
  `;
}

// ---- Mock PeerJS ------------------------------------------------------------
//
// Mirrors what peer-flow.test.js uses, kept local so app.test.js stands alone.

class MockDataConnection extends EventEmitter {
  constructor(remoteId) { super(); this.remoteId = remoteId; }
  send() {}
  close() { this.emit('close'); }
}
class MockMediaConnection extends EventEmitter {
  constructor(remoteId, stream) {
    super();
    this.remoteId = remoteId;
    this._stream = stream;
    this.answeredWith = undefined;
  }
  answer(s) { this.answeredWith = s; }
  close() { this.emit('close'); }
}
class MockPeer extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this._destroyed = false;
    this._dataConns = [];
    this._mediaConns = [];
    // Mirrors PeerJS 1.5.5: peer.call() returns undefined while disconnected.
    this._disconnected = true;
  }
  connect(remoteId) { const c = new MockDataConnection(remoteId); this._dataConns.push(c); return c; }
  call(remoteId, stream) {
    if (this._disconnected) return undefined;
    const m = new MockMediaConnection(remoteId, stream);
    this._mediaConns.push(m);
    return m;
  }
  destroy() { this._destroyed = true; this.emit('close'); }
}

// Helper: flip _disconnected to false and emit 'open' to mimic the broker
// confirming the viewer's ID. The viewer flow defers dial() to this event.
function fireOpenFor(peer) {
  peer._disconnected = false;
  peer.emit('open');
}

let createdPeers;

beforeEach(() => {
  buildDOM();
  createdPeers = [];
  const TrackedPeer = function (id) { const p = new MockPeer(id); createdPeers.push(p); return p; };
  TrackedPeer.prototype = MockPeer.prototype;
  globalThis.Peer = TrackedPeer;

  // Mock getDisplayMedia — returns a stream with one stable track we can
  // inspect from the test (getTracks() returns the same array on every call).
  const stopMock = vi.fn();
  const mockTrack = { stop: stopMock, onended: null, kind: 'video' };
  const mockTracks = [mockTrack];
  globalThis.navigator.mediaDevices = {
    getDisplayMedia: vi.fn().mockResolvedValue({
      id: 'mock-stream',
      getTracks: () => mockTracks,
      getVideoTracks: () => mockTracks,
    }),
  };

  // Mock clipboard
  globalThis.navigator.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

  // Mock location: jsdom provides a writable location; we set a default
  // hash + href and let tests override via `__setLocation`.
  __setLocation('', 'http://localhost/');
});

afterEach(() => {
  delete globalThis.Peer;
});

function __setLocation(hash, href) {
  // jsdom's location is a getter-only Location object; we can override
  // individual properties on it.
  window.location.hash = hash;
  if (href) window.location.href = href;
}

function __setHash(hash) {
  // Use defineProperty to bypass the readonly constraint on location.hash.
  Object.defineProperty(window, 'location', {
    value: { hash, href: window.location.href },
    writable: true,
    configurable: true,
  });
}

// ---- Helper: import app.js and dispatch DOMContentLoaded --------------------

async function bootApp() {
  // Reset module cache so each test gets a fresh top-level state.
  vi.resetModules();
  await import('../src/app.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  // Give microtasks a chance to resolve (e.g. connectAsViewer is sync, but
  // we yield to let any queued events fire).
  await new Promise((r) => setTimeout(r, 0));
}

// =============================================================================
// Tests
// =============================================================================

describe('app.js — landing page (no hash)', () => {
  it('shows the landing panel and sets status to "未连接" on load', async () => {
    __setHash('');
    await bootApp();

    expect(document.getElementById('landingPanel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('statusText').textContent).toBe('未连接');
  });

  it('clicking #createBtn triggers host creation flow', async () => {
    __setHash('');
    await bootApp();

    const createBtn = document.getElementById('createBtn');
    createBtn.click();

    // createHost should have created a new Peer
    expect(createdPeers).toHaveLength(1);
    // The host lobby panel should be visible
    expect(document.getElementById('hostLobbyPanel').classList.contains('hidden')).toBe(false);
    // The landing panel should be hidden
    expect(document.getElementById('landingPanel').classList.contains('hidden')).toBe(true);
  });

  it('host peer is registered with NORMALIZED room ID (lowercase, no dashes)', async () => {
    // Regression: the host used to call new Peer(rawDisplayForm) while the
    // viewer called new Peer(normalizedForm). The broker couldn't match them,
    // so the call failed with "Could not connect to peer". Both sides must
    // agree on the canonical (lowercase, no-dashes) form.
    __setHash('');
    await bootApp();
    document.getElementById('createBtn').click();
    // Peer id is set in the constructor.
    const hostPeerId = createdPeers[0].id;
    expect(hostPeerId).toMatch(/^[a-z0-9]{12}$/);
    // It should match the normalized form of the hash on the URL.
    const hashRoom = window.location.hash.slice(1);
    expect(hostPeerId).toBe(hashRoom.toLowerCase().replace(/-/g, ''));
  });

  it('after createBtn click, location.hash is set to "#<roomId>"', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();

    expect(window.location.hash).toMatch(/^#[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  it('after createBtn click, ui.setShareLink is called with a URL containing the room ID', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();

    const shareLink = document.getElementById('shareLink');
    expect(shareLink.textContent).toMatch(/#/);
    // The URL should contain the hyphenated room id
    expect(shareLink.textContent).toMatch(/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/);
  });

  it('shows error if PeerJS is not loaded when createBtn is clicked', async () => {
    __setHash('');
    // We want to import app first, then remove Peer, then click.
    await bootApp();
    delete globalThis.Peer;

    document.getElementById('createBtn').click();

    const errorToast = document.getElementById('errorToast');
    expect(errorToast.classList.contains('hidden')).toBe(false);
    expect(errorToast.textContent.length).toBeGreaterThan(0);
  });
});

describe('app.js — viewer flow (valid hash)', () => {
  it('on load with valid hash, calls connectAsViewer with normalized id', async () => {
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    // The viewer should show the "viewer-waiting" panel
    expect(document.getElementById('viewerWaitingPanel').classList.contains('hidden')).toBe(false);
    // The viewer Peer should be created with no preset id (broker assigns)
    expect(createdPeers).toHaveLength(1);
    // It should have called peer.connect('abcd1234efgh')
    expect(createdPeers[0]._dataConns).toHaveLength(1);
    expect(createdPeers[0]._dataConns[0].remoteId).toBe('abcd1234efgh');
  });

  it('on load with INVALID hash, shows error and does NOT start viewer flow', async () => {
    __setHash('#not-a-valid-room');
    await bootApp();

    const errorToast = document.getElementById('errorToast');
    expect(errorToast.classList.contains('hidden')).toBe(false);
    // No peer should be created for an invalid hash
    expect(createdPeers).toHaveLength(0);
  });

  it('viewer onConnected callback updates status to "已连接，等待共享..."', async () => {
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    // Simulate the data connection firing 'open'
    const dataConn = createdPeers[0]._dataConns[0];
    dataConn.emit('open');

    expect(document.getElementById('statusText').textContent).toBe('已连接，等待共享...');
    expect(document.getElementById('statusDot').classList.contains('connected')).toBe(true);
  });

  it('viewer onRemoteStream updates the video and shows the stream panel', async () => {
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    // Simulate the host calling us with a screen stream. The viewer
    // listens for `peer.on('call', mc)` and reads the stream from `mc.on('stream')`.
    const incoming = new MockMediaConnection('room-1', { id: 'host-screen' });
    createdPeers[0].emit('call', incoming);

    const stream = { id: 'host-screen', getTracks: () => [] };
    incoming.emit('stream', stream);

    const video = document.getElementById('remoteVideo');
    expect(video.srcObject).toBe(stream);
    expect(document.getElementById('viewerStreamPanel').classList.contains('hidden')).toBe(false);
  });

  it('viewer defaults to muted but surfaces an unmute button (autoplay policy)', async () => {
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    const incoming = new MockMediaConnection('room-1', { id: 'host-screen' });
    createdPeers[0].emit('call', incoming);
    incoming.emit('stream', { id: 'host-screen', getTracks: () => [] });

    const video = document.getElementById('remoteVideo');
    // Default muted to satisfy autoplay policy.
    expect(video.muted).toBe(true);
    // Unmute button always visible — label + icon reflect current state.
    const unmuteBtn = document.getElementById('unmuteBtn');
    expect(unmuteBtn.querySelector('.unmute-label').textContent).toMatch(/已静音/);
    expect(unmuteBtn.querySelector('.unmute-icon').textContent).toBe('🔇');
  });

  it('clicking the unmute button toggles video.muted and persists the preference', async () => {
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    const incoming = new MockMediaConnection('room-1', { id: 'host-screen' });
    createdPeers[0].emit('call', incoming);
    incoming.emit('stream', { id: 'host-screen', getTracks: () => [] });

    const video = document.getElementById('remoteVideo');
    const unmuteBtn = document.getElementById('unmuteBtn');
    expect(video.muted).toBe(true);

    // Click → unmuted.
    unmuteBtn.click();
    expect(video.muted).toBe(false);
    expect(unmuteBtn.querySelector('.unmute-label').textContent).toMatch(/已取消静音/);
    expect(globalThis.localStorage.getItem('screenshare-p2p-unmuted')).toBe('1');

    // Click again → muted.
    unmuteBtn.click();
    expect(video.muted).toBe(true);
    expect(globalThis.localStorage.getItem('screenshare-p2p-unmuted')).toBe('0');
  });

  it('viewer auto-unmutes on subsequent visits when the preference is "1"', async () => {
    globalThis.localStorage.setItem('screenshare-p2p-unmuted', '1');
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    const incoming = new MockMediaConnection('room-1', { id: 'host-screen' });
    createdPeers[0].emit('call', incoming);
    incoming.emit('stream', { id: 'host-screen', getTracks: () => [] });

    const video = document.getElementById('remoteVideo');
    expect(video.muted).toBe(false);
    const unmuteBtn = document.getElementById('unmuteBtn');
    expect(unmuteBtn.querySelector('.unmute-label').textContent).toMatch(/已取消静音/);
  });

  it('viewer onDisconnected updates status and shows error', async () => {
    __setHash('#abcd-1234-efgh');
    await bootApp();
    fireOpenFor(createdPeers[0]);

    // Simulate the data connection closing
    const dataConn = createdPeers[0]._dataConns[0];
    dataConn.emit('close');

    expect(document.getElementById('statusText').textContent).toBe('连接已断开');
    const errorToast = document.getElementById('errorToast');
    expect(errorToast.classList.contains('hidden')).toBe(false);
  });
});

describe('app.js — host start/stop sharing', () => {
  // Helper: simulate the viewer having opened a data connection. The host
  // learns the viewer's ID from this and uses it for the outgoing media call.
  // Also fires 'open' on the host peer so peer.call() works.
  function simulateViewerJoins() {
    fireOpenFor(createdPeers[0]);
    const c = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', c);
    return { dataConn: c };
  }

  it('host pushes the captured stream to the viewer with peer.call()', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();
    simulateViewerJoins();

    // Enable and click start share (the host UI enables it on viewer connect)
    document.getElementById('startShareBtn').disabled = false;
    document.getElementById('startShareBtn').click();
    // startSharing is async — wait for the getDisplayMedia promise to resolve.
    await new Promise((r) => setTimeout(r, 0));

    // getDisplayMedia should have been called
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    // The host should have made an outgoing peer.call() with the captured stream
    expect(createdPeers[0]._mediaConns).toHaveLength(1);
    const outgoing = createdPeers[0]._mediaConns[0];
    expect(outgoing.remoteId).toBe('viewer-1');
    expect(outgoing._stream).toBeTruthy();
    expect(outgoing._stream.id).toBe('mock-stream');
  });

  it('passes the host-selected quality into getDisplayMedia constraints', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();
    simulateViewerJoins();

    // Change quality before clicking start share.
    const select = document.getElementById('qualitySelect');
    select.value = '720p';
    select.dispatchEvent(new Event('change'));

    document.getElementById('startShareBtn').disabled = false;
    document.getElementById('startShareBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    const callArgs = navigator.mediaDevices.getDisplayMedia.mock.calls[0][0];
    expect(callArgs.video.width).toEqual({ max: 1280 });
    expect(callArgs.video.height).toEqual({ max: 720 });
  });

  it('default quality is 1080p if the host does not change the selector', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();
    simulateViewerJoins();

    document.getElementById('startShareBtn').disabled = false;
    document.getElementById('startShareBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    const callArgs = navigator.mediaDevices.getDisplayMedia.mock.calls[0][0];
    expect(callArgs.video.width).toEqual({ max: 1920 });
    expect(callArgs.video.height).toEqual({ max: 1080 });
  });

  it('stop sharing: track.onended is set, calling it triggers the stop flow', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();
    simulateViewerJoins();

    document.getElementById('startShareBtn').disabled = false;
    document.getElementById('startShareBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    // The captured stream has one track. Its onended callback should be set.
    const outgoing = createdPeers[0]._mediaConns[0];
    const track = outgoing._stream.getTracks()[0];
    expect(track.onended).toBeTypeOf('function');

    const stopBtn = document.getElementById('stopShareBtn');
    const startBtn = document.getElementById('startShareBtn');

    // Fire the track end event (e.g. user clicked the browser's "Stop sharing")
    track.onended();

    // After stop (v1 limitation: cannot restart sharing in the same room):
    //   - srcObject is null
    //   - stopBtn is hidden
    //   - startBtn is ALSO hidden (user must re-create the room to share again)
    //   - an error toast tells the user what to do
    expect(document.getElementById('remoteVideo').srcObject).toBeNull();
    expect(stopBtn.classList.contains('hidden')).toBe(true);
    expect(startBtn.classList.contains('hidden')).toBe(true);
    const errorToast = document.getElementById('errorToast');
    expect(errorToast.classList.contains('hidden')).toBe(false);
    expect(errorToast.textContent).toMatch(/重新创建房间/);
  });
});

describe('app.js — copy link', () => {
  it('clicking #copyBtn writes the share URL to the clipboard', async () => {
    __setHash('');
    await bootApp();

    document.getElementById('createBtn').click();
    const shareLink = document.getElementById('shareLink').textContent;

    document.getElementById('copyBtn').click();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shareLink);
  });
});

describe('app.js — fullscreen toggle', () => {
  it('clicking #fullscreenBtn calls requestFullscreen on the video container', async () => {
    __setHash('');
    await bootApp();

    const container = document.getElementById('videoArea');
    const requestFn = vi.fn().mockResolvedValue(undefined);
    container.requestFullscreen = requestFn;

    document.getElementById('fullscreenBtn').click();

    expect(requestFn).toHaveBeenCalledTimes(1);
  });

  it('exits fullscreen if already in fullscreen (Fullscreen API round-trip)', async () => {
    __setHash('');
    await bootApp();

    const exitFn = vi.fn();
    document.exitFullscreen = exitFn;
    // Simulate the browser being in fullscreen.
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.getElementById('videoArea'),
    });

    document.getElementById('fullscreenBtn').click();

    expect(exitFn).toHaveBeenCalled();

    // Reset the override so subsequent tests see a "not in fullscreen" state.
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
  });

  it('falls back to vendor-prefixed fullscreen API if standard one is missing', async () => {
    __setHash('');
    await bootApp();

    const container = document.getElementById('videoArea');
    const webkitFn = vi.fn().mockResolvedValue(undefined);
    // Make sure neither the standard requestFullscreen nor the document-level
    // fullscreenElement is set up. Some jsdom builds pre-define these as
    // no-ops; we need to ensure the chain reaches the webkit fallback.
    Object.defineProperty(container, 'requestFullscreen', {
      configurable: true,
      get: () => undefined,
    });
    Object.defineProperty(container, 'mozRequestFullScreen', {
      configurable: true,
      get: () => undefined,
    });
    Object.defineProperty(container, 'msRequestFullscreen', {
      configurable: true,
      get: () => undefined,
    });
    container.webkitRequestFullScreen = webkitFn;

    document.getElementById('fullscreenBtn').click();

    expect(webkitFn).toHaveBeenCalled();
  });
});
