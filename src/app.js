// Entry point for the screenshare-p2p app.
// Wires together: state machine, UI controller, room-id, url, peer-flow,
// and constraints modules. Listens for DOMContentLoaded to bootstrap.
//
// Exports: nothing. Side effects only.

import { createStateMachine, STATES } from './state-machine.js';
import { initUI } from './ui-controller.js';
import { generateRoomId } from './room-id.js';
import { getRoomIdFromHash, buildShareUrl } from './url.js';
import { createHost, connectAsViewer } from './peer-flow.js';
import { buildDisplayMediaConstraints } from './constraints.js';

const COPY_BUTTON_FLASH_MS = 1500;

// Per-session state held by the app. The state machine is exposed for the
// UI controller, and the host/viewer flow handles are kept for stop / close.
let hostFlow = null;
let localStream = null;

function setHash(roomIdDisplay) {
  // Use the hyphenated form for display, e.g. "Xxxx-Yyyy-Zzzz".
  window.location.hash = `#${roomIdDisplay}`;
}

function baseUrlFromLocation() {
  // Strip any hash so buildShareUrl can append a clean "#<id>".
  return window.location.href.split('#')[0];
}

// --- Stop sharing (host) ---------------------------------------------------
//
// Stops all tracks on the local stream, clears the video element, and
// restores the UI to the "viewer connected, ready to share" state.

function stopSharing() {
  if (localStream) {
    try {
      localStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    localStream = null;
  }
  const video = document.getElementById('remoteVideo');
  if (video) video.srcObject = null;

  const startBtn = document.getElementById('startShareBtn');
  const stopBtn = document.getElementById('stopShareBtn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.classList.remove('hidden');
  }
  if (stopBtn) stopBtn.classList.add('hidden');
}

// --- Start sharing (host) --------------------------------------------------
//
// Captures the screen via getDisplayMedia, shows a local preview in the
// video element, and pipes the stream through the host flow.

async function startSharing(ui) {
  const startBtn = document.getElementById('startShareBtn');
  const stopBtn = document.getElementById('stopShareBtn');

  if (startBtn) startBtn.disabled = true;

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      buildDisplayMediaConstraints()
    );
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      ui.showError('无法捕获屏幕: ' + err.message);
    }
    if (startBtn) startBtn.disabled = false;
    return;
  }

  localStream = stream;

  // Reuse the same <video> element for self-preview on the host.
  ui.setRemoteStream(stream);
  try {
    const video = document.getElementById('remoteVideo');
    if (video && typeof video.play === 'function') {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* autoplay may be blocked; the local preview will still attach */
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Hand the stream to the host flow (it answers the viewer's MediaConnection).
  try {
    hostFlow?.addLocalStream(stream);
  } catch (err) {
    ui.showError('共享失败: ' + err.message);
    stopSharing();
    return;
  }

  // Wire up the browser's "Stop sharing" affordance: when a track ends
  // (e.g. user clicked the browser's stop button), tear down our state too.
  stream.getTracks().forEach((track) => {
    track.onended = () => {
      stopSharing();
    };
  });

  // Flip the UI: "Start" becomes "Stop".
  if (startBtn) startBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.remove('hidden');
  ui.setStatus('共享中', 'connected');
}

// --- Host flow -------------------------------------------------------------

function hostStart(ui) {
  // Generate a room id, set the hash, and create the host peer.
  const roomId = generateRoomId();
  setHash(roomId);

  const shareUrl = buildShareUrl(roomId, baseUrlFromLocation());
  ui.setShareLink(shareUrl);
  ui.showPanel('host-lobby');
  ui.setStatus('等待观众加入...', 'waiting');

  // Reset the start/stop button states in case we're re-using the lobby.
  const startBtn = document.getElementById('startShareBtn');
  const stopBtn = document.getElementById('stopShareBtn');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.classList.remove('hidden');
  }
  if (stopBtn) stopBtn.classList.add('hidden');

  let host;
  try {
    host = createHost({
      roomId,
      callbacks: {
        onViewerConnected() {
          ui.setStatus('观众已连接，准备共享', 'connected');
          const btn = document.getElementById('startShareBtn');
          if (btn) btn.disabled = false;
        },
        onViewerDisconnected() {
          ui.setStatus('观众已离开', '');
          const btn = document.getElementById('startShareBtn');
          if (btn) btn.disabled = true;
          // Also stop any active share, since the viewer is gone.
          if (localStream) stopSharing();
        },
        onRemoteStream() {
          // Not used in v1 — host only sends, never receives.
        },
        onError(err) {
          ui.showError('信令错误: ' + (err?.message || String(err)));
        },
      },
    });
  } catch (err) {
    ui.showError(err.message || String(err));
    return;
  }

  hostFlow = host;
}

// --- Viewer flow -----------------------------------------------------------

function viewerStart(ui, hostId) {
  ui.showPanel('viewer-waiting');
  ui.setStatus('正在连接...', 'waiting');

  let viewer;
  try {
    viewer = connectAsViewer({
      hostId,
      callbacks: {
        onConnected() {
          ui.setStatus('已连接，等待共享...', 'connected');
        },
        onRemoteStream(stream) {
          ui.setRemoteStream(stream);
          ui.showPanel('viewer-stream');
          ui.setStatus('正在接收共享', 'connected');
          const video = document.getElementById('remoteVideo');
          if (video && typeof video.play === 'function') {
            const p = video.play();
            if (p && typeof p.catch === 'function') {
              p.catch(() => {
                /* autoplay may be blocked; the user can click play */
              });
            }
          }
        },
        onDisconnected() {
          ui.setStatus('连接已断开', '');
          ui.showError('与主机的连接已断开');
          const reconnect = document.getElementById('reconnectBtn');
          if (reconnect) reconnect.classList.remove('hidden');
        },
        onError(err) {
          ui.showError('连接错误: ' + (err?.message || String(err)));
        },
      },
    });
  } catch (err) {
    ui.showError(err.message || String(err));
    return;
  }

  // Stash the viewer handle so the page could close it on unload in the future.
  ui._viewerFlow = viewer;
}

// --- Copy link -------------------------------------------------------------

async function copyLink(ui, url) {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    // The host may not have clipboard permission (e.g. served from file://
    // in some browsers). Log and move on — the user can still copy manually.
    console.error('clipboard write failed:', err);
    return;
  }
  const btn = document.getElementById('copyBtn');
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = '已复制!';
  setTimeout(() => {
    btn.textContent = original;
  }, COPY_BUTTON_FLASH_MS);
}

// --- Bootstrap -------------------------------------------------------------

function bootstrap() {
  const stateMachine = createStateMachine();

  const ui = initUI({
    stateMachine,
    callbacks: {
      onCreateRoom: () => hostStart(ui),
      onJoinRoom: () => {
        // v1: simple prompt. The page reloads with the new hash, which
        // triggers the viewer flow on load.
        const entered = window.prompt('请输入房间号（例如 Xxxx-Yyyy-Zzzz）：');
        if (entered && entered.trim().length > 0) {
          window.location.hash = `#${entered.trim()}`;
        }
      },
      onStartSharing: () => {
        startSharing(ui).catch((err) => {
          ui.showError('共享失败: ' + (err?.message || String(err)));
        });
      },
      onStopSharing: () => stopSharing(),
      onCopyLink: (url) => copyLink(ui, url),
      onReconnect: () => window.location.reload(),
    },
  });

  // Initial routing: hash with a valid room id -> viewer flow; else -> landing.
  const initial = getRoomIdFromHash(window.location.hash);
  if (initial) {
    viewerStart(ui, initial);
  } else {
    ui.showPanel('landing');
    ui.setStatus('未连接', '');
    // If the hash was set but didn't parse as a room id, surface that.
    if (
      typeof window.location.hash === 'string' &&
      window.location.hash.length > 1
    ) {
      ui.showError('房间号格式无效，应为 Xxxx-Yyyy-Zzzz 形式');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  // DOM is already parsed (e.g. when the script runs after parse in tests).
  bootstrap();
}
