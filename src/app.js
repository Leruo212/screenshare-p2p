// Entry point for the screenshare-p2p app.
// Wires together: state machine, UI controller, room-id, url, peer-flow,
// and constraints modules. Listens for DOMContentLoaded to bootstrap.
//
// Exports: nothing. Side effects only.

import { createStateMachine, STATES } from './state-machine.js';
import { initUI } from './ui-controller.js';
import { generateRoomId, normalizeRoomId } from './room-id.js';
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

function stopSharing(ui) {
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
  if (startBtn) startBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');

  // v1 limitation: PeerJS MediaConnection.answer() is single-use. Restarting
  // a share would require tearing down the host peer and forcing the viewer
  // to reconnect. Surface a clear next-step to the user instead of silently
  // re-enabling a button that would fail.
  ui.showError('共享已停止。如需再次共享，请重新创建房间。');
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
    stopSharing(ui);
    return;
  }

  // Wire up the browser's "Stop sharing" affordance: when a track ends
  // (e.g. user clicked the browser's stop button), tear down our state too.
  stream.getTracks().forEach((track) => {
    track.onended = () => {
      stopSharing(ui);
    };
  });

  // Flip the UI: "Start" becomes "Stop".
  if (startBtn) startBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.remove('hidden');
  ui.setStatus('共享中', 'connected');
}

// --- Host flow -------------------------------------------------------------

function hostStart(ui, stateMachine) {
  // Tear down any previous host peer so re-entering doesn't leak it.
  hostFlow?.close();
  hostFlow = null;
  localStream = null;

  // Generate a room id, set the hash, and create the host peer.
  const roomIdDisplay = generateRoomId();
  // The display form (with dashes, mixed case) is for humans. The actual
  // peer registration with the broker must use the normalized form
  // (lowercase, no dashes) — the viewer's URL parser produces the same form,
  // so both sides agree on the canonical ID.
  const roomId = normalizeRoomId(roomIdDisplay);
  setHash(roomIdDisplay);

  const shareUrl = buildShareUrl(roomIdDisplay, baseUrlFromLocation());
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
          stateMachine.transition('viewer-joined');
          ui.setStatus('观众已连接，准备共享', 'connected');
          const btn = document.getElementById('startShareBtn');
          if (btn) btn.disabled = false;
        },
        onViewerDisconnected() {
          stateMachine.transition('disconnect');
          ui.setStatus('观众已离开', '');
          const btn = document.getElementById('startShareBtn');
          if (btn) btn.disabled = true;
          // Also stop any active share, since the viewer is gone.
          if (localStream) stopSharing(ui);
        },
        onRemoteStream() {
          // Not used in v1 — host only sends, never receives.
        },
        onError(err) {
          stateMachine.transition('error');
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

function viewerStart(ui, stateMachine, hostId) {
  ui.showPanel('viewer-waiting');
  ui.setStatus('正在连接...', 'waiting');
  stateMachine.transition('join-room');

  let viewer;
  try {
    viewer = connectAsViewer({
      hostId,
      callbacks: {
        onConnected() {
          stateMachine.transition('viewer-connected-event');
          ui.setStatus('已连接，等待共享...', 'connected');
        },
        onRemoteStream(stream) {
          console.log('[viewer] onRemoteStream fired, tracks:', stream.getTracks().map((t) => t.kind));
          stateMachine.transition('stream-received');
          ui.setRemoteStream(stream);
          ui.showPanel('viewer-stream');
          ui.setStatus('正在接收共享', 'connected');
          const video = document.getElementById('remoteVideo');
          if (!video) return;
          // Mute the element regardless of the HTML attribute — some browsers
          // still enforce autoplay policy if a stream has audio tracks.
          // Users can unmute by right-clicking the video.
          video.muted = true;
          if (typeof video.play === 'function') {
            const p = video.play();
            if (p && typeof p.catch === 'function') {
              p.catch((err) => {
                console.warn('[viewer] video.play() rejected:', err && err.message);
              });
            }
          }
        },
        onDisconnected() {
          stateMachine.transition('disconnect');
          ui.setStatus('连接已断开', '');
          ui.showError('与主机的连接已断开');
          // Switch back to the waiting panel so the reconnect button
          // (which lives inside viewerWaitingPanel) is reachable.
          ui.showPanel('viewer-waiting');
          const reconnect = document.getElementById('reconnectBtn');
          if (reconnect) reconnect.classList.remove('hidden');
        },
        onError(err) {
          stateMachine.transition('error');
          // PeerJS throws English error messages; translate the common ones
          // to Chinese for the user.
          const raw = err?.message || String(err);
          const msg =
            /could not connect to peer/i.test(raw)
              ? '连接不到主机。请确认链接是否正确、主机是否仍在共享。'
              : /peer not connected/i.test(raw)
              ? '连接尚未建立，请稍后重试。'
              : '连接错误: ' + raw;
          ui.showError(msg);
          // Show the reconnect button so the user can retry without reloading.
          ui.showPanel('viewer-waiting');
          const reconnect = document.getElementById('reconnectBtn');
          if (reconnect) reconnect.classList.remove('hidden');
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
      onCreateRoom: () => hostStart(ui, stateMachine),
      onJoinRoom: () => {
        // v1: simple prompt. Reload with the new hash so bootstrap runs and
        // the viewer flow starts cleanly. (Hash-only mutation does not re-run
        // bootstrap and would leave the user on the landing panel.)
        const entered = window.prompt('请输入房间号（例如 Xxxx-Yyyy-Zzzz）：');
        if (entered && entered.trim().length > 0) {
          window.location.hash = `#${entered.trim()}`;
          window.location.reload();
        }
      },
      onStartSharing: () => {
        startSharing(ui).catch((err) => {
          ui.showError('共享失败: ' + (err?.message || String(err)));
        });
      },
      onStopSharing: () => stopSharing(ui),
      onCopyLink: (url) => copyLink(ui, url),
      onReconnect: () => window.location.reload(),
    },
  });

  // Initial routing: hash with a valid room id -> viewer flow; else -> landing.
  const initial = getRoomIdFromHash(window.location.hash);
  if (initial) {
    viewerStart(ui, stateMachine, initial);
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
