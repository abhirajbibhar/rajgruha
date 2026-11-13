import { useState } from 'react';
import type { OutlineEntry } from '../lib/pdf/engine';
import { addAfter, canIndent, canOutdent, move, parseChapterList, remove, shift, sortByPage } from '../lib/pdf/outlineOps';

export type Row = OutlineEntry & { id: string };
const uid = () => crypto.randomUUID();
export const withIds = (list: OutlineEntry[]): Row[] => list.map((e) => ('id' in e ? (e as Row) : { ...e, id: uid() }));

/**
 * Edits a PDF's chapter list: rename, set the page, nest, reorder, add, delete — or paste a whole contents
 * list. `onChange` receives the new list; saving it into the file is the caller's job.
 */
export function OutlineEditor({ rows, pageCount, onChange }: { rows: Row[]; pageCount: number; onChange: (rows: Row[]) => void }) {
  const [paste, setPaste] = useState('');
  const [offset, setOffset] = useState(0);
  const set = (next: OutlineEntry[]) => onChange(withIds(next));
  const patch = (i: number, p: Partial<OutlineEntry>) => set(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const clampPage = (n: number) => Math.max(1, Math.min(pageCount, Math.round(n) || 1));

  return (
    <div>
      {rows.length === 0 && (
        <div className="notice warn" style={{ marginBottom: 12 }}>
          This PDF has no chapters (outline) yet. Add them here — or paste a contents list below — and they’ll be saved <strong>inside the PDF file</strong>, so any reader can use them.
        </div>
      )}

      {rows.map((r, i) => (
        <div className="ol-row" key={r.id} style={{ ['--lvl' as string]: r.level }}>
          <div className="t">
            <input className="form-control" style={{ height: 32 }} aria-label={`Chapter ${i + 1} title`} value={r.title} placeholder="Chapter title" onChange={(e) => patch(i, { title: e.target.value })} />
          </div>
          <input className="form-control" style={{ height: 32 }} type="number" min={1} max={pageCount} inputMode="numeric" aria-label={`Chapter ${i + 1} page`} value={r.page}
            onChange={(e) => patch(i, { page: Number(e.target.value) })} onBlur={(e) => patch(i, { page: clampPage(Number(e.target.value)) })} />
          <div className="acts">
            <button type="button" aria-label="Outdent" title="Outdent" disabled={!canOutdent(rows, i)} onClick={() => set(shift(rows, i, -1))}>⇤</button>
            <button type="button" aria-label="Indent" title="Indent (make a sub-chapter)" disabled={!canIndent(rows, i)} onClick={() => set(shift(rows, i, 1))}>⇥</button>
            <button type="button" aria-label="Move up" title="Move up" disabled={move(rows, i, -1) === rows} onClick={() => set(move(rows, i, -1))}>↑</button>
            <button type="button" aria-label="Move down" title="Move down" disabled={move(rows, i, 1) === rows} onClick={() => set(move(rows, i, 1))}>↓</button>
            <button type="button" aria-label="Add chapter after this one" title="Add after" onClick={() => set(addAfter(rows, i, clampPage(r.page)))}>＋</button>
            <button type="button" aria-label="Delete chapter" title="Delete" onClick={() => set(remove(rows, i))}>✕</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => set(addAfter(rows, rows.length - 1, 1))}>＋ Add chapter</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={rows.length < 2} onClick={() => set(sortByPage(rows))}>Sort by page</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => { if (window.confirm('Remove all chapters from this PDF when you save?')) set([]); }}>Remove all</button>
        <span style={{ marginInlineStart: 'auto', alignSelf: 'center', fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} chapter{rows.length === 1 ? '' : 's'} · {pageCount} pages</span>
      </div>

      <details className="card" style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', padding: '10px 14px', fontWeight: 500, fontSize: 13 }}>Paste a contents list</summary>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            One chapter per line, page number last. Indent a line (two spaces or a tab) to make it a sub-chapter. Dot leaders are ignored.
          </p>
          <textarea className="form-control" rows={6} aria-label="Contents list" placeholder={'Foreword ........ 3\nPart One 9\n  The Lantern Keeper ... 11\n  Glass Leaves ... 24'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12.5 }} htmlFor="ol-offset">Page offset</label>
            <input id="ol-offset" className="form-control" style={{ width: 80, height: 32 }} type="number" value={offset} onChange={(e) => setOffset(Number(e.target.value) || 0)} aria-describedby="ol-offset-help" />
            <span id="ol-offset-help" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Printed page 1 is often PDF page 7 → offset 6.</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!paste.trim()} onClick={() => { set(parseChapterList(paste, pageCount, offset)); setPaste(''); }}>Replace chapters</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={!paste.trim()} onClick={() => { set([...rows, ...parseChapterList(paste, pageCount, offset)]); setPaste(''); }}>Append</button>
          </div>
        </div>
      </details>
    </div>
  );
}
