// Room ID generation and parsing.
// IDs are 12 alphanumeric chars (62-char alphabet), displayed as 4-4-4 hyphenated.
// Total space: 62^12 ≈ 3e21, effectively unguessable.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SEGMENT_LEN = 4;
const SEGMENT_COUNT = 3;

function randomSegment(bytesNeeded) {
  const bytes = new Uint8Array(bytesNeeded);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < SEGMENT_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateRoomId() {
  const segments = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    segments.push(randomSegment(SEGMENT_LEN));
  }
  return segments.join('-');
}

const ROOM_ID_REGEX = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/;

export function parseRoomId(input) {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Room ID must be a string' };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Room ID is empty' };
  }
  if (!ROOM_ID_REGEX.test(trimmed)) {
    return { valid: false, error: 'Room ID must be 4-4-4 alphanumeric characters' };
  }
  return { valid: true, id: trimmed.toLowerCase().replace(/-/g, '') };
}
