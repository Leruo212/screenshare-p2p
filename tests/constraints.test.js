import { describe, it, expect } from 'vitest';
import {
  buildVideoConstraints,
  buildAudioConstraints,
  buildDisplayMediaConstraints,
} from '../src/constraints.js';

describe('buildVideoConstraints', () => {
  it('targets 1080p at 30fps', () => {
    const v = buildVideoConstraints();
    expect(v).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
  });

  it('returns a fresh object on each call (not shared mutable state)', () => {
    const a = buildVideoConstraints();
    const b = buildVideoConstraints();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('buildAudioConstraints', () => {
  it('disables all three audio-processing flags (system-audio friendly)', () => {
    const a = buildAudioConstraints();
    expect(a.echoCancellation).toBe(false);
    expect(a.noiseSuppression).toBe(false);
    expect(a.autoGainControl).toBe(false);
  });

  it('requests high-quality audio (48kHz stereo)', () => {
    const a = buildAudioConstraints();
    expect(a.sampleRate).toEqual({ ideal: 48000 });
    expect(a.channelCount).toEqual({ ideal: 2 });
  });
});

describe('buildDisplayMediaConstraints', () => {
  it('combines video and audio constraints under video/audio keys', () => {
    const c = buildDisplayMediaConstraints();
    expect(c).toHaveProperty('video');
    expect(c).toHaveProperty('audio');
    expect(c.video).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
    expect(c.audio.echoCancellation).toBe(false);
    expect(c.audio.sampleRate).toEqual({ ideal: 48000 });
  });
});
