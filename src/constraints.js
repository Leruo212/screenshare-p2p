// Media constraints builders for getDisplayMedia().
// Video: 1080p @ 30fps target (browser falls back gracefully if hardware
// can't deliver).
// Audio: all processing flags OFF, since we capture system audio, not a mic.

export function buildVideoConstraints() {
  return {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
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

export function buildDisplayMediaConstraints() {
  return {
    video: buildVideoConstraints(),
    audio: buildAudioConstraints(),
  };
}
