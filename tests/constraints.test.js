import { describe, it, expect } from 'vitest';
import {
  buildVideoConstraints,
  buildAudioConstraints,
  buildDisplayMediaConstraints,
  applyEncoderTuning,
  QUALITY_OPTIONS,
} from '../src/constraints.js';

describe('buildVideoConstraints', () => {
  it('defaults to 1080p at 30fps when no quality is given', () => {
    const v = buildVideoConstraints();
    expect(v).toEqual({
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: 30 },
    });
  });

  it('uses max (not ideal) for 1080p — lets the source pass through native', () => {
    const v = buildVideoConstraints('1080p');
    expect(v.width).toEqual({ max: 1920 });
    expect(v.height).toEqual({ max: 1080 });
    // No ideal field — we want the browser to honor the source resolution.
    expect(v.width.ideal).toBeUndefined();
  });

  it('targets 720p ceiling when quality is "720p"', () => {
    const v = buildVideoConstraints('720p');
    expect(v.width).toEqual({ max: 1280 });
    expect(v.height).toEqual({ max: 720 });
    expect(v.frameRate).toEqual({ ideal: 30 });
  });

  it('targets 1440p ceiling when quality is "1440p" (2K native)', () => {
    const v = buildVideoConstraints('1440p');
    expect(v.width).toEqual({ max: 2560 });
    expect(v.height).toEqual({ max: 1440 });
    expect(v.frameRate).toEqual({ ideal: 30 });
  });

  it('omits width/height for "source" quality (browser picks)', () => {
    const v = buildVideoConstraints('source');
    expect(v.width).toBeUndefined();
    expect(v.height).toBeUndefined();
    expect(v.frameRate).toEqual({ ideal: 30 });
  });

  it('falls back to 1080p for unknown quality values', () => {
    const v = buildVideoConstraints('not-a-real-quality');
    expect(v.width).toEqual({ max: 1920 });
    expect(v.height).toEqual({ max: 1080 });
  });

  it('returns a fresh object on each call (not shared mutable state)', () => {
    const a = buildVideoConstraints('720p');
    const b = buildVideoConstraints('720p');
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
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: 30 },
    });
    expect(c.audio.echoCancellation).toBe(false);
    expect(c.audio.sampleRate).toEqual({ ideal: 48000 });
  });

  it('passes quality through to the video constraints', () => {
    const c = buildDisplayMediaConstraints('1440p');
    expect(c.video.width).toEqual({ max: 2560 });
    expect(c.video.height).toEqual({ max: 1440 });
  });
});

describe('applyEncoderTuning', () => {
  it('sets contentHint="text" on a track that exposes the setter', () => {
    // Simulate a real MediaStreamTrack: the setter lives on the prototype.
    const proto = {
      get contentHint() { return this._hint; },
      set contentHint(v) { this._hint = v; },
    };
    const track = Object.create(proto);
    applyEncoderTuning(track);
    expect(track.contentHint).toBe('text');
  });

  it('does not throw on a track whose prototype has no contentHint setter', () => {
    // Simulates a track object lacking the property entirely (e.g. on a
    // very old browser or a test mock). The function should be a no-op.
    const track = Object.create({});
    expect(() => applyEncoderTuning(track)).not.toThrow();
  });

  it('does not throw when called with null/undefined', () => {
    expect(() => applyEncoderTuning(null)).not.toThrow();
    expect(() => applyEncoderTuning(undefined)).not.toThrow();
  });
});

describe('QUALITY_OPTIONS', () => {
  it('exposes a stable list of presets for the UI dropdown', () => {
    expect(QUALITY_OPTIONS.length).toBeGreaterThan(0);
    for (const opt of QUALITY_OPTIONS) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    }
  });

  it('includes 720p, 1080p, 1440p, and source presets', () => {
    const values = QUALITY_OPTIONS.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['720p', '1080p', '1440p', 'source']));
  });
});
