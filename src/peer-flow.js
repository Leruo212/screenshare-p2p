// PeerJS wrapper for the host and viewer sides of a screenshare session.
//
// In the browser, PeerJS is loaded via <script> and exposed as a global
// (`globalThis.Peer`). In tests we inject a mock by assigning
// `globalThis.Peer = MockPeer` before calling these functions.
//
// We use PeerJS's MediaConnection ("call") to negotiate the WebRTC session.
// PeerJS supports `peer.call(remoteId, null)` to mean "I have no local stream
// to send; please send me one" — the receiver registers a 'stream' listener
// on the returned MediaConnection and the remote side calls `.answer(stream)`
// on its incoming MediaConnection to deliver its local stream.

function requirePeer() {
  if (typeof globalThis.Peer !== 'function') {
    throw new Error(
      'PeerJS is not loaded. In the browser it comes from <script src="...peerjs.min.js">; in tests set globalThis.Peer.'
    );
  }
  return globalThis.Peer;
}

// ---- Host ------------------------------------------------------------------
//
// Registers a Peer with id === roomId, then waits for a viewer to dial:
//   - peer.on('connection')  → viewer opened a data channel to us
//   - peer.on('call')        → viewer wants our screen stream
//
// In PeerJS, when the viewer does `peer.call(hostId, null)`, the host receives
// the SAME MediaConnection via `peer.on('call', mc)`. To deliver our local
// stream back, we call `mc.answer(localStream)` on that stored connection —
// NOT a fresh `peer.call(viewerId, stream)`. A fresh call would create a
// second, unrelated MediaConnection that the viewer's `on('stream')`
// listener (attached to its outgoing call) would never receive.
//
// The 'connection' and 'call' events may arrive in either order. We buffer
// whichever arrives first and only fire onViewerConnected + wire up
// onViewerDisconnected / onError once BOTH are present.
export function createHost({ roomId, callbacks }) {
  const Peer = requirePeer();
  const peer = new Peer(roomId);

  let viewerId = null;
  let dataConnection = null;
  let mediaConnection = null;

  function tryFireViewerConnected() {
    if (!dataConnection || !mediaConnection) return;
    viewerId = dataConnection.peer || dataConnection.remoteId;
    if (callbacks.onViewerDisconnected) {
      dataConnection.on('close', () => callbacks.onViewerDisconnected());
    }
    callbacks.onViewerConnected?.(mediaConnection);
  }

  peer.on('connection', (conn) => {
    dataConnection = conn;
    if (callbacks.onError) {
      conn.on('error', (err) => callbacks.onError(err));
    }
    tryFireViewerConnected();
  });

  peer.on('call', (mc) => {
    mediaConnection = mc;
    if (callbacks.onError) {
      mc.on('error', (err) => callbacks.onError(err));
    }
    // The viewer dialed us to request our stream. We answer only when
    // addLocalStream is called (host hasn't picked a source yet). For now
    // we register a 'stream' listener defensively — the viewer sends no
    // media, so this should never fire, but it keeps the API uniform.
    mc.on('stream', (remoteStream) => {
      callbacks.onRemoteStream?.(remoteStream);
    });
    tryFireViewerConnected();
  });

  if (callbacks.onError) {
    peer.on('error', (err) => callbacks.onError(err));
  }

  return {
    peer,
    addLocalStream(localStream) {
      if (!mediaConnection) {
        throw new Error('No viewer has requested the stream yet.');
      }
      // Answer the viewer's existing MediaConnection with our local stream.
      mediaConnection.answer(localStream);
      return mediaConnection;
    },
    close() {
      try {
        dataConnection?.close();
      } catch {
        /* ignore */
      }
      try {
        mediaConnection?.close();
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
// Creates a Peer (broker assigns an id), then simultaneously:
//   - opens a data connection to the host
//   - calls the host with null media to request its screen stream
//
// When the host answers, the resulting MediaConnection emits 'stream' with
// the host's local MediaStream.
//
// IMPORTANT: we must wait for the peer's 'open' event before calling
// peer.connect() / peer.call(). In PeerJS 1.5.5, both return `undefined` while
// the peer is in the "disconnected" state (pre-broker-handshake), and calling
// `.on()` on undefined throws "Cannot read properties of undefined".
export function connectAsViewer({ hostId, callbacks }) {
  const Peer = requirePeer();
  const peer = new Peer();

  // The connection handles aren't available until the broker has confirmed
  // the viewer's ID. They may also be undefined if the peer flips to a
  // disconnected state mid-handshake (rare but possible).
  let connection = null;
  let mediaCall = null;

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

    // Request the host's stream. peer.call() with null media means
    // "I have nothing to send, please stream TO me".
    mediaCall = peer.call(hostId, null);
    if (mediaCall) {
      mediaCall.on('stream', (remoteStream) => {
        callbacks.onRemoteStream?.(remoteStream);
      });
      mediaCall.on('close', () => {
        // Don't double-fire: the data channel's close is the source of truth.
      });
      if (callbacks.onError) {
        mediaCall.on('error', (err) => callbacks.onError(err));
      }
    } else if (callbacks.onError) {
      callbacks.onError(
        new Error('无法发起媒体连接，请稍后重试（peer 未就绪）')
      );
    }
  }

  // Defer dialing until the broker confirms the viewer's ID. If 'open' has
  // already fired (rare in practice but possible), dial immediately.
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
        mediaCall?.close();
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
