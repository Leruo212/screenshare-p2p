import { describe, it, expect } from 'vitest';
import {
  buildVideoConstraints,
  buildAudioConstraints,
  buildDisplayMediaConstraints,
  QUALITY_OPTIONS,
} from '../src/constraints.js';

describe('buildVideoConstraints', () => {
  it('defaults to 1080p at 30fps when no quality is given', () => {
    const v = buildVideoConstraints();
    expect(v).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
  });

  it('targets 720p when quality is "720p"', () => {
    const v = buildVideoConstraints('720p');
    expect(v.width).toEqual({ ideal: 1280 });
    expect(v.height).toEqual({ ideal: 720 });
    expect(v.frameRate).toEqual({ ideal: 30 });
  });

  it('targets 1440p when quality is "1440p"', () => {
    const v = buildVideoConstraints('1440p');
    expect(v.width).toEqual({ ideal: 2560 });
    expect(v.height).toEqual({ ideal: 1440 });
    expect(v.frameRate).toEqual({ ideal: 30 });
  });

  it('omits width/height for "source" quality (no downscale)', () => {
    const v = buildVideoConstraints('source');
    expect(v.width).toBeUndefined();
    expect(v.height).toBeUndefined();
    expect(v.frameRate).toEqual({ ideal: 30 });
  });

  it('falls back to 1080p for unknown quality values', () => {
    const v = buildVideoConstraints('not-a-real-quality');
    expect(v.width).toEqual({ ideal: 1920 });
    expect(v.height).toEqual({ ideal: 1080 });
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
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
    expect(c.audio.echoCancellation).toBe(false);
    expect(c.audio.sampleRate).toEqual({ ideal: 48000 });
  });

  it('passes quality through to the video constraints', () => {
    const c = buildDisplayMediaConstraints('720p');
    expect(c.video.width).toEqual({ ideal: 1280 });
    expect(c.video.height).toEqual({ ideal: 720 });
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
