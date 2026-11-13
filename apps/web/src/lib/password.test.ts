import { describe, expect, it } from 'vitest';
import { generatePassword } from './password';

describe('generatePassword', () => {
  it('has the requested length and only unambiguous characters', () => {
    const p = generatePassword(24);
    expect(p).toHaveLength(24);
    expect(p).toMatch(/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });
  it('is long enough for the server policy by default and not repeated', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
    expect([...seen][0]!.length).toBeGreaterThanOrEqual(10);
  });
});
