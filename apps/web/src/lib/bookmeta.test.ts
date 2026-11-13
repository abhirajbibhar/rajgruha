import { describe, expect, it } from 'vitest';
import { guessFromPath, normalizeIsbn, slugify } from './bookmeta';
import { isBookFile, targetPath } from './uploader';
import { addDays, addMonths, fmtBytes, fmtSession, localDay } from './dates';

describe('normalizeIsbn', () => {
  it('accepts valid ISBN-13 and ISBN-10, with hyphens or urn prefix', () => {
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(normalizeIsbn('urn:isbn:9780306406157')).toBe('9780306406157');
    expect(normalizeIsbn('0-306-40615-2')).toBe('0306406152');
    expect(normalizeIsbn('080442957X')).toBe('080442957X');
  });
  it('rejects bad checksums and junk', () => {
    expect(normalizeIsbn('9780306406158')).toBeNull();
    expect(normalizeIsbn('hello')).toBeNull();
    expect(normalizeIsbn('')).toBeNull();
  });
});

describe('file-name helpers', () => {
  it('splits "Author - Title"', () => {
    expect(guessFromPath('Fantasy/Nolan Pierce - Notes on Quiet.pdf')).toEqual({ author: 'Nolan Pierce', title: 'Notes on Quiet' });
  });
  it('falls back to the file name as title', () => {
    expect(guessFromPath('The_Glass_Orchard.epub')).toEqual({ title: 'The Glass Orchard', author: 'Unknown' });
  });
  it('slugifies accents and punctuation', () => {
    expect(slugify('Café: Les Misérables!')).toBe('cafe-les-miserables');
    expect(slugify('???')).toBe('book');
  });
  it('only accepts epub/pdf', () => {
    expect(isBookFile('a/b.EPUB')).toBe(true);
    expect(isBookFile('notes.txt')).toBe(false);
  });
});

describe('targetPath', () => {
  it('joins folder and relative path, stripping traversal and empties', () => {
    expect(targetPath('Fantasy', 'My Books/x.epub')).toBe('Fantasy/My Books/x.epub');
    expect(targetPath('../../etc', '/a//b.pdf')).toBe('etc/a/b.pdf');
    expect(targetPath('', 'x.epub')).toBe('x.epub');
  });
});

describe('dates', () => {
  it('does calendar arithmetic across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('formats', () => {
    expect(localDay(new Date(2026, 10, 7))).toBe('2026-11-07');
    expect(fmtSession(42)).toBe('42s');
    expect(fmtSession(1500)).toBe('25m');
    expect(fmtBytes(1536)).toBe('2 KB');
  });
});
