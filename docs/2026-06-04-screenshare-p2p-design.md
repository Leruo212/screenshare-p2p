# screenshare-p2p v2 — Design

**Date**: 2026-06-04
**Status**: ✅ Approved (2026-06-04)
**Goal**: Friend joins your screen share by clicking a link. No cloud server on your side. No install for friend. Private, simple.

**Locked decisions**:
- File: replace `index.html` with `screenshare.html`
- Browser support: Chromium 100+ and Firefox 100+ (no Safari)
- NAT: STUN only in v1; TURN config slot reserved in code for future
- No remote control, no mic voice, no PIN, no extra features

---

## Problem

Current `index.html` requires manually copying/pasting SDP blobs between two browsers. Painful, error-prone, not usable for non-technical friends.

The user wants: I open a webpage, click "start", get a link, send it to a friend. Friend clicks the link, sees my screen + hears my system audio. Quality ≥ 1080p.

Constraints (from user):
- No cloud server on our side
- Friend must not install anything
- Friend is not technical
- User has no public IP
- Used privately (small group of friends), security still matters
- Source/fullscreen/window/tab picker should be available
- Voice (mic) NOT required; system audio IS required

## Approach

**Single static HTML file + PeerJS (public broker) + WebRTC P2P media.**

| Layer | Tech | Why |
|---|---|---|
| UI | Single `screenshare.html` | No build step, no install, double-click to run, works from `file://` |
| Signaling | PeerJS client → `broker.peerjs.com` | Free, public, only sees handshake metadata; can't decrypt media |
| Media | WebRTC P2P (DTLS-SRTP) | End-to-end encrypted, direct peer-to-peer stream |
| Capture | `navigator.mediaDevices.getDisplayMedia` | Native browser picker for fullscreen/window/tab, with system audio |
| Room identity | 12-char random ID in URL hash | Acts as implicit password; unguessable; works with `file://` |

**Why PeerJS over alternatives**:
- Tailscale: requires friend to install → rejected by user
- Port forwarding: requires public IP + router config → user has neither
- Cloudflare Tunnel: works but adds `cloudflared` dependency + .trycloudflare.com domain → extra setup
- Self-hosted Node server: requires `node` runtime on host's machine + tunnel to expose it
- PeerJS: zero install, zero config, works in any modern browser

**Security model** (addressing user's earlier concern):
- PeerJS broker sees: peer IDs, public IPs, room IDs. Cannot decrypt WebRTC streams.
- WebRTC carries actual screen frames + audio over an encrypted DTLS-SRTP session. Peer-to-peer. No relay.
- 12-char random room ID = 62^12 ≈ 3×10^21 combinations. Effectively unguessable.
- Threat model: someone scanning broker can't find a room. Someone you share the link with can connect and see what you share (this is intended).
- Out of scope: fingerprint verification via out-of-band channel. Mention in README as future hardening.

## UX Flows

### Host flow (you, the sharer)

1. Double-click `screenshare.html` (or open via local web server).
2. Page shows: `Create Room` and `Join Room` buttons.
3. Click `Create Room` → page generates 12-char room ID, e.g. `xK9m-Pq7v-Rt3w`.
4. Page transitions to "Host Lobby":
   - Big share link: `screenshare.html#xK9m-Pq7v-Rt3w` with `Copy` and `Show QR` buttons.
   - Status: "Waiting for viewer..."
   - "Start Sharing" button (disabled until viewer connects).
5. Friend connects → status changes to "Viewer connected", "Start Sharing" enabled.
6. Click `Start Sharing` → browser shows native picker (fullscreen/window/tab) + audio checkbox.
7. Pick source → local preview appears in host's page (sanity check).
8. Viewer sees the same preview in their page.
9. Click `Stop Sharing` to end. Closing the browser tab also stops it.

### Viewer flow (your friend)

1. Click the link in WeChat/QQ/email.
2. Browser opens `screenshare.html#xK9m-Pq7v-Rt3w`.
3. Page detects room ID in hash, shows "Connecting to host..." with spinner.
4. WebRTC handshake via PeerJS broker (~1-3 seconds).
5. Page shows "Connected. Waiting for host to start sharing..."
6. Host starts → video element lights up with screen, audio plays.
7. Fullscreen button on the video; volume slider.
8. Host stops → page shows "Host stopped sharing" and a `Reconnect` button.

## File Structure

```
screenshare-p2p/
├── screenshare.html         # v2: the whole app (replaces index.html)
├── README.md                # User guide: how to host, how to share
├── docs/
│   └── 2026-06-04-screenshare-p2p-design.md  # this file
└── .gitignore
```

Single-file architecture chosen for: (a) zero install, (b) works from `file://`, (c) easy to share, (d) no build step. PeerJS loaded from CDN with SRI hash for integrity.

## Technical Details

### Room ID Generation
- 12 chars from `[a-zA-Z0-9]` (62 chars), with hyphens for readability: `xxxx-xxxx-xxxx`.
- Generated via `crypto.getRandomValues` (Web Crypto API).
- Stored in URL hash (`#xxxx-xxxx-xxxx`), not query — hash isn't sent to any server, works with `file://` protocol.

### PeerJS Setup
- Use default `broker.peerjs.com` (HTTPS, port 443, free public broker).
- Host registers peer ID = room ID with `new Peer(roomId)`.
- Viewer dials host with `peer.connect(roomId)`.
- On connect, both sides open a `RTCPeerConnection` via PeerJS's `MediaConnection`.

### Media Capture
```js
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    width:  { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  },
  audio: {
    echoCancellation: false,   // system audio, not mic
    noiseSuppression: false,
    autoGainControl:  false
  }
});
```

- 1080p / 30fps target. Falls back gracefully if hardware can't deliver.
- `audio: true` includes system audio if user checks "Share tab audio" in the picker.
- Audio constraints match system audio (no echo cancellation, etc.) — preserves quality.

### Connection State Machine
- States: `disconnected`, `connecting`, `connected`, `streaming`, `closed`.
- UI shows current state, transitions animate (no flashing).
- On `iceconnectionstatechange === 'failed'`: try ICE restart once; on second failure, surface error.

### Reconnection
- PeerJS has built-in reconnect on transient network blips.
- If host disconnects, viewer page shows "Reconnecting..." with 30s timeout, then "Connection lost" with `Try Again` button.
- If viewer disconnects, host shows "Viewer left" toast; if they come back (same room ID), auto-reconnect.

## Out of Scope (v1)

- Voice chat (microphone)
- Text chat
- File transfer
- Multiple hosts (multi-party video conference)
- Remote control (mouse/keyboard forwarding)
- TURN server — PeerJS free broker doesn't include TURN; if both peers are behind symmetric NAT, may fail. Fallback: document VPN workaround in README.
- Mobile host (iOS Safari has limited getDisplayMedia)
- Fingerprint verification (out-of-band security check) — mentioned in README as future hardening

## Acceptance Criteria

- [ ] Host opens file in Chrome/Edge/Firefox, clicks "Create Room" in ≤3 clicks
- [ ] Share link is generated and copyable
- [ ] Friend clicks link in fresh browser (no install), connects in ≤5s
- [ ] Fullscreen/window/tab picker appears, all 3 options work
- [ ] System audio captured and plays in viewer's browser
- [ ] Video resolution ≥ 1080p when source supports it
- [ ] Stop/restart works without page reload
- [ ] Disconnection detected within 10s, both sides see status
- [ ] Reconnection works after network blip
- [ ] Works from `file://` (no web server required)
- [ ] No external service used except PeerJS public broker (only sees handshake metadata)
- [ ] No console errors during normal use
- [ ] README explains how to use, how to share, browser requirements, security model

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Symmetric NAT blocks P2P (no TURN) | Document VPN workaround in README. Add TURN config field for advanced users. |
| Browser blocks getDisplayMedia on `file://` | Test in Chrome 100+; document if it doesn't work, suggest local web server. |
| PeerJS public broker goes down | Add comment in code for self-hosting PeerJS server. Document in README. |
| Friend clicks wrong link / old link | Room IDs are 12 chars and not enumerable; old links just won't connect. |
| Host shares sensitive content by accident | Host can click "Stop Sharing" or close picker. Default to "what you share is on you" — this is a personal tool, not enterprise. |

## Open Questions for Reviewer

1. ~~Network scenario?~~ → Different networks, no public IP, no install
2. ~~Auth?~~ → 12-char random room ID (no PIN)
3. ~~Extra features?~~ → Just fullscreen/window/tab picker; no remote control, no voice chat
4. **File location**: design doc inside `screenshare-p2p/docs/`. OK?
5. **Replace or coexist with `index.html`?**: My recommendation is to replace `index.html` with `screenshare.html` (v2). Old `index.html` is the broken copy-paste version. Want to keep it for reference?
6. **Browser support floor**: Chrome 100+/Edge 100+/Firefox 100+/Safari 16+. Acceptable for a personal tool?

## Next Step

After approval → write implementation plan (`docs/plans/2026-06-04-screenshare-p2p.md`) with TDD task breakdown, then implement task-by-task with subagent dispatch.
