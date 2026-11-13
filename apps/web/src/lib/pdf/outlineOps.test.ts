import { describe, expect, it } from 'vitest';
import { addAfter, canIndent, move, normalize, outlineToToc, parseChapterList, remove, shift, sortByPage } from './outlineOps';
import type { OutlineEntry } from './engine';

const e = (title: string, level = 0, page = 1): OutlineEntry => ({ title, level, page });
const titles = (l: OutlineEntry[]) => l.map((x) => `${'-'.repeat(x.level)}${x.title}`);
const sample = [e('A'), e('A1', 1), e('A2', 1), e('B'), e('B1', 1)];

describe('outline operations', () => {
  it('normalize clamps skipped levels and the first level', () => {
    expect(normalize([e('x', 3), e('y', 5), e('z', 0)]).map((x) => x.level)).toEqual([0, 1, 0]);
  });
  it('indent moves an item (and its children) one level in, only under a sibling or parent', () => {
    expect(canIndent(sample, 0)).toBe(false);
    expect(titles(shift(sample, 3, 1))).toEqual(['A', '-A1', '-A2', '-B', '--B1']);
    expect(shift(sample, 0, 1)).toBe(sample);
  });
  it('outdent brings the subtree out', () => {
    expect(titles(shift(sample, 1, -1))).toEqual(['A', 'A1', '-A2', 'B', '-B1']);
  });
  it('moves whole blocks past their siblings', () => {
    expect(titles(move(sample, 3, -1))).toEqual(['B', '-B1', 'A', '-A1', '-A2']);
    expect(titles(move(sample, 0, 1))).toEqual(['B', '-B1', 'A', '-A1', '-A2']);
    expect(move(sample, 0, -1)).toBe(sample);
    expect(move(sample, 3, 1)).toBe(sample);
    expect(titles(move(sample, 2, -1))).toEqual(['A', '-A2', '-A1', 'B', '-B1']);
  });
  it('removing a parent re-parents its children instead of losing them', () => {
    expect(titles(remove(sample, 0))).toEqual(['A1', '-A2', 'B', '-B1']);
  });
  it('adds after the subtree at the same level', () => {
    expect(titles(addAfter(sample, 0, 5))).toEqual(['A', '-A1', '-A2', 'New chapter', 'B', '-B1']);
    expect(addAfter([], 0, 4)).toEqual([{ title: 'New chapter', page: 4, level: 0 }]);
  });
  it('sorts top-level blocks by page, keeping children attached', () => {
    const l = [e('late', 0, 9), e('late.1', 1, 10), e('early', 0, 2)];
    expect(titles(sortByPage(l))).toEqual(['early', 'late', '-late.1']);
  });
});

describe('parseChapterList', () => {
  const text = `Foreword ......... 3
Part One 9
  The Lantern Keeper . . . 11
  Glass Leaves — 24
Part Two 40
Index 999`;
  it('reads pages, nesting and dot leaders; clamps to the page count', () => {
    const r = parseChapterList(text, 100);
    expect(r.map((x) => [x.title, x.page, x.level])).toEqual([
      ['Foreword', 3, 0], ['Part One', 9, 0], ['The Lantern Keeper', 11, 1], ['Glass Leaves', 24, 1], ['Part Two', 40, 0], ['Index', 100, 0]
    ]);
  });
  it('applies a page offset (printed vs PDF page numbers)', () => {
    expect(parseChapterList('One 1\nTwo 10', 50, 6).map((x) => x.page)).toEqual([7, 16]);
  });
  it('ignores lines without a page number and blank lines', () => {
    expect(parseChapterList('\nJust words\n\nChapter 4', 10).map((x) => x.title)).toEqual(['Chapter']);
  });
});

describe('outlineToToc', () => {
  it('maps to page: hrefs for the catalog index', () => {
    expect(outlineToToc([e('A', 0, 3), e('', 1, 4)])).toEqual([{ label: 'A', href: 'page:3', level: 0 }, { label: 'Untitled', href: 'page:4', level: 1 }]);
  });
});
