# screenshare-p2p v2 — Implementation Plan

**Date**: 2026-06-04
**Design**: `docs/2026-06-04-screenshare-p2p-design.md`
**Goal**: TDD-driven implementation, each task 2–5 minutes, end product is a single `screenshare.html` file the user can double-click to use.

## Architecture Decision: Source Modules + Build

The end product MUST be a single HTML file (user requirement: no install, double-click to run). To enable TDD on browser-side JS, we split source into ES modules under `src/`, test them with Vitest, then bundle into `screenshare.html` via a tiny build script.

```
screenshare-p2p/
├── src/                       # source modules (TDD targets)
│   ├── room-id.js             # generateRoomId(), parseRoomId()
│   ├── url.js                 # hash parser / builder
│   ├── state-machine.js       # connection state transitions
│   ├── constraints.js         # media constraints + normalization
│   ├── peer-flow.js           # PeerJS + WebRTC orchestration
│   ├── ui-controller.js       # DOM event handlers + state-to-UI mapping
│   └── app.js                 # entry point, wires everything
├── tests/                     # vitest unit tests
│   ├── room-id.test.js
│   ├── url.test.js
│   ├── state-machine.test.js
│   └── constraints.test.js
├── screenshare.template.html  # HTML skeleton with placeholders
├── build.js                   # tiny Node script: inlines src/*.js + CSS into template
├── package.json               # vitest, devDeps
├── vitest.config.js
├── screenshare.html           # built artifact (gitignored or committed)
├── README.md
└── docs/
```

End-user experience: double-click `screenshare.html`. No server, no build, no install.
Developer experience: `npm test` runs unit tests; `npm run build` produces `screenshare.html`.

## Task List

Each task: write test → watch fail → implement → watch pass → commit. Where TDD is impractical (WebRTC, browser DOM, manual cross-browser), substitute with mocked unit tests + a clearly-marked manual verification step at the end.

### Phase A: Project Skeleton

**Task A1**: Create `package.json` + `vitest.config.js` + directory structure
- Write `package.json` with vitest as devDep
- Write `vitest.config.js` (use `node` env; we'll switch to `jsdom` per-file as needed)
- Create empty `src/`, `tests/` directories
- Verify: `npm install && npm test` runs and exits 0 (zero tests, fine)
- Commit: "chore: project skeleton"

**Task A2**: Write `build.js` (inliner script)
- Write test (vitest) verifying that build.js reads `screenshare.template.html`, inlines all `src/*.js` in order, inlines CSS, writes `screenshare.html`
- Implement build.js
- Verify: `npm run build` produces a valid `screenshare.html` that opens in a browser
- Commit: "feat(build): template inliner"

### Phase B: Pure Logic Modules

**Task B1**: `src/room-id.js` — `generateRoomId()` and `parseRoomId()`
- Test: `generateRoomId()` returns string matching `/^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/`
- Test: `generateRoomId()` produces different values across 1000 calls
- Test: `parseRoomId('abcd-1234-efgh')` returns `{ valid: true, id: 'abcd1234efgh' }`
- Test: `parseRoomId('abc')` returns `{ valid: false, error: '...' }`
- Test: `parseRoomId('abcd-1234-efgh#extra')` returns valid (strips garbage)
- Test: `parseRoomId('')` returns `{ valid: false }`
- Implement using `crypto.getRandomValues`
- Commit: "feat(room-id): generate and parse 12-char room IDs"

**Task B2**: `src/url.js` — `getRoomIdFromHash()` and `buildShareUrl()`
- Test: `getRoomIdFromHash('#abcd-1234-efgh')` returns `'abcd-1234-efgh'`
- Test: `getRoomIdFromHash('')` returns `null`
- Test: `getRoomIdFromHash('#')` returns `null`
- Test: `buildShareUrl('abcd-1234-efgh', 'https://example.com/screenshare.html')` returns `'https://example.com/screenshare.html#abcd-1234-efgh'`
- Test: `buildShareUrl('abcd-1234-efgh', '')` uses `location.href` (mock)
- Implement
- Commit: "feat(url): hash parser and share URL builder"

**Task B3**: `src/state-machine.js` — connection state transitions
- States: `idle`, `hosting`, `hosting-waiting`, `hosting-connected`, `hosting-sharing`, `viewer-connecting`, `viewer-connected`, `viewer-streaming`, `error`, `closed`
- Test: valid transitions accepted (table of `(from, event) → to`)
- Test: invalid transitions rejected (no-op, return false)
- Test: `canStartSharing()` true only in `hosting-connected`
- Test: `canReceiveStream()` true only in `viewer-connected`
- Implement using a transition table
- Commit: "feat(state-machine): connection state transitions"

**Task B4**: `src/constraints.js` — media constraints builder
- Test: `buildVideoConstraints()` returns `{ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }`
- Test: `buildAudioConstraints()` returns system-audio-friendly options (echoCancellation: false, etc.)
- Test: `buildDisplayMediaConstraints()` combines both
- Implement (just constants, mostly)
- Commit: "feat(constraints): media constraints for 1080p + system audio"

### Phase C: Glue Modules (with mocks)

**Task C1**: `src/peer-flow.js` — PeerJS wrapper with mocked PeerJS
- Test: `createHost('room-id', mockPeer)` registers peer with id = 'room-id'
- Test: `createHost` emits 'viewer-connected' when mock peer calls back
- Test: `viewerConnect('room-id', mockPeer)` dials the host
- Test: `attachStream(mockMediaConnection, mockStream)` adds tracks to the RTCPeerConnection
- Test: `onRemoteStream(mockMediaConnection, callback)` registers track listener
- Implement using dependency-injected `Peer` and `MediaStream` constructors (for testability)
- Commit: "feat(peer-flow): PeerJS wrapper with DI for testability"

**Task C2**: `src/ui-controller.js` — DOM event handlers
- Test (jsdom): clicking `#createBtn` calls `onCreateRoom()` and shows `#hostLobby`
- Test (jsdom): clicking `#shareBtn` calls `onStartSharing()`
- Test (jsdom): copy button writes link to clipboard (mock navigator.clipboard)
- Test (jsdom): state changes update status text and dot class correctly
- Implement using event delegation
- Commit: "feat(ui): DOM event handlers and state-to-UI mapping"

### Phase D: Entry Point + HTML/CSS

**Task D1**: `src/app.js` — entry point, wires all modules
- Test (jsdom): on load, if hash has valid room ID, run viewer flow; else show landing
- Test (jsdom): state changes propagate to UI
- Implement
- Commit: "feat(app): wire all modules together"

**Task D2**: Write `screenshare.template.html` with CSS
- HTML skeleton with all elements (status bar, host panel, viewer panel, video area, controls)
- CSS adapted from existing `index.html` (preserve good look, fix issues)
- Element IDs must match what `ui-controller.js` expects
- Verify: template + build produces a valid HTML file
- Commit: "feat(template): HTML and CSS"

**Task D3**: Build end-to-end and verify static analysis
- `npm run build` → `screenshare.html` exists
- Open in browser → landing page shows, no console errors
- Click "Create Room" → URL hash updates, host lobby shows
- Manual smoke test in browser
- Commit: "chore: first build passes smoke test"

### Phase E: Documentation + Manual E2E

**Task E1**: Write `README.md`
- Quick start (open HTML, click create, share link)
- Browser requirements
- Security model (what PeerJS broker sees vs. what it doesn't)
- Troubleshooting (connection fails → VPN workaround)
- Privacy note
- Commit: "docs: README with usage and security notes"

**Task E2**: Manual end-to-end test with two browser windows
- Window 1 (host): create room, start sharing, pick source
- Window 2 (viewer, incognito or different browser): open share link, see screen + hear audio
- Test stop/restart, disconnect, reconnection
- Document any issues found
- Commit: "chore: manual E2E verified"

## Total Tasks: 12

Estimated time: 60–90 minutes of focused work.

## Definition of Done

- [ ] All 12 tasks committed
- [ ] `npm test` shows all tests green
- [ ] `npm run build` produces working `screenshare.html`
- [ ] Manual E2E test in two browser windows passes
- [ ] README documents usage
- [ ] No console errors during normal use
- [ ] Old `index.html` removed (replaced by built `screenshare.html`)

## Execution Mode

After you approve this plan, choose:
- **Subagent-driven**: I dispatch each task to a fresh subagent (implementer → spec reviewer → code-quality reviewer per task)
- **Manual**: You implement task-by-task, I review

I recommend subagent-driven since this is 12 tasks of similar shape; the parallel review loop catches drift.
