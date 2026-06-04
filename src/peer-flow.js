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
// When a viewer connects, we remember its data connection and listen for the
// incoming call. We do NOT answer the call until the host picks a screen
// (caller invokes addLocalStream), at which point we call the viewer back
// with our local stream.
export function createHost({ roomId, callbacks }) {
  const Peer = requirePeer();
  const peer = new Peer(roomId);

  // Track the most recent viewer so addLocalStream can call them.
  let viewerId = null;
  let dataConnection = null;
  let mediaConnection = null;

  peer.on('connection', (conn) => {
    dataConnection = conn;
    viewerId = conn.peer || conn.remoteId;
    callbacks.onViewerConnected?.(conn);

    if (callbacks.onViewerDisconnected) {
      conn.on('close', () => callbacks.onViewerDisconnected());
    }
  });

  peer.on('call', (mc) => {
    mediaConnection = mc;
    // The viewer dialed us to request our stream. We answer only when
    // addLocalStream is called (host hasn't picked a source yet). For now
    // we register a 'stream' listener defensively — the viewer sends no
    // media, so this should never fire, but it keeps the API uniform.
    mc.on('stream', (remoteStream) => {
      callbacks.onRemoteStream?.(remoteStream);
    });
  });

  if (callbacks.onError) {
    peer.on('error', (err) => callbacks.onError(err));
  }

  return {
    peer,
    addLocalStream(localStream) {
      if (!viewerId) {
        throw new Error('No viewer connected; cannot call.');
      }
      // Place a fresh call to the viewer carrying our local stream.
      const call = peer.call(viewerId, localStream);
      // Listen for any stream the viewer might send back (none in v1).
      call.on('stream', (remoteStream) => {
        callbacks.onRemoteStream?.(remoteStream);
      });
      return call;
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
export function connectAsViewer({ hostId, callbacks }) {
  const Peer = requirePeer();
  const peer = new Peer();

  // Open the data channel.
  const connection = peer.connect(hostId);

  connection.on('open', () => {
    callbacks.onConnected?.();
  });
  connection.on('close', () => {
    callbacks.onDisconnected?.();
  });
  connection.on('data', () => {
    // No data-channel protocol in v1.
  });

  // Request the host's stream.
  const mediaCall = peer.call(hostId, null);
  mediaCall.on('stream', (remoteStream) => {
    callbacks.onRemoteStream?.(remoteStream);
  });
  mediaCall.on('close', () => {
    // Don't double-fire: the data channel's close is the source of truth.
  });

  if (callbacks.onError) {
    peer.on('error', (err) => callbacks.onError(err));
  }

  return {
    connection,
    close() {
      try {
        connection.close();
      } catch {
        /* ignore */
      }
      try {
        mediaCall.close();
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
