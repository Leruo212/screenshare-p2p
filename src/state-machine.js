// Connection state machine for screenshare-p2p.
//
// States:
//   idle                  — no role yet
//   hosting-waiting       — host created room, waiting for viewer
//   hosting-connected     — viewer joined, host not yet sharing
//   hosting-sharing       — host actively sharing screen
//   viewer-connecting     — viewer dialing host
//   viewer-connected      — viewer connected, waiting for stream
//   viewer-streaming      — viewer receiving stream
//   error                 — recoverable error
//   closed                — terminal, connection ended
//
// All transitions are listed explicitly. An unknown event from a given state
// is a no-op and returns false.

const STATES = {
  IDLE: 'idle',
  HOSTING_WAITING: 'hosting-waiting',
  HOSTING_CONNECTED: 'hosting-connected',
  HOSTING_SHARING: 'hosting-sharing',
  VIEWER_CONNECTING: 'viewer-connecting',
  VIEWER_CONNECTED: 'viewer-connected',
  VIEWER_STREAMING: 'viewer-streaming',
  ERROR: 'error',
  CLOSED: 'closed',
};

const TRANSITIONS = {
  [STATES.IDLE]: {
    'create-room': STATES.HOSTING_WAITING,
    'join-room': STATES.VIEWER_CONNECTING,
    'error': STATES.ERROR,
  },
  [STATES.HOSTING_WAITING]: {
    'viewer-joined': STATES.HOSTING_CONNECTED,
    'disconnect': STATES.IDLE,
    'error': STATES.ERROR,
  },
  [STATES.HOSTING_CONNECTED]: {
    'start-sharing': STATES.HOSTING_SHARING,
    'disconnect': STATES.CLOSED,
    'error': STATES.ERROR,
  },
  [STATES.HOSTING_SHARING]: {
    'stop-sharing': STATES.HOSTING_CONNECTED,
    'disconnect': STATES.CLOSED,
    'error': STATES.ERROR,
  },
  [STATES.VIEWER_CONNECTING]: {
    'viewer-connected-event': STATES.VIEWER_CONNECTED,
    'disconnect': STATES.CLOSED,
    'error': STATES.ERROR,
  },
  [STATES.VIEWER_CONNECTED]: {
    'stream-received': STATES.VIEWER_STREAMING,
    'disconnect': STATES.CLOSED,
    'error': STATES.ERROR,
  },
  [STATES.VIEWER_STREAMING]: {
    'stream-ended': STATES.VIEWER_CONNECTED,
    'disconnect': STATES.CLOSED,
    'error': STATES.ERROR,
  },
  [STATES.ERROR]: {
    // Terminal-ish: nothing transitions out, but we keep it non-stuck
    // for explicit reset by replacing the state machine.
  },
  [STATES.CLOSED]: {
    // Terminal.
  },
};

export function createStateMachine() {
  return {
    state: STATES.IDLE,
    transition(event) {
      const table = TRANSITIONS[this.state];
      if (!table) return false;
      const next = table[event];
      if (!next) return false;
      this.state = next;
      return true;
    },
  };
}

export function canStartSharing(state) {
  return state === STATES.HOSTING_CONNECTED;
}

export function canReceiveStream(state) {
  return state === STATES.VIEWER_CONNECTED;
}

export function isHost(state) {
  return typeof state === 'string' && state.startsWith('hosting-');
}

export function isViewer(state) {
  return typeof state === 'string' && state.startsWith('viewer-');
}

export function isTerminal(state) {
  return state === STATES.CLOSED || state === STATES.ERROR;
}

export function isConnected(state) {
  return (
    state === STATES.HOSTING_CONNECTED ||
    state === STATES.HOSTING_SHARING ||
    state === STATES.VIEWER_CONNECTED ||
    state === STATES.VIEWER_STREAMING
  );
}

// Re-export state constants for downstream modules.
export { STATES };
