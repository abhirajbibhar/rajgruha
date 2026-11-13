import { useMemo, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Donut, HBars, Heatmap } from '../../components/charts';
import { Icon } from '../../components/icons';
import { BookCover, PageHeader, StatCard } from '../../components/ui';
import { fmtMinutes, localDay, parseDay } from '../../lib/dates';
import { FORMAT_LABEL } from '../../lib/format';
import { analyticsQuery } from '../../lib/queries';

export const Route = createFileRoute('/_app/analytics')({ component: Analytics });

const RANGES = [30, 90, 180, 365] as const;

function Analytics() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const today = useMemo(() => localDay(), []);
  const { data, isPending, isError } = useQuery(analyticsQuery(days, today));

  // ≤ 90 days → one bar per day; longer → one bar per week so the chart stays readable.
  const bars = useMemo(() => {
    if (!data) return [];
    if (days <= 90) return data.daily.map((d) => ({ label: parseDay(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), value: d.minutes }));
    const out: { label: string; value: number }[] = [];
    for (let i = 0; i < data.daily.length; i += 7) {
      const chunk = data.daily.slice(i, i + 7);
      out.push({ label: parseDay(chunk[0]!.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), value: chunk.reduce((t, d) => t + d.minutes, 0) });
    }
    return out;
  }, [data, days]);

  const t = data?.totals;
  return (
    <div className="page-wrapper">
      <PageHeader
        pretitle="Library · Insights"
        title="Reading analytics"
        actions={
          <div className="btn-group" role="group" aria-label="Date range">
            {RANGES.map((r) => <button key={r} type="button" className={r === days ? 'btn btn-outline btn-sm active' : 'btn btn-outline btn-sm'} aria-pressed={r === days} onClick={() => setDays(r)}>{r === 365 ? '1y' : `${r}d`}</button>)}
          </div>
        }
      />
      {isError && <p role="alert" style={{ color: 'var(--red)' }}>Could not load analytics.</p>}

      <div className="row col-4">
        <StatCard tone="teal" icon={<Icon name="book" />} label="Time read" value={t ? fmtMinutes(t.minutes) : '—'} sub={t ? `${t.sessions} sessions` : undefined} />
        <StatCard tone="blue" icon={<Icon name="calendar" />} label="Active days" value={t?.activeDays ?? '—'} sub={t ? `of ${days} days` : undefined} />
        <StatCard tone="yellow" icon={<Icon name="charts" />} label="Reading streak" value={t ? `${t.currentStreak}d` : '—'} sub={t ? `longest ${t.longestStreak} days` : undefined} />
        <StatCard tone="green" icon={<Icon name="books" />} label="Finished" value={t?.booksFinished ?? '—'} sub={t ? `avg session ${fmtMinutes(t.avgSessionMinutes)}` : undefined} />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header"><div><div className="card-title">{days <= 90 ? 'Minutes per day' : 'Minutes per week'}</div><div className="card-subtitle">Last {days} days</div></div></div>
        <div className="card-body">{isPending ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : <BarChart data={bars} />}</div>
      </div>

      <div className="row col-8-4" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="card-header"><div><div className="card-title">Activity</div><div className="card-subtitle">Darker = more reading</div></div></div>
          <div className="card-body">{data && <Heatmap days={data.daily.slice(-182)} />}</div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">By format</div></div>
          <div className="card-body">{data && <Donut parts={data.byFormat.map((f) => ({ label: FORMAT_LABEL[f.format as keyof typeof FORMAT_LABEL] ?? f.format, value: f.minutes }))} />}</div>
        </div>
      </div>

      <div className="row col-2">
        <div className="card">
          <div className="card-header"><div className="card-title">Top genres</div></div>
          <div className="card-body">{data && <HBars rows={data.byGenre.map((g) => ({ label: g.genre, value: g.minutes }))} />}</div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Most-read books</div></div>
          <div className="card-body" style={{ padding: '6px 16px' }}>
            {data?.topBooks.map(({ book, minutes }) => (
              <Link key={book.id} className="continue-item" to="/books/$bookId" params={{ bookId: book.slug }} style={{ color: 'inherit', textDecoration: 'none' }}>
                <BookCover book={book} small />
                <div className="continue-meta">
                  <div className="continue-title">{book.title}</div>
                  <div className="continue-author">{book.author}</div>
                  <div className="continue-sub"><span>{fmtMinutes(minutes)}</span></div>
                </div>
              </Link>
            ))}
            {data && data.topBooks.length === 0 && <p style={{ padding: '14px 0', color: 'var(--text-muted)', fontSize: 13 }}>Read something and it shows up here.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
