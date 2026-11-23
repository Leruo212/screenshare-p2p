<h1 align="center">ScreenShare P2P</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87-SWITCH-4E9A06?style=flat-square" alt="Switch to Chinese"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/English-CURRENT-1F4E79?style=flat-square" alt="English">
</p>

<p align="center">
  Screen sharing in the browser with no server of your own. Send the link, the other side sees your screen.
</p>

## How it works

1. The sharer opens the page and starts a session. A twelve-character room code is generated.
2. The code is shared out of band, by chat or however you like.
3. The viewer opens the page, enters the code, and receives the stream.
4. Video and system audio travel directly between the two browsers over WebRTC.

The signalling server only brokers the initial handshake. Once the connection is established, no traffic passes through it.

## Browser requirements

Chrome, Edge, or Safari on desktop. The viewer can be on mobile Safari. Sharing requires a browser that supports `getDisplayMedia`, which excludes most mobile browsers as senders.

## Network architecture

```
Sharer  ──(offer / answer via PeerJS broker)──  Viewer
   └──────────  direct WebRTC media  ──────────┘
```

The broker sees connection metadata and nothing else. Media is encrypted in transit with DTLS-SRTP, which WebRTC enforces by default and which the application cannot disable.

## Security model

| Who | What they can see |
|---|---|
| The person you sent the link to | Your shared screen and system audio, after you authorise the capture |
| The PeerJS signalling broker | Your IP address, the room code, and the fact that a peer wants to join that room. **Not the screen data**, and it cannot decrypt it |
| Anyone else | Your twelve-character room code is one of 62¹² ≈ 3×10²¹ combinations. Brute force is not a realistic attack |

Two honest caveats: the room code is the only access control, so anyone who obtains it can view; and the capture permission prompt is browser-enforced, so a malicious page cannot start a share silently.

## Known limitations, v2.1

- One viewer per room. Concurrent multi-viewer support is not implemented.
- No recording. The stream exists only for the duration of the session.
- No TURN server. Symmetric NAT on both ends can prevent a direct connection; this is the most common reason a session fails to establish.
- Audio capture depends on the browser and the operating system, and is unavailable on some Linux configurations.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Stuck at "connecting" | Both peers behind symmetric NAT, no TURN relay available |
| Connected but black screen | Source window closed, or capture stopped by the OS |
| No audio | System audio capture not supported on the sending platform |
| Code rejected | Room expired; start a new session |

## Developer notes

The application is deliberately a single static page plus a small module. There is no build step: the deployment is a copy of the files to any static host.

Redeploying is a matter of uploading the current files to the host root. PeerJS's public broker is used by default; swapping in a self-hosted signalling server requires changing one constant.

## Licence

MIT. See [LICENSE](LICENSE).
