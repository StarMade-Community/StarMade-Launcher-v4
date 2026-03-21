import { describe, expect, it } from 'vitest';
import { formatPlayTime } from '../../utils/formatPlayTime';

describe('formatPlayTime', () => {
  it('returns 0m for zero or invalid values', () => {
    expect(formatPlayTime(0)).toBe('0m');
    expect(formatPlayTime(Number.NaN)).toBe('0m');
    expect(formatPlayTime(-1)).toBe('0m');
  });

  it('formats minute-only values', () => {
    expect(formatPlayTime(59 * 60_000)).toBe('59m');
  });

  it('formats hour and minute values', () => {
    expect(formatPlayTime(60 * 60_000)).toBe('1h');
    expect(formatPlayTime((2 * 60 + 5) * 60_000)).toBe('2h 5m');
  });
});

