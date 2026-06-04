// URL hash parser and share URL builder.
// The hash is the natural place for the room ID: it isn't sent to any server,
// works with file://, and survives page reloads.

import { parseRoomId } from './room-id.js';

function normalizeHash(hash) {
  if (typeof hash !== 'string') return null;
  let h = hash.trim();
  if (h.length === 0) return null;
  if (h.startsWith('#')) h = h.slice(1);
  if (h.trim().length === 0) return null;
  return h;
}

export function getRoomIdFromHash(hash) {
  const stripped = normalizeHash(hash);
  if (stripped === null) return null;
  const parsed = parseRoomId(stripped);
  return parsed.valid ? parsed.id : null;
}

export function buildShareUrl(roomId, baseUrl) {
  const base = baseUrl || (globalThis.location && globalThis.location.href) || '';
  // Strip any trailing hash from the base URL so we always end with a single '#'.
  const cleanBase = base.endsWith('#') ? base.slice(0, -1) : base;
  return `${cleanBase}#${roomId}`;
}
