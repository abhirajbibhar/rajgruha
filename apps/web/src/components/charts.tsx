import { parseDay } from '../lib/dates';
import { fmtMinutes } from '../lib/dates';

export const PALETTE = ['var(--primary)', 'var(--blue)', 'var(--yellow)', 'var(--green)', 'var(--red)', 'var(--text-muted)'];

type Bar = { label: string; value: number };

/** Minutes-per-bucket bar chart. Pure SVG; scales with its container. */
export function BarChart({ data, height = 190 }: { data: Bar[]; height?: number }) {
  const W = 720, padL = 34, padB = 22, padT = 8;
  const max = Math.max(10, ...data.map((d) => d.value));
  const top = Math.ceil(max / 10) * 10;
  const plotH = height - padB - padT;
  const bw = (W - padL) / Math.max(1, data.length);
  const every = Math.ceil(data.length / 8);
  return (
    <svg className="rg-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Minutes read per period">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line className="grid" x1={padL} x2={W} y1={y} y2={y} />
            <text x={padL - 6} y={y + 3} textAnchor="end">{Math.round(top * f)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / top) * plotH;
        const x = padL + i * bw;
        return (
          <g key={i}>
            <rect className="bar" x={x + bw * 0.15} y={padT + plotH - h} width={Math.max(1, bw * 0.7)} height={Math.max(0, h)} rx={Math.min(3, bw * 0.3)}>
              <title>{d.label}: {fmtMinutes(d.value)}</title>
            </rect>
            {i % every === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** GitHub-style activity grid; weeks run left→right, Monday on top. */
export function Heatmap({ days }: { days: { day: string; minutes: number }[] }) {
  if (!days.length) return null;
  const max = Math.max(1, ...days.map((d) => d.minutes));
  const lead = (parseDay(days[0]!.day).getDay() + 6) % 7; // Monday = 0
  const level = (m: number) => (m <= 0 ? 0 : Math.min(4, Math.ceil((m / max) * 4)));
  const cols = Math.ceil((days.length + lead) / 7);
  return (
    <div className="heat" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: cols * 26 }} role="img" aria-label="Reading activity by day">
      {Array.from({ length: lead }, (_, i) => <i key={`b${i}`} style={{ visibility: 'hidden' }} />)}
      {days.map((d) => <i key={d.day} data-l={level(d.minutes)} title={`${d.day}: ${fmtMinutes(d.minutes)}`} />)}
    </div>
  );
}

export function Donut({ parts, size = 150 }: { parts: { label: string; value: number }[]; size?: number }) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const r = 15.9155; // circumference 100
  let offset = 25;
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label="Share of reading time">
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--border-color-light)" strokeWidth="5" />
        {total > 0 && parts.map((p, i) => {
          const pct = (p.value / total) * 100;
          const el = <circle key={p.label} cx="21" cy="21" r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset}><title>{p.label}: {fmtMinutes(p.value)}</title></circle>;
          offset -= pct;
          return el;
        })}
      </svg>
      <div className="legend" style={{ flexDirection: 'column', gap: 6 }}>
        {parts.map((p, i) => (
          <span key={p.label}><span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />{p.label} · {total ? Math.round((p.value / total) * 100) : 0}%</span>
        ))}
        {!parts.length && <span>No reading yet</span>}
      </div>
    </div>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span>{r.label}</span><span style={{ color: 'var(--text-muted)' }}>{fmtMinutes(r.value)}</span>
          </div>
          <div className="progress-line"><i style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
      {!rows.length && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No reading yet</span>}
    </div>
  );
}
