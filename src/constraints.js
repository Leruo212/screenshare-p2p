// Media constraints builders for getDisplayMedia().
//
// Quality presets are a UX shortcut: the user picks a label (e.g. "1080p") and
// we translate it to a constraint that asks the browser to hit a target
// resolution. The browser may downgrade if the user's display or hardware
// can't deliver the target.

const QUALITY_PRESETS = {
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
  '1440p': { width: { ideal: 2560 }, height: { ideal: 1440 } },
  source: {}, // No resolution cap — let the source dictate.
};

export const QUALITY_OPTIONS = [
  { value: '720p', label: '720p（标清，省带宽）' },
  { value: '1080p', label: '1080p（高清，推荐）' },
  { value: '1440p', label: '1440p（2K）' },
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
