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
import { buildDisplayMediaConstraints, applyEncoderTuning } from './constraints.js';

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

  // Read the host's current quality selection right before opening the picker
  // so the user can change their mind up to the last second.
  const quality = ui.getQuality();

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      buildDisplayMediaConstraints(quality)
    );
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      ui.showError('无法捕获屏幕: ' + err.message);
    }
    if (startBtn) startBtn.disabled = false;
    return;
  }

  localStream = stream;

  // Diagnostic: log the actual capture resolution so we can confirm the
  // browser isn't silently down-scaling below the requested quality.
  stream.getVideoTracks().forEach((t) => {
    const s = t.getSettings?.();
    console.log(
      `[host] capture settings: ${s?.width}x${s?.height}@${s?.frameRate}fps`
    );
    applyEncoderTuning(t);
  });

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
          // Mute by default to satisfy the browser autoplay policy, but
          // surface an unmute button so the viewer can hear system audio.
          // We persist the preference in localStorage so a repeat visitor
          // doesn't have to click it again.
          const unmuteBtn = document.getElementById('unmuteBtn');
          const UNMUTE_KEY = 'screenshare-p2p-unmuted';
          let wasUnmuted = false;
          try {
            wasUnmuted = globalThis.localStorage?.getItem(UNMUTE_KEY) === '1';
          } catch {
            /* localStorage may be blocked in private mode */
          }
          video.muted = !wasUnmuted;
          const setUnmuteLabel = (unmuted) => {
            if (!unmuteBtn) return;
            unmuteBtn.classList.toggle('is-unmuted', unmuted);
            const icon = unmuteBtn.querySelector('.unmute-icon');
            const label = unmuteBtn.querySelector('.unmute-label');
            if (icon) icon.textContent = unmuted ? '🔊' : '🔇';
            if (label) label.textContent = unmuted ? '已取消静音' : '已静音（点此取消）';
          };
          setUnmuteLabel(wasUnmuted);
          if (unmuteBtn) {
            unmuteBtn.onclick = () => {
              const nextUnmuted = video.muted; // currently muted -> unmuting
              video.muted = !nextUnmuted;
              setUnmuteLabel(nextUnmuted);
              try {
                globalThis.localStorage?.setItem(UNMUTE_KEY, nextUnmuted ? '1' : '0');
              } catch {
                /* ignore */
              }
            };
          }
          if (typeof video.play === 'function') {
            const p = video.play();
            if (p && typeof p.catch === 'function') {
              p.catch((err) => {
                console.warn('[viewer] video.play() rejected:', err && err.message);
              });
            }
          }

          // Diagnostic: log the actual state of the incoming tracks + the
          // video element. If the viewer is showing "正在接收共享" but the
          // screen is black, these values tell us exactly which step failed.
          stream.getTracks().forEach((t) => {
            console.log(
              `[viewer] track ${t.kind}: enabled=${t.enabled} muted=${t.muted} readyState=${t.readyState} id=${t.id}`
            );
          });
          const v = document.getElementById('remoteVideo');
          if (v) {
            console.log(
              `[viewer] video: readyState=${v.readyState} networkState=${v.networkState} videoWidth=${v.videoWidth} muted=${v.muted} autoplay=${v.autoplay} srcObject=${v.srcObject ? 'set' : 'null'}`
            );
            // Watchdog: poll the video state for the first 6 seconds to catch
            // "frame never arrives" or "readyState stuck at 0" situations.
            let elapsed = 0;
            const wd = setInterval(() => {
              elapsed += 500;
              console.log(
                `[viewer] watchdog t=${elapsed}ms: readyState=${v.readyState} videoWidth=${v.videoWidth} videoHeight=${v.videoHeight} paused=${v.paused} currentTime=${v.currentTime}`
              );
              if (elapsed >= 6000 || v.videoWidth > 0) {
                clearInterval(wd);
              }
            }, 500);
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

// --- Fullscreen toggle (viewer) -------------------------------------------
//
// Uses the Fullscreen API on the video container (not the <video> element
// itself — that way the fullscreen button stays visible inside the container).
// ESC exits fullscreen natively; we just listen for the `fullscreenchange`
// event to keep the button label in sync.

function toggleFullscreen() {
  const container = document.getElementById('videoArea');
  if (!container) return;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  // Vendor-prefixed fallbacks for older Safari (the rest of the app already
  // excludes Safari, but fullscreen is harmless to support opportunistically).
  const req =
    container.requestFullscreen?.bind(container) ||
    container.webkitRequestFullScreen?.bind(container) ||
    container.mozRequestFullScreen?.bind(container) ||
    container.msRequestFullscreen?.bind(container);
  if (!req) {
    console.warn('Fullscreen API not supported on this browser');
    return;
  }
  try {
    const result = req();
    if (result && typeof result.catch === 'function') {
      result.catch((err) => console.warn('Fullscreen request rejected:', err));
    }
  } catch (err) {
    console.warn('Fullscreen request threw:', err);
  }
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
      onQualityChange: () => {
        // Quality selection is read at start-sharing time (see startSharing).
        // This callback is wired so future "apply without restart" features
        // can be added without re-plumbing events.
      },
      onToggleFullscreen: () => toggleFullscreen(),
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
