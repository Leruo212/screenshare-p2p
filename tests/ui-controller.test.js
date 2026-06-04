// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initUI } from '../src/ui-controller.js';

// Minimal HTML scaffold matching what the production template will provide.
// Each panel is a <section> with class "panel"; a "hidden" utility class
// flips display:none. Buttons are referenced by id.
function buildDOM() {
  document.body.innerHTML = `
    <div id="statusBar">
      <span id="statusText"></span>
      <span id="statusDot"></span>
    </div>

    <section id="landingPanel" class="panel">
      <button id="createBtn">Create</button>
      <button id="joinBtn">Join</button>
    </section>

    <section id="hostLobbyPanel" class="panel hidden">
      <a id="shareLink" href="#"></a>
      <button id="copyBtn">Copy</button>
      <button id="startShareBtn">Start</button>
      <button id="stopShareBtn">Stop</button>
    </section>

    <section id="viewerWaitingPanel" class="panel hidden">
      <button id="reconnectBtn">Reconnect</button>
    </section>

    <section id="viewerStreamPanel" class="panel hidden">
      <video id="remoteVideo"></video>
    </section>

    <div id="errorToast" class="hidden"></div>
  `;
}

beforeEach(() => {
  buildDOM();
});

// ---- initUI shape -----------------------------------------------------------

describe('initUI', () => {
  it('returns a controller object with the documented methods', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    expect(controller).toBeTypeOf('object');
    for (const m of [
      'setStatus',
      'showPanel',
      'setShareLink',
      'setRemoteStream',
      'showError',
      'getState',
      'destroy',
    ]) {
      expect(typeof controller[m]).toBe('function');
    }
  });
});

// ---- Click handlers --------------------------------------------------------

describe('click handlers', () => {
  it('clicking #createBtn calls onCreateRoom', () => {
    const onCreateRoom = vi.fn();
    const sm = { state: 'idle', transition: vi.fn() };
    initUI({ stateMachine: sm, callbacks: { onCreateRoom } });
    document.getElementById('createBtn').click();
    expect(onCreateRoom).toHaveBeenCalledTimes(1);
  });

  it('clicking #createBtn also transitions the state machine with "create-room"', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    initUI({ stateMachine: sm, callbacks: { onCreateRoom: vi.fn() } });
    document.getElementById('createBtn').click();
    expect(sm.transition).toHaveBeenCalledWith('create-room');
  });

  it('clicking #startShareBtn calls onStartSharing', () => {
    const onStartSharing = vi.fn();
    const sm = { state: 'idle', transition: vi.fn() };
    initUI({ stateMachine: sm, callbacks: { onStartSharing } });
    document.getElementById('startShareBtn').click();
    expect(onStartSharing).toHaveBeenCalledTimes(1);
  });

  it('clicking #startShareBtn transitions the state machine with "start-sharing"', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    initUI({ stateMachine: sm, callbacks: { onStartSharing: vi.fn() } });
    document.getElementById('startShareBtn').click();
    expect(sm.transition).toHaveBeenCalledWith('start-sharing');
  });

  it('clicking #stopShareBtn calls onStopSharing and transitions "stop-sharing"', () => {
    const onStopSharing = vi.fn();
    const sm = { state: 'hosting-sharing', transition: vi.fn() };
    initUI({ stateMachine: sm, callbacks: { onStopSharing } });
    document.getElementById('stopShareBtn').click();
    expect(onStopSharing).toHaveBeenCalledTimes(1);
    expect(sm.transition).toHaveBeenCalledWith('stop-sharing');
  });

  it('clicking #copyBtn calls onCopyLink with the current shareLink', () => {
    const onCopyLink = vi.fn();
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: { onCopyLink } });
    controller.setShareLink('https://example.com/screenshare.html#room-1');
    document.getElementById('copyBtn').click();
    expect(onCopyLink).toHaveBeenCalledWith('https://example.com/screenshare.html#room-1');
  });
});

// ---- setStatus -------------------------------------------------------------

describe('setStatus', () => {
  it('updates #statusText text and adds the type as a class on #statusDot', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    controller.setStatus('已连接', 'connected');
    expect(document.getElementById('statusText').textContent).toBe('已连接');
    expect(document.getElementById('statusDot').classList.contains('connected')).toBe(true);
  });
});

// ---- showPanel -------------------------------------------------------------

describe('showPanel', () => {
  it('showPanel("host-lobby") shows #hostLobbyPanel and hides others', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    controller.showPanel('host-lobby');
    expect(document.getElementById('hostLobbyPanel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('landingPanel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('viewerWaitingPanel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('viewerStreamPanel').classList.contains('hidden')).toBe(true);
  });

  it('showPanel("landing") shows the landing panel and hides others', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    controller.showPanel('host-lobby'); // start elsewhere
    controller.showPanel('landing');
    expect(document.getElementById('landingPanel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('hostLobbyPanel').classList.contains('hidden')).toBe(true);
  });
});

// ---- setShareLink ----------------------------------------------------------

describe('setShareLink', () => {
  it('sets #shareLink text to the supplied URL', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    controller.setShareLink('https://example.com/screenshare.html#abc-def-ghi');
    expect(document.getElementById('shareLink').textContent).toBe(
      'https://example.com/screenshare.html#abc-def-ghi'
    );
  });
});

// ---- setRemoteStream -------------------------------------------------------

describe('setRemoteStream', () => {
  it('sets video.srcObject to the provided stream', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    const stream = { id: 'stream-1', getTracks: () => [] };
    controller.setRemoteStream(stream);
    expect(document.getElementById('remoteVideo').srcObject).toBe(stream);
  });
});

// ---- showError -------------------------------------------------------------

describe('showError', () => {
  it('sets #errorToast text and removes the "hidden" class', () => {
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    controller.showError('网络已断开');
    expect(document.getElementById('errorToast').textContent).toBe('网络已断开');
    expect(document.getElementById('errorToast').classList.contains('hidden')).toBe(false);
  });
});

// ---- getState / destroy ----------------------------------------------------

describe('getState / destroy', () => {
  it('getState() returns the underlying state machine state', () => {
    const sm = { state: 'hosting-waiting', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: {} });
    expect(controller.getState()).toBe('hosting-waiting');
  });

  it('destroy() removes event listeners (subsequent clicks do not call callbacks)', () => {
    const onCreateRoom = vi.fn();
    const sm = { state: 'idle', transition: vi.fn() };
    const controller = initUI({ stateMachine: sm, callbacks: { onCreateRoom } });
    controller.destroy();
    document.getElementById('createBtn').click();
    expect(onCreateRoom).not.toHaveBeenCalled();
  });
});
