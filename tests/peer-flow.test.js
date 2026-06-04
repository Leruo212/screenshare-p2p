// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHost, connectAsViewer } from '../src/peer-flow.js';

// ---- Mock PeerJS classes ----------------------------------------------------
//
// PeerJS is loaded via <script> tag in the browser, exposing a global `Peer`.
// In tests we inject a mock by assigning `globalThis.Peer = MockPeer`.
//
// Mock behaviour mirrors the real library:
//   - peer.call(remoteId, null) returns undefined (real PeerJS rejects calls
//     without a local stream).
//   - peer.call(remoteId, stream) returns a MediaConnection when the peer
//     is open.

class MockDataConnection extends EventEmitter {
  constructor(remoteId) {
    super();
    this.remoteId = remoteId;
    this._open = false;
    this.sent = [];
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.emit('close');
  }
  simulateOpen() {
    this._open = true;
    this.emit('open');
  }
}

class MockMediaConnection extends EventEmitter {
  constructor(remoteId, stream) {
    super();
    this.remoteId = remoteId;
    this._stream = stream;
    this.answeredWith = undefined;
  }
  answer(stream) {
    this.answeredWith = stream;
  }
  close() {
    this.emit('close');
  }
}

class MockPeer extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this._destroyed = false;
    this._dataConnections = [];
    this._mediaConnections = [];
    // Mirrors PeerJS's `_disconnected` flag. After 'open' fires, real PeerJS
    // sets this to false and the peer is ready to make calls.
    this._disconnected = true;
  }
  connect(remoteId) {
    const conn = new MockDataConnection(remoteId);
    this._dataConnections.push(conn);
    return conn;
  }
  call(remoteId, stream) {
    // Real PeerJS 1.5.5 source: `if (!stream) return;` — calls without a
    // local stream return undefined. The mock matches that.
    if (!stream) return undefined;
    if (this._disconnected) return undefined;
    const mc = new MockMediaConnection(remoteId, stream);
    this._mediaConnections.push(mc);
    return mc;
  }
  destroy() {
    this._destroyed = true;
    this.emit('disconnected');
    this.emit('close');
  }
}

// ---- Lifecycle: install / uninstall the mock global ------------------------

let createdPeers;

beforeEach(() => {
  createdPeers = [];

  const TrackedPeer = function (id) {
    const p = new MockPeer(id);
    createdPeers.push(p);
    return p;
  };
  TrackedPeer.prototype = MockPeer.prototype;
  globalThis.Peer = TrackedPeer;
});

afterEach(() => {
  delete globalThis.Peer;
});

function fireOpenFor(peer) {
  peer._disconnected = false;
  peer.emit('open');
}

// ---- createHost -------------------------------------------------------------

describe('createHost', () => {
  it('creates a new Peer with the given room ID', () => {
    const host = createHost({ roomId: 'abc-def-ghi', callbacks: {} });
    expect(createdPeers).toHaveLength(1);
    expect(createdPeers[0].id).toBe('abc-def-ghi');
    expect(typeof host.peer).toBe('object');
  });

  it('fires onViewerConnected when the data connection arrives', () => {
    const onViewerConnected = vi.fn();
    createHost({
      roomId: 'room-1',
      callbacks: { onViewerConnected },
    });
    fireOpenFor(createdPeers[0]);

    const dataConn = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', dataConn);

    expect(onViewerConnected).toHaveBeenCalledTimes(1);
  });

  it('addLocalStream calls peer.call(viewerId, stream) when viewer is already connected', () => {
    const host = createHost({ roomId: 'room-1', callbacks: {} });
    fireOpenFor(createdPeers[0]);

    // Viewer joins first.
    const dataConn = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', dataConn);

    // Host picks a screen source.
    const fakeStream = { id: 'screen-1', getTracks: () => [] };
    host.addLocalStream(fakeStream);

    // Host should have created an OUTGOING call to the viewer with the stream.
    expect(createdPeers[0]._mediaConnections).toHaveLength(1);
    const outgoingCall = createdPeers[0]._mediaConnections[0];
    expect(outgoingCall.remoteId).toBe('viewer-1');
    expect(outgoingCall._stream).toBe(fakeStream);
  });

  it('addLocalStream buffers the stream and pushes it when viewer joins later', () => {
    const host = createHost({ roomId: 'room-1', callbacks: {} });
    fireOpenFor(createdPeers[0]);

    // Host picks a source BEFORE the viewer joins.
    const fakeStream = { id: 'screen-1', getTracks: () => [] };
    host.addLocalStream(fakeStream);

    expect(createdPeers[0]._mediaConnections).toHaveLength(0);

    // Now the viewer joins — host should push the stream.
    const dataConn = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', dataConn);

    expect(createdPeers[0]._mediaConnections).toHaveLength(1);
    expect(createdPeers[0]._mediaConnections[0]._stream).toBe(fakeStream);
  });

  it('close() destroys the underlying peer', () => {
    const host = createHost({ roomId: 'room-1', callbacks: {} });
    host.close();
    expect(createdPeers[0]._destroyed).toBe(true);
  });

  it('fires onError when the mock peer emits "error"', () => {
    const onError = vi.fn();
    createHost({
      roomId: 'room-1',
      callbacks: { onError },
    });
    const err = new Error('broker down');
    createdPeers[0].emit('error', err);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('fires onViewerDisconnected when the stored data connection emits "close"', () => {
    const onViewerDisconnected = vi.fn();
    const host = createHost({
      roomId: 'room-1',
      callbacks: { onViewerDisconnected },
    });
    fireOpenFor(createdPeers[0]);

    const dataConn = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', dataConn);

    dataConn.emit('close');

    expect(onViewerDisconnected).toHaveBeenCalledTimes(1);
  });
});

// ---- connectAsViewer --------------------------------------------------------

describe('connectAsViewer', () => {
  it('creates a Peer (with no preset id) and calls peer.connect(hostId) once open', () => {
    const viewer = connectAsViewer({ hostId: 'room-1', callbacks: {} });
    fireOpenFor(createdPeers[0]);
    expect(createdPeers).toHaveLength(1);
    expect(createdPeers[0].id).toBeUndefined();
    expect(createdPeers[0]._dataConnections).toHaveLength(1);
    expect(createdPeers[0]._dataConnections[0].remoteId).toBe('room-1');
    expect(typeof viewer.connection).toBe('object');
  });

  it('fires onConnected when the data connection emits "open"', () => {
    const onConnected = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onConnected } });
    fireOpenFor(createdPeers[0]);
    const dataConn = createdPeers[0]._dataConnections[0];
    dataConn.simulateOpen();
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('does NOT make an outgoing media call (host will call us)', () => {
    // In PeerJS 1.5.5, peer.call(remoteId, null) returns undefined because the
    // library rejects calls without a stream. The viewer has no stream to
    // send, so we don't call — we listen for the host to call us.
    connectAsViewer({ hostId: 'room-1', callbacks: {} });
    fireOpenFor(createdPeers[0]);
    expect(createdPeers[0]._mediaConnections).toHaveLength(0);
  });

  it('answers an incoming media call from the host and fires onRemoteStream', () => {
    const onRemoteStream = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onRemoteStream } });
    fireOpenFor(createdPeers[0]);

    // Simulate the host calling us with a screen stream.
    const incoming = new MockMediaConnection('room-1', { id: 'screen-1' });
    createdPeers[0].emit('call', incoming);

    // Viewer should have called mc.answer() with no stream (we have nothing to send).
    expect(incoming.answeredWith).toBeUndefined();

    // When the host's stream arrives, fire onRemoteStream.
    const stream = { id: 'host-screen' };
    incoming.emit('stream', stream);
    expect(onRemoteStream).toHaveBeenCalledWith(stream);
  });

  it('fires onDisconnected when the data connection emits "close"', () => {
    const onDisconnected = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onDisconnected } });
    fireOpenFor(createdPeers[0]);
    const dataConn = createdPeers[0]._dataConnections[0];
    dataConn.emit('close');
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('fires onError when the peer emits "error"', () => {
    const onError = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onError } });
    const err = new Error('network');
    createdPeers[0].emit('error', err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('close() destroys the underlying peer', () => {
    const viewer = connectAsViewer({ hostId: 'room-1', callbacks: {} });
    viewer.close();
    expect(createdPeers[0]._destroyed).toBe(true);
  });
});
