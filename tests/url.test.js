import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRoomIdFromHash, buildShareUrl } from '../src/url.js';

describe('getRoomIdFromHash', () => {
  it('extracts a valid room id from a hash with leading #', () => {
    expect(getRoomIdFromHash('#abcd-1234-efgh')).toBe('abcd1234efgh');
  });

  it('returns null for empty string', () => {
    expect(getRoomIdFromHash('')).toBeNull();
  });

  it('returns null for a bare "#"', () => {
    expect(getRoomIdFromHash('#')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(getRoomIdFromHash('   ')).toBeNull();
  });

  it('accepts a room id without leading #', () => {
    expect(getRoomIdFromHash('abcd-1234-efgh')).toBe('abcd1234efgh');
  });

  it('returns null for an invalid room id with leading #', () => {
    expect(getRoomIdFromHash('#abc')).toBeNull();
  });
});

describe('buildShareUrl', () => {
  const originalLocation = globalThis.location;

  beforeEach(() => {
    // Replace globalThis.location with a mock for the test environment.
    delete globalThis.location;
    globalThis.location = { href: 'http://localhost/' };
  });

  afterEach(() => {
    delete globalThis.location;
    if (originalLocation !== undefined) {
      globalThis.location = originalLocation;
    }
  });

  it('concatenates baseUrl + # + roomId when baseUrl is provided', () => {
    expect(buildShareUrl('abcd1234efgh', 'https://example.com/page.html')).toBe(
      'https://example.com/page.html#abcd1234efgh',
    );
  });

  it('uses hyphenated id as-is (does not add hyphens back)', () => {
    expect(buildShareUrl('abcd-1234-efgh', 'https://example.com/page.html')).toBe(
      'https://example.com/page.html#abcd-1234-efgh',
    );
  });

  it('falls back to globalThis.location.href when baseUrl is empty', () => {
    expect(buildShareUrl('abcd-1234-efgh', '')).toBe('http://localhost/#abcd-1234-efgh');
  });

  it('falls back to globalThis.location.href when baseUrl is missing (undefined)', () => {
    expect(buildShareUrl('abcd-1234-efgh', undefined)).toBe('http://localhost/#abcd-1234-efgh');
  });
});
