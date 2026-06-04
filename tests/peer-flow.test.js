// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHost, connectAsViewer } from '../src/peer-flow.js';

// ---- Mock PeerJS classes ----------------------------------------------------
//
// PeerJS is loaded via <script> tag in the browser, exposing a global `Peer`.
// In tests we inject a mock by assigning `globalThis.Peer = MockPeer`.

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
  // Helper for tests: simulate the 'open' event firing.
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
  }
  connect(remoteId) {
    const conn = new MockDataConnection(remoteId);
    this._dataConnections.push(conn);
    return conn;
  }
  call(remoteId, stream) {
    const mc = new MockMediaConnection(remoteId, stream);
    this._mediaConnections.push(mc);
    return mc;
  }
  destroy() {
    this._destroyed = true;
    // Real PeerJS emits 'disconnected' on broker loss and 'close' on destroy.
    this.emit('disconnected');
    this.emit('close');
  }
}

// ---- Lifecycle: install / uninstall the mock global ------------------------

let createdPeers;
let createdDataConns;
let createdMediaConns;

beforeEach(() => {
  createdPeers = [];
  createdDataConns = [];
  createdMediaConns = [];

  // Wrap the constructor so tests can grab every Peer created.
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

// Helper: fire 'open' on the most-recently-created peer to simulate successful
// registration with the broker.
function fireOpenFor(peer) {
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

  it('fires onViewerConnected when the mock peer emits a "connection" event', () => {
    const onViewerConnected = vi.fn();
    const host = createHost({
      roomId: 'room-1',
      callbacks: { onViewerConnected },
    });
    fireOpenFor(createdPeers[0]);

    // Simulate a viewer dialing in: peer emits 'connection' with a data conn.
    const dataConn = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', dataConn);

    expect(onViewerConnected).toHaveBeenCalledTimes(1);
    expect(onViewerConnected).toHaveBeenCalledWith(expect.any(MockDataConnection));
  });

  it('addLocalStream calls peer.call(viewerId, stream) and stores the call', () => {
    const host = createHost({ roomId: 'room-1', callbacks: {} });
    fireOpenFor(createdPeers[0]);

    // First, simulate a viewer joining so the host has someone to call.
    const dataConn = createdPeers[0].connect('viewer-1');
    createdPeers[0].emit('connection', dataConn);

    const fakeStream = { id: 'stream-1', getTracks: () => [] };
    host.addLocalStream(fakeStream);

    expect(createdPeers[0]._mediaConnections).toHaveLength(1);
    const call = createdPeers[0]._mediaConnections[0];
    expect(call.remoteId).toBe('viewer-1');
    expect(call._stream).toBe(fakeStream);
  });

  it('close() destroys the underlying peer', () => {
    const host = createHost({ roomId: 'room-1', callbacks: {} });
    host.close();
    expect(createdPeers[0]._destroyed).toBe(true);
  });

  it('fires onError when the mock peer emits "error"', () => {
    const onError = vi.fn();
    const host = createHost({
      roomId: 'room-1',
      callbacks: { onError },
    });
    const err = new Error('broker down');
    createdPeers[0].emit('error', err);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('fires onRemoteStream when an incoming MediaConnection emits "stream"', () => {
    const onRemoteStream = vi.fn();
    const host = createHost({
      roomId: 'room-1',
      callbacks: { onRemoteStream },
    });
    fireOpenFor(createdPeers[0]);

    // Host receives an incoming media call (this is the viewer requesting
    // the stream by calling with null).
    const mc = new MockMediaConnection('viewer-1', null);
    createdPeers[0].emit('call', mc);

    // The host module should have registered a 'stream' listener. Fire it.
    const stream = { id: 'remote-stream' };
    mc.emit('stream', stream);

    expect(onRemoteStream).toHaveBeenCalledWith(stream);
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

    // Simulate viewer hanging up.
    dataConn.emit('close');

    expect(onViewerDisconnected).toHaveBeenCalledTimes(1);
  });
});

// ---- connectAsViewer --------------------------------------------------------

describe('connectAsViewer', () => {
  it('creates a Peer (with no preset id) and calls peer.connect(hostId)', () => {
    const viewer = connectAsViewer({ hostId: 'room-1', callbacks: {} });
    expect(createdPeers).toHaveLength(1);
    // Viewer does NOT pre-assign its own ID; the broker assigns one.
    expect(createdPeers[0].id).toBeUndefined();
    expect(createdPeers[0]._dataConnections).toHaveLength(1);
    expect(createdPeers[0]._dataConnections[0].remoteId).toBe('room-1');
    expect(typeof viewer.connection).toBe('object');
  });

  it('fires onConnected when the data connection emits "open"', () => {
    const onConnected = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onConnected } });
    const dataConn = createdPeers[0]._dataConnections[0];
    dataConn.simulateOpen();
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('calls peer.call(hostId, null) to request the stream from the host', () => {
    connectAsViewer({ hostId: 'room-1', callbacks: {} });
    expect(createdPeers[0]._mediaConnections).toHaveLength(1);
    const call = createdPeers[0]._mediaConnections[0];
    expect(call.remoteId).toBe('room-1');
    // PeerJS supports calling with null media to mean "I want to receive".
    expect(call._stream).toBeNull();
  });

  it('fires onRemoteStream when the outgoing MediaConnection emits "stream"', () => {
    const onRemoteStream = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onRemoteStream } });
    const call = createdPeers[0]._mediaConnections[0];
    const stream = { id: 'host-screen' };
    call.emit('stream', stream);
    expect(onRemoteStream).toHaveBeenCalledWith(stream);
  });

  it('fires onDisconnected when the data connection emits "close"', () => {
    const onDisconnected = vi.fn();
    connectAsViewer({ hostId: 'room-1', callbacks: { onDisconnected } });
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
