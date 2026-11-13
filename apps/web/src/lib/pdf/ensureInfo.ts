/**
 * PDFium (and so EmbedPDF) can only edit document metadata when the file already has an /Info
 * dictionary referenced from its trailer: on a file without one the edit is accepted but never written.
 * This adds an empty one with a standard PDF *incremental update* (the original bytes are untouched),
 * for both classic xref tables and xref streams. If the file's structure isn't one we understand we
 * return it unchanged; callers verify the saved file anyway.
 */
const dec = new TextDecoder('latin1'); // one char per byte, so string offsets == byte offsets
const enc = new TextEncoder();

export type EnsureInfoResult = { bytes: Uint8Array; hadInfo: boolean; added: boolean; reason?: string };

const unchanged = (bytes: Uint8Array, reason: string, hadInfo = false): EnsureInfoResult => ({ bytes, hadInfo, added: false, reason });

/** Index just past the `>>` that closes the dictionary opened at `start` (which points at `<<`). */
function dictEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '<' && s[i + 1] === '<') { depth++; i++; }
    else if (s[i] === '>' && s[i + 1] === '>') { depth--; i++; if (depth === 0) return i + 1; }
  }
  return -1;
}

export function ensureInfoDictionary(input: Uint8Array): EnsureInfoResult {
  const n = input.length;
  const tail = dec.decode(input.subarray(Math.max(0, n - 2048)));
  const sx = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!sx) return unchanged(input, 'no startxref');
  const prev = Number(sx[1]);
  if (!(prev > 0 && prev < n)) return unchanged(input, 'bad startxref');

  // The latest trailer: a classic `trailer << … >>`, or the dictionary of an xref stream object.
  const head = dec.decode(input.subarray(prev, Math.min(n, prev + 4 * 1024 * 1024)));
  let trailer: string;
  let isStream: boolean;
  if (/^\s*xref\b/.test(head)) {
    const t = head.indexOf('trailer');
    if (t < 0) return unchanged(input, 'no trailer');
    const open = head.indexOf('<<', t);
    const close = open < 0 ? -1 : dictEnd(head, open);
    if (close < 0) return unchanged(input, 'unreadable trailer');
    trailer = head.slice(open, close);
    isStream = false;
  } else if (/^\s*\d+\s+\d+\s+obj\b/.test(head)) {
    const open = head.indexOf('<<');
    const close = open < 0 ? -1 : dictEnd(head, open);
    if (close < 0 || !/\/Type\s*\/XRef/.test(head.slice(open, close))) return unchanged(input, 'unreadable xref stream');
    trailer = head.slice(open, close);
    isStream = true;
  } else {
    return unchanged(input, 'unknown xref layout');
  }

  if (/\/Info\s+\d+\s+\d+\s+R/.test(trailer)) return { bytes: input, hadInfo: true, added: false };
  if (/\/Encrypt\b/.test(trailer)) return unchanged(input, 'encrypted');
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1]);
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trailer);
  if (!size || !root) return unchanged(input, 'trailer missing Size/Root');
  const id = /\/ID\s*(\[[^\]]*\])/.exec(trailer)?.[1];

  const num = size; // first unused object number
  const sep = input[n - 1] === 0x0a || input[n - 1] === 0x0d ? '' : '\n';
  const infoObj = `${num} 0 obj\n<< /Producer (Rajgruha) >>\nendobj\n`;
  const infoOffset = n + sep.length;
  const pad10 = (v: number) => String(v).padStart(10, '0');
  const common = `/Root ${root[1]} ${root[2]} R /Info ${num} 0 R /Prev ${prev}${id ? ` /ID ${id}` : ''}`;
  const parts: Uint8Array[] = [input];

  if (!isStream) {
    const xrefOffset = infoOffset + infoObj.length;
    parts.push(enc.encode(
      `${sep}${infoObj}xref\n${num} 1\n${pad10(infoOffset)} 00000 n \ntrailer\n<< /Size ${num + 1} ${common} >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    ));
  } else {
    // New xref *stream* (a classic table can't follow an xref stream): entries are [type=1, offset(4), gen(2)].
    const streamObjNum = num + 1;
    const streamOffset = infoOffset + infoObj.length;
    const entry = (off: number) => [1, (off >>> 24) & 255, (off >>> 16) & 255, (off >>> 8) & 255, off & 255, 0, 0];
    const data = Uint8Array.from([...entry(infoOffset), ...entry(streamOffset)]);
    const dict = `${streamObjNum} 0 obj\n<< /Type /XRef /Size ${num + 2} ${common} /W [1 4 2] /Index [${num} 2] /Length ${data.length} >>\nstream\n`;
    parts.push(enc.encode(`${sep}${infoObj}${dict}`), data, enc.encode(`\nendstream\nendobj\nstartxref\n${streamOffset}\n%%EOF\n`));
  }

  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return { bytes: out, hadInfo: false, added: true };
}
