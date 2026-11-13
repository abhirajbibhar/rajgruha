import type { TocItem } from '@rajgruha/shared';
import type { OutlineEntry } from './engine';

/** Editing operations on the flat, levelled chapter list. All are pure and return a new array. */

/** Enforce the tree invariant: the first item is level 0 and no item is more than one level below its predecessor. */
export function normalize(list: OutlineEntry[]): OutlineEntry[] {
  let prev = -1;
  return list.map((e) => {
    const level = Math.max(0, Math.min(e.level, prev + 1));
    prev = level;
    return level === e.level ? e : { ...e, level };
  });
}

/** Index one past the last descendant of item `i`. */
const blockEnd = (list: OutlineEntry[], i: number) => {
  let j = i + 1;
  while (j < list.length && list[j]!.level > list[i]!.level) j++;
  return j;
};

export const canIndent = (list: OutlineEntry[], i: number) => i > 0 && list[i]!.level <= list[i - 1]!.level;
export const canOutdent = (list: OutlineEntry[], i: number) => list[i]!.level > 0;

/** Indent/outdent an item together with its children. */
export function shift(list: OutlineEntry[], i: number, delta: 1 | -1): OutlineEntry[] {
  if (delta === 1 ? !canIndent(list, i) : !canOutdent(list, i)) return list;
  const end = blockEnd(list, i);
  return normalize(list.map((e, k) => (k >= i && k < end ? { ...e, level: e.level + delta } : e)));
}

/** Move an item (with its children) past its previous/next sibling. */
export function move(list: OutlineEntry[], i: number, dir: -1 | 1): OutlineEntry[] {
  const level = list[i]!.level;
  const end = blockEnd(list, i);
  if (dir === -1) {
    let k = i - 1;
    while (k >= 0 && list[k]!.level > level) k--;
    if (k < 0 || list[k]!.level !== level) return list; // no previous sibling
    return [...list.slice(0, k), ...list.slice(i, end), ...list.slice(k, i), ...list.slice(end)];
  }
  if (end >= list.length || list[end]!.level !== level) return list; // no next sibling
  const end2 = blockEnd(list, end);
  return [...list.slice(0, i), ...list.slice(end, end2), ...list.slice(i, end), ...list.slice(end2)];
}

/** Remove one chapter; its children stay and are re-parented by normalize(). */
export const remove = (list: OutlineEntry[], i: number) => normalize(list.filter((_, k) => k !== i));

/** Insert a new chapter after item `i` (after its subtree), at the same level. */
export function addAfter(list: OutlineEntry[], i: number, page: number): OutlineEntry[] {
  if (!list.length) return [{ title: 'New chapter', page, level: 0 }];
  const at = blockEnd(list, i);
  const out = [...list];
  out.splice(at, 0, { title: 'New chapter', page, level: list[i]!.level });
  return out;
}

export const sortByPage = (list: OutlineEntry[]): OutlineEntry[] => {
  // Stable sort of top-level blocks only, so nesting is preserved.
  const blocks: OutlineEntry[][] = [];
  for (let i = 0; i < list.length; ) {
    const end = list[i]!.level === 0 ? blockEnd(list, i) : i + 1;
    blocks.push(list.slice(i, end));
    i = end;
  }
  return blocks.map((b, idx) => ({ b, idx })).sort((x, y) => x.b[0]!.page - y.b[0]!.page || x.idx - y.idx).flatMap((x) => x.b);
};

/**
 * Turn a pasted contents list into chapters. One chapter per line; the trailing number is the page;
 * leading indentation (tab or 2+ spaces) means a sub-chapter; dot leaders (“Intro ….. 7”) are ignored.
 * `offset` shifts every page (printed page numbers rarely match PDF page numbers).
 */
export function parseChapterList(text: string, pageCount: number, offset = 0): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const indents: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = /^(\s*)(.*?)[\s.·…_\-–—]*?(\d{1,5})\s*$/.exec(raw.replace(/\t/g, '    '));
    if (!m || !m[2]!.trim()) continue;
    const width = m[1]!.length;
    while (indents.length && indents[indents.length - 1]! > width) indents.pop();
    if (!indents.length || indents[indents.length - 1]! < width) indents.push(width);
    const level = indents.length - 1;
    out.push({ title: m[2]!.trim(), page: Math.max(1, Math.min(pageCount, Number(m[3]) + offset)), level });
  }
  return normalize(out);
}

// ── Mirror of the chapters in the catalog index (books.toc) ─────────────
export const PAGE_HREF = /^page:(\d+)$/;
export const pageHref = (page: number) => `page:${page}`;

export const outlineToToc = (outline: OutlineEntry[]): TocItem[] =>
  outline.map((o) => ({ label: o.title || 'Untitled', href: pageHref(o.page), level: Math.min(6, o.level) }));
