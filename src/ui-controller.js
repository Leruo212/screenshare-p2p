// UI controller — bridges DOM events to the app's state machine and exposes
// a small imperative API to update the DOM in response to state changes.
//
// We deliberately do NOT use event delegation: every button we care about
// gets a direct listener that we keep references to so destroy() can
// remove them.
//
// Panel visibility uses a `.hidden` utility class (CSS rule: display: none).

const PANEL_IDS = {
  landing: 'landingPanel',
  'host-lobby': 'hostLobbyPanel',
  'viewer-waiting': 'viewerWaitingPanel',
  'viewer-stream': 'viewerStreamPanel',
};

const ALL_PANELS = Object.values(PANEL_IDS);

export function initUI({ stateMachine, callbacks }) {
  // Cache element references up front; missing elements are an HTML bug.
  const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`ui-controller: missing element #${id}`);
    }
    return el;
  };

  const els = {
    statusText: $('statusText'),
    statusDot: $('statusDot'),
    errorToast: $('errorToast'),
    shareLink: $('shareLink'),
    remoteVideo: $('remoteVideo'),
    createBtn: $('createBtn'),
    joinBtn: $('joinBtn'),
    copyBtn: $('copyBtn'),
    startShareBtn: $('startShareBtn'),
    stopShareBtn: $('stopShareBtn'),
    reconnectBtn: $('reconnectBtn'),
  };

  // Keep the current share link so the copy button can pass it to the
  // app's copy handler (which may want to update the clipboard directly).
  let currentShareLink = '';

  // --- Click handlers (kept as refs so we can remove them on destroy) -----
  const handlers = [];

  function on(el, event, fn) {
    el.addEventListener(event, fn);
    handlers.push(() => el.removeEventListener(event, fn));
  }

  on(els.createBtn, 'click', () => {
    stateMachine.transition('create-room');
    callbacks.onCreateRoom?.();
  });

  on(els.joinBtn, 'click', () => {
    // Viewer flow is wired in app.js; the button is a no-op stub here.
    callbacks.onJoinRoom?.();
  });

  on(els.startShareBtn, 'click', () => {
    stateMachine.transition('start-sharing');
    callbacks.onStartSharing?.();
  });

  on(els.stopShareBtn, 'click', () => {
    stateMachine.transition('stop-sharing');
    callbacks.onStopSharing?.();
  });

  on(els.copyBtn, 'click', () => {
    callbacks.onCopyLink?.(currentShareLink);
  });

  on(els.reconnectBtn, 'click', () => {
    callbacks.onReconnect?.();
  });

  // --- Public controller API ----------------------------------------------

  return {
    setStatus(text, type) {
      els.statusText.textContent = text;
      // Reset the dot's color classes then add the requested type.
      els.statusDot.className = '';
      if (type) {
        els.statusDot.classList.add(type);
      }
    },

    showPanel(panel) {
      const targetId = PANEL_IDS[panel];
      if (!targetId) {
        throw new Error(`ui-controller: unknown panel "${panel}"`);
      }
      for (const id of ALL_PANELS) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (id === targetId) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    },

    setShareLink(url) {
      currentShareLink = url;
      els.shareLink.textContent = url;
      // Also set href so middle-click / drag works in the host lobby.
      els.shareLink.setAttribute('href', url);
    },

    setRemoteStream(stream) {
      els.remoteVideo.srcObject = stream;
    },

    showError(msg) {
      els.errorToast.textContent = msg;
      els.errorToast.classList.remove('hidden');
    },

    getState() {
      return stateMachine.state;
    },

    destroy() {
      for (const off of handlers) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      handlers.length = 0;
    },
  };
}
