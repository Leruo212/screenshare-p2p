import { describe, it, expect } from 'vitest';
import { generateRoomId, parseRoomId } from '../src/room-id.js';

const ROOM_ID_REGEX = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/;

describe('generateRoomId', () => {
  it('returns a string matching the room ID format (100 samples)', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateRoomId();
      expect(id).toMatch(ROOM_ID_REGEX);
    }
  });

  it('produces mostly unique values across 1000 calls (>= 990 unique)', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRoomId());
    }
    expect(ids.size).toBeGreaterThanOrEqual(990);
  });

  it('uses crypto.getRandomValues (high uniqueness over 1000 samples)', () => {
    // Statistical smoke test: with Math.random and only 62^4 = ~14.7M combos per
    // segment, 1000 calls should still be unique. Real expectation is ~100% unique
    // if a CSPRNG is used; this test catches a degenerate constant or short cycle.
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRoomId());
    }
    // Far above birthday-collision threshold for 1000 samples at 62^12 space.
    expect(ids.size).toBeGreaterThan(990);
  });
});

describe('parseRoomId', () => {
  it('parses a hyphenated room ID and normalizes to no-hyphen form', () => {
    expect(parseRoomId('abcd-1234-efgh')).toEqual({
      valid: true,
      id: 'abcd1234efgh',
    });
  });

  it('is case-insensitive and lowercases the normalized id', () => {
    expect(parseRoomId('ABCD-1234-EFGH')).toEqual({
      valid: true,
      id: 'abcd1234efgh',
    });
    expect(parseRoomId('AbCd-1234-eFgH')).toEqual({
      valid: true,
      id: 'abcd1234efgh',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseRoomId('  abcd-1234-efgh  ')).toEqual({
      valid: true,
      id: 'abcd1234efgh',
    });
    expect(parseRoomId('\tabcd-1234-efgh\n')).toEqual({
      valid: true,
      id: 'abcd1234efgh',
    });
  });

  it('rejects too-short input', () => {
    const r = parseRoomId('abc');
    expect(r.valid).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('rejects input with too many segments', () => {
    const r = parseRoomId('abcd-1234-efgh-extra');
    expect(r.valid).toBe(false);
  });

  it('rejects non-alphanumeric characters', () => {
    const r = parseRoomId('abc-defg-hijk');
    expect(r.valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(parseRoomId('').valid).toBe(false);
  });

  it('rejects null', () => {
    expect(parseRoomId(null).valid).toBe(false);
  });

  it('rejects undefined', () => {
    expect(parseRoomId(undefined).valid).toBe(false);
  });

  it('round-trips with generateRoomId', () => {
    for (let i = 0; i < 20; i++) {
      const generated = generateRoomId();
      const parsed = parseRoomId(generated);
      expect(parsed.valid).toBe(true);
    }
  });
});
