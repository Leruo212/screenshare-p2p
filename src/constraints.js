// Media constraints builders for getDisplayMedia().
//
// Quality presets are a UX shortcut: the user picks a label (e.g. "1080p") and
// we translate it to a constraint that asks the browser to hit a target
// resolution. The browser may downgrade if the user's display or hardware
// can't deliver the target.
//
// IMPORTANT: we use `{ max: ... }`, NOT `{ ideal: ... }`. With `ideal`, the
// browser treats the value as a target and will downscale a higher-resolution
// source to match. With `max`, the browser passes the source through at its
// native resolution, capping at the requested ceiling. For a 2K (2560x1440)
// source shared as "1080p", this means we now ship full 2K frames to the
// viewer instead of pre-downscaling to 1080p — text and UI stay sharp.
//
// The "source" preset omits constraints entirely, which historically lets the
// browser pick (Chrome usually lands on 1080p/30 — known limitation; the 1440p
// preset is the better choice on a 2K display).

const QUALITY_PRESETS = {
  '720p': { width: { max: 1280 }, height: { max: 720 } },
  '1080p': { width: { max: 1920 }, height: { max: 1080 } },
  '1440p': { width: { max: 2560 }, height: { max: 1440 } },
  source: {}, // No ceiling — browser picks (often 1080p on Chrome).
};

export const QUALITY_OPTIONS = [
  { value: '720p', label: '720p（标清，省带宽）' },
  { value: '1080p', label: '1080p（高清，推荐）' },
  { value: '1440p', label: '1440p（2K，原生清晰度）' },
  { value: 'source', label: '原始（不缩放）' },
];

export function buildVideoConstraints(quality = '1080p') {
  const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS['1080p'];
  return {
    ...preset,
    frameRate: { ideal: 30 },
  };
}

export function buildAudioConstraints() {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 2 },
  };
}

export function buildDisplayMediaConstraints(quality = '1080p') {
  return {
    video: buildVideoConstraints(quality),
    audio: buildAudioConstraints(),
  };
}

// Tell the encoder to optimize for text legibility. `contentHint` is a
// standardized hint (Web spec, MediaStreamTrack). Chromium-based browsers
// route the track through a "text" optimization in the encoder, which
// preserves sharp edges on small fonts at the cost of motion smoothness.
// Silently no-op on browsers/versions that don't expose the setter.
export function applyEncoderTuning(track) {
  if (!track) return;
  try {
    // Probe for the property on the instance AND its prototype chain — the
    // setter lives on MediaStreamTrack.prototype, not the track itself.
    // Some implementations expose it read-only or not at all; the try/catch
    // covers both. We can't rely on a setter check because in some
    // environments the property is a plain data accessor.
    let proto = Object.getPrototypeOf(track);
    let found = 'contentHint' in track;
    while (!found && proto) {
      if ('contentHint' in proto) { found = true; break; }
      proto = Object.getPrototypeOf(proto);
    }
    if (found) {
      track.contentHint = 'text';
    }
  } catch {
    /* ignore — encoder hint is best-effort */
  }
}
