import { describe, it, expect } from 'vitest';
import {
  createStateMachine,
  canStartSharing,
  canReceiveStream,
  isHost,
  isViewer,
  isTerminal,
  isConnected,
} from '../src/state-machine.js';

describe('createStateMachine', () => {
  it('starts in idle', () => {
    const sm = createStateMachine();
    expect(sm.state).toBe('idle');
  });

  // host-side transitions
  it('create-room from idle transitions to hosting-waiting', () => {
    const sm = createStateMachine();
    expect(sm.transition('create-room')).toBe(true);
    expect(sm.state).toBe('hosting-waiting');
  });

  it('create-room from hosting-waiting is rejected (returns false, state unchanged)', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    expect(sm.transition('create-room')).toBe(false);
    expect(sm.state).toBe('hosting-waiting');
  });

  it('viewer-joined from hosting-waiting goes to hosting-connected', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    expect(sm.transition('viewer-joined')).toBe(true);
    expect(sm.state).toBe('hosting-connected');
  });

  it('start-sharing from hosting-connected goes to hosting-sharing', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    sm.transition('viewer-joined');
    expect(sm.transition('start-sharing')).toBe(true);
    expect(sm.state).toBe('hosting-sharing');
  });

  it('start-sharing from hosting-waiting is rejected (must wait for viewer)', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    expect(sm.transition('start-sharing')).toBe(false);
    expect(sm.state).toBe('hosting-waiting');
  });

  it('stop-sharing from hosting-sharing goes to hosting-connected', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    sm.transition('viewer-joined');
    sm.transition('start-sharing');
    expect(sm.transition('stop-sharing')).toBe(true);
    expect(sm.state).toBe('hosting-connected');
  });

  // viewer-side transitions
  it('join-room from idle goes to viewer-connecting', () => {
    const sm = createStateMachine();
    expect(sm.transition('join-room')).toBe(true);
    expect(sm.state).toBe('viewer-connecting');
  });

  it('viewer-connected-event from viewer-connecting goes to viewer-connected', () => {
    const sm = createStateMachine();
    sm.transition('join-room');
    expect(sm.transition('viewer-connected-event')).toBe(true);
    expect(sm.state).toBe('viewer-connected');
  });

  it('stream-received from viewer-connected goes to viewer-streaming', () => {
    const sm = createStateMachine();
    sm.transition('join-room');
    sm.transition('viewer-connected-event');
    expect(sm.transition('stream-received')).toBe(true);
    expect(sm.state).toBe('viewer-streaming');
  });

  it('stream-ended from viewer-streaming goes back to viewer-connected', () => {
    const sm = createStateMachine();
    sm.transition('join-room');
    sm.transition('viewer-connected-event');
    sm.transition('stream-received');
    expect(sm.transition('stream-ended')).toBe(true);
    expect(sm.state).toBe('viewer-connected');
  });

  // error transitions
  it('error from any non-terminal state goes to error', () => {
    const nonTerminals = [
      'idle',
      'hosting-waiting',
      'hosting-connected',
      'hosting-sharing',
      'viewer-connecting',
      'viewer-connected',
      'viewer-streaming',
    ];
    for (const start of nonTerminals) {
      const sm = createStateMachine();
      // walk from idle to `start` using valid transitions
      if (start === 'idle') {
        // already there
      } else if (start === 'hosting-waiting') {
        sm.transition('create-room');
      } else if (start === 'hosting-connected') {
        sm.transition('create-room');
        sm.transition('viewer-joined');
      } else if (start === 'hosting-sharing') {
        sm.transition('create-room');
        sm.transition('viewer-joined');
        sm.transition('start-sharing');
      } else if (start === 'viewer-connecting') {
        sm.transition('join-room');
      } else if (start === 'viewer-connected') {
        sm.transition('join-room');
        sm.transition('viewer-connected-event');
      } else if (start === 'viewer-streaming') {
        sm.transition('join-room');
        sm.transition('viewer-connected-event');
        sm.transition('stream-received');
      }
      expect(sm.state).toBe(start);
      expect(sm.transition('error')).toBe(true);
      expect(sm.state).toBe('error');
    }
  });

  it('error from error is rejected', () => {
    const sm = createStateMachine();
    sm.transition('error');
    expect(sm.state).toBe('error');
    expect(sm.transition('error')).toBe(false);
    expect(sm.state).toBe('error');
  });

  // disconnect transitions
  it('disconnect from idle is a no-op (stays idle)', () => {
    const sm = createStateMachine();
    expect(sm.transition('disconnect')).toBe(false);
    expect(sm.state).toBe('idle');
  });

  it('disconnect from hosting-waiting goes back to idle', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    expect(sm.transition('disconnect')).toBe(true);
    expect(sm.state).toBe('idle');
  });

  it('disconnect from hosting-connected goes to closed', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    sm.transition('viewer-joined');
    expect(sm.transition('disconnect')).toBe(true);
    expect(sm.state).toBe('closed');
  });

  it('disconnect from hosting-sharing goes to closed', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    sm.transition('viewer-joined');
    sm.transition('start-sharing');
    expect(sm.transition('disconnect')).toBe(true);
    expect(sm.state).toBe('closed');
  });

  it('disconnect from viewer-connecting goes to closed', () => {
    const sm = createStateMachine();
    sm.transition('join-room');
    expect(sm.transition('disconnect')).toBe(true);
    expect(sm.state).toBe('closed');
  });

  it('disconnect from viewer-connected goes to closed', () => {
    const sm = createStateMachine();
    sm.transition('join-room');
    sm.transition('viewer-connected-event');
    expect(sm.transition('disconnect')).toBe(true);
    expect(sm.state).toBe('closed');
  });

  it('disconnect from viewer-streaming goes to closed', () => {
    const sm = createStateMachine();
    sm.transition('join-room');
    sm.transition('viewer-connected-event');
    sm.transition('stream-received');
    expect(sm.transition('disconnect')).toBe(true);
    expect(sm.state).toBe('closed');
  });

  it('disconnect from closed is rejected', () => {
    const sm = createStateMachine();
    sm.transition('create-room');
    sm.transition('viewer-joined');
    sm.transition('disconnect');
    expect(sm.state).toBe('closed');
    expect(sm.transition('disconnect')).toBe(false);
    expect(sm.state).toBe('closed');
  });
});

describe('canStartSharing', () => {
  it('is true only in hosting-connected', () => {
    expect(canStartSharing('hosting-connected')).toBe(true);
  });
  it('is false in idle', () => {
    expect(canStartSharing('idle')).toBe(false);
  });
  it('is false in hosting-sharing (already sharing)', () => {
    expect(canStartSharing('hosting-sharing')).toBe(false);
  });
});

describe('canReceiveStream', () => {
  it('is true in viewer-connected', () => {
    expect(canReceiveStream('viewer-connected')).toBe(true);
  });
  it('is false in viewer-streaming (already streaming)', () => {
    expect(canReceiveStream('viewer-streaming')).toBe(false);
  });
});

describe('isHost / isViewer / isTerminal / isConnected predicates', () => {
  const allStates = [
    'idle',
    'hosting-waiting',
    'hosting-connected',
    'hosting-sharing',
    'viewer-connecting',
    'viewer-connected',
    'viewer-streaming',
    'error',
    'closed',
  ];

  it('isHost is true for hosting-* states only', () => {
    for (const s of allStates) {
      expect(isHost(s)).toBe(s.startsWith('hosting-'));
    }
  });

  it('isViewer is true for viewer-* states only', () => {
    for (const s of allStates) {
      expect(isViewer(s)).toBe(s.startsWith('viewer-'));
    }
  });

  it('isTerminal is true for error and closed only', () => {
    for (const s of allStates) {
      expect(isTerminal(s)).toBe(s === 'closed' || s === 'error');
    }
  });

  it('isConnected is true for the four active states', () => {
    const connected = new Set([
      'hosting-connected',
      'hosting-sharing',
      'viewer-connected',
      'viewer-streaming',
    ]);
    for (const s of allStates) {
      expect(isConnected(s)).toBe(connected.has(s));
    }
  });
});
