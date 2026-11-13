import { describe, expect, it } from 'vitest';
import { cleanPath } from './routes/files';

describe('cleanPath (R2 key sanitiser)', () => {
  it('keeps normal nested paths', () => expect(cleanPath('Fantasy/Le Guin/Book.epub')).toBe('Fantasy/Le Guin/Book.epub'));
  it('drops traversal, dots, empties and backslashes', () => {
    expect(cleanPath('../../etc/passwd.epub')).toBe('etc/passwd.epub');
    expect(cleanPath('a/./b//c.pdf')).toBe('a/b/c.pdf');
    expect(cleanPath('C:\\Users\\me\\x.epub')).toBe('C:/Users/me/x.epub');
    expect(cleanPath('///')).toBe('');
  });
  it('caps absurd lengths', () => expect(cleanPath('a/'.repeat(500)).length).toBeLessThanOrEqual(400));
});
