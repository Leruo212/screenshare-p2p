// PeerJS wrapper for the host and viewer sides of a screenshare session.
//
// In the browser, PeerJS is loaded via <script> and exposed as a global
// (`globalThis.Peer`). In tests we inject a mock by assigning
// `globalThis.Peer = MockPeer` before calling these functions.
//
// Media direction: HOST → VIEWER.
//
// Why this direction? In PeerJS 1.5.5, `peer.call(remoteId, null)` returns
// undefined because the library rejects calls without a local stream (see
// node_modules-style check: `if (!stream) return`). The viewer has no local
// stream to send (they want to RECEIVE the screen), so they cannot be the
// caller. Instead:
//
//   - Viewer opens a data connection to the host (so the host learns the
//     viewer's peer ID) and waits for an incoming media call.
//   - When the host captures a screen stream and a viewer is connected, the
//     host calls the viewer with the screen stream. The viewer receives it
//     via `peer.on('call', mc)` and listens for 'stream' on the incoming
//     MediaConnection.

function requirePeer() {
  if (typeof globalThis.Peer !== 'function') {
    throw new Error(
      'PeerJS is not loaded. In the browser it comes from <script src="...peerjs.min.js">; in tests set globalThis.Peer.'
    );
  }
  return globalThis.Peer;
}

// ICE servers (STUN + TURN) injected into PeerJS.
//
// Why we need TURN: WebRTC prefers a direct UDP path between the two peers.
// That path is blocked by ~30% of consumer networks — symmetric NAT
// (common on Chinese FTTR, 4G/5G CGNAT, corporate firewalls, hotel WiFi)
// drops inbound UDP. STUN can detect the public IP but cannot punch through;
// only TURN (a relay) saves the connection. The OpenRelay project runs a free
// public TURN pool with no authentication — small quota, fine for friends.
//
// Both sides MUST have the same ICE config. We pass the same array to the
// host and viewer Peer constructors.
const ICE_SERVERS = [
  // Public STUN (no auth, free). Used for path discovery.
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.miwifi.com:3478' }, // Xiaomi router STUN, useful in CN
  // OpenRelay TURN (no auth). Provides UDP + TCP + TLS relay endpoints.
  // Suffix ?transport= picks the protocol for that URL.
  { urls: 'turn:openrelay.metered.com:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.com:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.com:3478', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.com:3478?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.com:3478?transport=udp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// ---- Host ------------------------------------------------------------------
//
// Registers a Peer with id === roomId, then waits for a viewer to connect.
// When the viewer is on the data channel and the host has a local screen
// stream, the host pushes the stream to the viewer with `peer.call()`.
export function createHost({ roomId, callbacks }) {
  const Peer = requirePeer();
  const peer = new Peer(roomId, { config: { iceServers: ICE_SERVERS } });

  let viewerId = null;
  let dataConnection = null;
  let localStream = null;

  function fireViewerConnected() {
    if (callbacks.onViewerDisconnected) {
      dataConnection.on('close', () => callbacks.onViewerDisconnected());
    }
    callbacks.onViewerConnected?.();
  }

  peer.on('connection', (conn) => {
    dataConnection = conn;
    viewerId = conn.peer || conn.remoteId;
    if (callbacks.onError) {
      conn.on('error', (err) => callbacks.onError(err));
    }
    // If a stream was already added (race: viewer joined after host picked
    // a source), push it to the viewer now.
    if (localStream) {
      pushStreamToViewer();
    } else {
      fireViewerConnected();
    }
  });

  function pushStreamToViewer() {
    if (!viewerId || !localStream) return;
    console.log('[host] pushing stream to viewer', viewerId, 'tracks:', localStream.getTracks().map((t) => t.kind));
    // The viewer listens for `peer.on('call', mc)` and reads `mc.on('stream')`,
    // so this call surfaces the screen stream on the viewer side.
    const call = peer.call(viewerId, localStream);
    if (call) {
      if (callbacks.onError) call.on('error', (err) => {
        console.error('[host] outgoing call error:', err);
        callbacks.onError(err);
      });
      // Diagnostic: ICE connection state is the smoking gun when the viewer
      // sees "正在接收共享" but the screen is black. If ICE never reaches
      // connected/completed, NAT traversal is failing and a TURN server is
      // needed. PeerConnection is exposed on the call object in PeerJS 1.5+.
      const pc = call.peerConnection;
      if (pc) {
        const logIce = () =>
          console.log(
            `[host] ICE state: ${pc.iceConnectionState} | conn: ${pc.connectionState} | signaling: ${pc.signalingState}`
          );
        pc.addEventListener('iceconnectionstatechange', logIce);
        pc.addEventListener('connectionstatechange', logIce);
        logIce();
        // If ICE stays failed/disconnected for >5s, surface a clear error
        // to the user. This is the most common cause of cross-network black
        // screens: direct UDP blocked, TURN relay unreachable.
        let iceFailureTimer = null;
        const watchIce = () => {
          if (iceFailureTimer) clearTimeout(iceFailureTimer);
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            iceFailureTimer = setTimeout(() => {
              if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                const err = new Error(
                  'ICE 协商失败：无法建立直连或 TURN 中继。两端网络可能互相屏蔽 UDP。'
                );
                console.error('[host] ICE failed after 5s, surfacing to UI');
                callbacks.onError?.(err);
              }
            }, 5000);
          }
        };
        pc.addEventListener('iceconnectionstatechange', watchIce);
      } else {
        console.warn('[host] call.peerConnection is undefined — cannot diagnose ICE');
      }
    } else if (callbacks.onError) {
      // Should not happen — we have a valid localStream. Surface defensively.
      callbacks.onError(
        new Error('无法向观众推送屏幕流（peer.call 返回 undefined）')
      );
    }
    fireViewerConnected();
  }

  if (callbacks.onError) {
    peer.on('error', (err) => callbacks.onError(err));
  }

  return {
    peer,
    addLocalStream(stream) {
      localStream = stream;
      // If the viewer is already on the data channel, push immediately.
      // Otherwise, the 'connection' handler will push once the viewer joins.
      if (dataConnection) {
        pushStreamToViewer();
      }
    },
    close() {
      try {
        dataConnection?.close();
      } catch {
        /* ignore */
      }
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---- Viewer ----------------------------------------------------------------
//
// Creates a Peer (broker assigns an id), opens a data connection to the host
// (so the host learns the viewer's ID), and listens for an incoming media
// call from the host. When the call arrives with a 'stream' event, that's
// the host's screen.
export function connectAsViewer({ hostId, callbacks }) {
  const Peer = requirePeer();
  const peer = new Peer(undefined, { config: { iceServers: ICE_SERVERS } });

  let connection = null;
  let incomingCall = null;

  function dial() {
    connection = peer.connect(hostId);
    if (connection) {
      connection.on('open', () => {
        callbacks.onConnected?.();
      });
      connection.on('close', () => {
        callbacks.onDisconnected?.();
      });
      connection.on('data', () => {
        // No data-channel protocol in v1.
      });
      if (callbacks.onError) {
        connection.on('error', (err) => callbacks.onError(err));
      }
    } else if (callbacks.onError) {
      callbacks.onError(new Error('无法建立数据通道'));
    }

    // Listen for the host to call us with the screen stream.
    peer.on('call', (mc) => {
      console.log('[viewer] incoming call from host, answering');
      incomingCall = mc;
      if (callbacks.onError) {
        mc.on('error', (err) => {
          console.error('[viewer] media call error:', err);
          callbacks.onError(err);
        });
      }
      mc.on('stream', (remoteStream) => {
        console.log('[viewer] got remote stream, tracks:', remoteStream.getTracks().map((t) => t.kind));
        callbacks.onRemoteStream?.(remoteStream);
      });
      mc.on('close', () => {
        // Don't double-fire: the data channel's close is the source of truth.
      });
      // mc.answer() is async. The promise may reject if WebRTC negotiation
      // fails (e.g. ICE can't reach the host). We don't currently have an
      // outgoing stream, but answer() with no argument is valid: the host's
      // offer contains tracks, our answer is recvonly for those tracks.
      Promise.resolve(mc.answer()).catch((err) => {
        console.error('[viewer] mc.answer() rejected:', err);
        if (callbacks.onError) callbacks.onError(err);
      });
      // Watch for ICE failure on the incoming media connection. If ICE stays
      // failed/disconnected for >5s, surface a clear error so the user knows
      // the network blocked the connection (rather than seeing a silent
      // black screen and wondering what went wrong).
      const pc = mc.peerConnection;
      if (pc) {
        let iceFailureTimer = null;
        const watchIce = () => {
          console.log(
            `[viewer] ICE state: ${pc.iceConnectionState} | conn: ${pc.connectionState}`
          );
          if (iceFailureTimer) clearTimeout(iceFailureTimer);
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            iceFailureTimer = setTimeout(() => {
              if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                const err = new Error(
                  'ICE 协商失败：无法建立直连或 TURN 中继。两端网络可能互相屏蔽 UDP。'
                );
                console.error('[viewer] ICE failed after 5s, surfacing to UI');
                callbacks.onError?.(err);
              }
            }, 5000);
          }
        };
        pc.addEventListener('iceconnectionstatechange', watchIce);
        watchIce();
      }
    });
  }

  // Defer dialing until the broker confirms the viewer's ID. peer.call /
  // peer.connect on a disconnected peer either no-op or throw, depending on
  // the PeerJS version.
  if (peer.open) {
    dial();
  } else {
    peer.once('open', dial);
  }

  if (callbacks.onError) {
    peer.on('error', (err) => callbacks.onError(err));
  }

  return {
    get connection() {
      return connection;
    },
    close() {
      try {
        connection?.close();
      } catch {
        /* ignore */
      }
      try {
        incomingCall?.close();
      } catch {
        /* ignore */
      }
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
