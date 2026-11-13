import { useState, type FormEvent } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DayStr, MonthStr, type DayLog } from '@rajgruha/shared';
import { Icon } from '../../components/icons';
import { BookCover, PageHeader } from '../../components/ui';
import { addDays, addMonths, dayLabel, fmtMinutes, fmtSession, localDay, localMonth, monthLabel, parseDay } from '../../lib/dates';
import { api } from '../../lib/api';
import { useToggleNote } from '../../lib/useToggleNote';
import { dayLogQuery, monthLogQuery } from '../../lib/queries';

const Search = z.object({ day: DayStr.optional(), month: MonthStr.optional() });
export const Route = createFileRoute('/_app/log')({ validateSearch: Search, component: ReadingLog });

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Calendar + daily reading sessions + notes/tasks, in one place (replaces the separate calendar page). */
function ReadingLog() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const today = localDay();
  const day = search.day ?? today;
  const month = search.month ?? day.slice(0, 7);
  const go = (patch: { day?: string; month?: string }) => void navigate({ search: (p) => ({ ...p, ...patch }) });

  const { data: monthLog } = useQuery(monthLogQuery(month));
  const byDay = new Map(monthLog?.days.map((d) => [d.day, d]));
  const max = Math.max(1, ...(monthLog?.days.map((d) => d.minutes) ?? [1]));

  // Monday-first grid, padded to whole weeks.
  const first = parseDay(`${month}-01`);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => addDays(`${month}-01`, i - lead));

  return (
    <div className="page-wrapper">
      <PageHeader
        pretitle="Library · Reading log"
        title="Reading log"
        actions={<button className="btn btn-outline" onClick={() => go({ day: today, month: localMonth() })}>Today</button>}
      />

      <div className="log-layout">
        <div className="card">
          <div className="card-header" style={{ alignItems: 'center' }}>
            <div>
              <div className="card-title">{monthLabel(month)}</div>
              <div className="card-subtitle">{monthLog ? `${fmtMinutes(monthLog.totalMinutes)} read this month` : '…'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline btn-sm" aria-label="Previous month" onClick={() => go({ month: addMonths(month, -1) })}>←</button>
              <button className="btn btn-outline btn-sm" aria-label="Next month" onClick={() => go({ month: addMonths(month, 1) })}>→</button>
            </div>
          </div>
          <div className="card-body">
            <div className="rl-cal" role="grid" aria-label={`Reading calendar, ${monthLabel(month)}`}>
              {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
              {cells.map((d) => {
                const info = byDay.get(d);
                const mins = info?.minutes ?? 0;
                const lvl = mins <= 0 ? 0 : Math.min(4, Math.ceil((mins / max) * 4));
                const cls = ['rl-day', d.slice(0, 7) !== month && 'out', d === today && 'today', d === day && 'sel'].filter(Boolean).join(' ');
                return (
                  <button key={d} type="button" role="gridcell" className={cls} data-l={lvl} aria-selected={d === day} aria-label={`${dayLabel(d)}${mins ? `, ${mins} minutes read` : ''}${info?.tasksOpen ? `, ${info.tasksOpen} open tasks` : ''}`} onClick={() => go({ day: d, month: d.slice(0, 7) })}>
                    <span className="d">{+d.slice(8)}</span>
                    <span className="m">{mins ? fmtMinutes(mins) : ''}</span>
                    <span className="dots">{info && info.notes > 0 && <i title="Notes / tasks" />}</span>
                  </button>
                );
              })}
            </div>
            <div className="legend" style={{ marginTop: 12 }}>
              <span><span className="sw" style={{ background: 'color-mix(in srgb, var(--primary) 30%, transparent)' }} />Some reading</span>
              <span><span className="sw" style={{ background: 'var(--primary)' }} />A lot</span>
              <span><span className="sw" style={{ background: 'var(--yellow)', borderRadius: '50%' }} />Has notes or tasks</span>
            </div>
          </div>
        </div>

        <DayPanel day={day} />
      </div>
    </div>
  );
}

function DayPanel({ day }: { day: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(dayLogQuery(day));
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'task' | 'note'>('task');

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['log'] }); };
  const add = useMutation({ mutationFn: api.addNote, onSuccess: () => { setText(''); refresh(); } });
  const toggle = useToggleNote();
  const remove = useMutation({ mutationFn: api.deleteNote, onSuccess: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) add.mutate({ day, kind, text: text.trim() });
  };

  const d: DayLog | undefined = data;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">{dayLabel(day)}</div>
            <div className="card-subtitle">{d ? (d.minutes ? `${fmtMinutes(d.minutes)} across ${d.sessions.length} ${d.sessions.length === 1 ? 'session' : 'sessions'}` : 'No reading recorded') : '…'}</div>
          </div>
        </div>
        <div className="card-body" style={{ padding: '6px 16px 12px' }}>
          {isPending && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
          {d?.sessions.map((s) => (
            <Link key={s.id} className="continue-item" to="/books/$bookId" params={{ bookId: s.book.slug }} style={{ color: 'inherit', textDecoration: 'none' }}>
              <BookCover book={s.book} small />
              <div className="continue-meta">
                <div className="continue-title">{s.book.title}</div>
                <div className="continue-author">{new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {fmtSession(s.durationS)}</div>
                <div className="continue-sub"><span>{Math.round(s.startPercent)}% → {Math.round(s.endPercent)}%</span></div>
              </div>
            </Link>
          ))}
          {d && d.sessions.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '10px 0' }}>Sessions appear here automatically while you read.</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div><div className="card-title">Notes &amp; tasks</div><div className="card-subtitle">Jot down what you want to read or remember</div></div></div>
        <div className="card-body">
          <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select className="form-control" style={{ width: 92, height: 36 }} aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as 'task' | 'note')}>
              <option value="task">Task</option><option value="note">Note</option>
            </select>
            <input className="form-control" style={{ flex: '1 1 160px', height: 36 }} placeholder={kind === 'task' ? 'e.g. Finish chapter 5' : 'e.g. Loved the ending…'} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="New note or task" />
            <button className="btn btn-primary" type="submit" disabled={!text.trim() || add.isPending}><Icon name="tag" size={14} /> Add</button>
          </form>
          {add.isError && <p role="alert" style={{ color: 'var(--red)', fontSize: 12.5 }}>Could not save.</p>}
          {d?.notes.map((n) => (
            <div key={n.id} className={n.done ? 'note-row done' : 'note-row'}>
              {n.kind === 'task'
                ? <input type="checkbox" checked={n.done} onChange={(e) => toggle.mutate({ id: n.id, done: e.target.checked })} aria-label={`Mark “${n.text}” ${n.done ? 'not done' : 'done'}`} style={{ marginTop: 3 }} />
                : <span aria-hidden="true" style={{ color: 'var(--yellow)', lineHeight: '20px' }}>✎</span>}
              <span className="t">{n.text}</span>
              <button className="x" type="button" aria-label={`Delete “${n.text}”`} onClick={() => remove.mutate(n.id)}>×</button>
            </div>
          ))}
          {d && d.notes.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>Nothing for this day yet.</p>}
        </div>
      </div>
    </div>
  );
}
