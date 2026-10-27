/**
 * The notebook.
 *
 * Today's page is todos, remarks and reflections. Whatever is typed is written
 * to a markdown file for that day, one file per day inside a per-week folder, so
 * a week is seven small files that any editor or grep can read. The structured
 * fields and the raw markdown are views of the same text, and both save.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { navigate } from '../router';
import {
  Banner,
  Card,
  Chip,
  EmptyState,
  Spinner,
  Stat,
  useAsync,
  useToast,
} from '../components/ui';
import { CheckIcon, FlameIcon, NotebookIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { excerpt, formatDate, relativeTime, todayIso, weekdayShort } from '../lib/format';
import type { NotebookDay, NotebookTodo } from '../../../shared/types';

interface Props {
  query: URLSearchParams;
}

type Mode = 'write' | 'markdown';

export default function Notebook({ query }: Props) {
  const toast = useToast();
  const today = todayIso();
  const requestedDate = query.get('date');
  const [date, setDate] = useState(requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today);
  const [mode, setMode] = useState<Mode>('write');

  const [todos, setTodos] = useState<NotebookTodo[]>([]);
  const [remarks, setRemarks] = useState('');
  const [reflections, setReflections] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draftTodo, setDraftTodo] = useState('');

  const index = useAsync(() => api.notebook(today), [today]);
  const day = useAsync(() => api.notebookDay(date), [date]);
  const week = useAsync(() => api.notebookWeek(weekOf(date)), [date]);

  // Load the fetched day into the editable buffers.
  useEffect(() => {
    if (!day.data) return;
    setTodos(day.data.day.todos);
    setRemarks(day.data.day.remarks);
    setReflections(day.data.day.reflections);
    setMarkdown(day.data.day.markdown);
    setSavedAt(day.data.day.updatedAt);
    setDirty(false);
  }, [day.data]);

  const save = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => {});
  save.current = async (options = {}) => {
    if (saving) return;
    setSaving(true);
    try {
      const payload =
        mode === 'markdown'
          ? { markdown }
          : { todos, remarks, reflections };
      const result = await api.saveNotebookDay(date, payload);
      setSavedAt(result.day.updatedAt);
      setDirty(false);
      if (mode === 'markdown') {
        setTodos(result.day.todos);
        setRemarks(result.day.remarks);
        setReflections(result.day.reflections);
      } else {
        setMarkdown(result.day.markdown);
      }
      if (!options.silent) toast.push('Notebook saved', 'success');
      index.reload();
      week.reload();
    } catch (error) {
      if (!options.silent) toast.error(error);
      else toast.push(errorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Autosave shortly after typing stops, so nothing is lost to a closed tab.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void save.current({ silent: true }), 1600);
    return () => window.clearTimeout(timer);
  }, [dirty, todos, remarks, reflections, markdown, mode]);

  // Flush on navigation away.
  useEffect(() => {
    const onHide = () => {
      if (dirty) void save.current({ silent: true });
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [dirty]);

  const weekDays = week.data?.days ?? [];
  const openTodos = useMemo(() => todos.filter((todo) => !todo.done).length, [todos]);

  function updateTodos(next: NotebookTodo[]) {
    setTodos(next);
    setDirty(true);
  }

  async function carryOver() {
    try {
      const result = await api.carryOverTodos(today);
      if (result.carried === 0) {
        toast.push('Nothing outstanding from yesterday', 'info');
        return;
      }
      toast.push(`Carried ${result.carried} todo${result.carried === 1 ? '' : 's'} over`, 'success');
      day.reload();
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__title">
          <h1>Notebook</h1>
          <span className="page__subtitle">
            {formatDate(date)}
            {date === today ? ' · today' : ''}
            {index.data ? ` · ${index.data.totalDays} days written` : ''}
          </span>
        </div>
        <div className="row">
          <span className="reader__status" aria-live="polite">
            {saving ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : dirty ? (
              'Unsaved changes'
            ) : savedAt ? (
              <>
                <CheckIcon size={13} />
                Saved {relativeTime(savedAt)}
              </>
            ) : (
              'Not written yet'
            )}
          </span>
          <button type="button" className="btn btn--primary" onClick={() => void save.current()} disabled={saving}>
            Save now
          </button>
        </div>
      </header>

      <div className="grid grid--stats">
        <Stat value={index.data?.streak ?? 0} label="Day streak" hint="consecutive days" />
        <Stat value={openTodos} label="Open todos" hint={`${todos.length} total`} />
        <Stat value={weekDays.filter((entry) => isWritten(entry)).length} label="This week" hint="days written" />
        <Stat value={index.data?.totalDays ?? 0} label="All days" />
      </div>

      {index.data && index.data.streak >= 3 && (
        <Banner kind="info">
          <FlameIcon size={16} />
          <span>
            {index.data.streak} days in a row. The streak counts consecutive days with a notebook page.
          </span>
        </Banner>
      )}

      <div className="notebook">
        <Card
          title={date === today ? "Today's page" : formatDate(date)}
          action={
            <div className="row">
              <div className="tabs" role="tablist" aria-label="Editing mode">
                <button
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={mode === 'write'}
                  onClick={() => setMode('write')}
                >
                  Write
                </button>
                <button
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={mode === 'markdown'}
                  onClick={() => {
                    // Fold any pending structured edits into the raw text first.
                    if (dirty) void save.current({ silent: true });
                    setMode('markdown');
                  }}
                >
                  Markdown
                </button>
              </div>
            </div>
          }
        >
          {day.initial && day.loading ? (
            <Spinner label="Opening the page…" />
          ) : mode === 'write' ? (
            <div className="stack">
              <div className="stack stack--tight">
                <div className="row row--between">
                  <h3>Todos</h3>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={carryOver}>
                    Carry over yesterday's
                  </button>
                </div>

                {todos.length === 0 && <p className="small faint">Nothing on the list yet.</p>}

                {todos.map((todo, position) => (
                  <div key={`${position}-${todo.text}`} className={`todo${todo.done ? ' todo--done' : ''}`}>
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={(event) =>
                        updateTodos(
                          todos.map((entry, index) =>
                            index === position ? { ...entry, done: event.target.checked } : entry,
                          ),
                        )
                      }
                      aria-label={`Mark “${todo.text}” as ${todo.done ? 'not done' : 'done'}`}
                    />
                    <input
                      className="input todo__text"
                      value={todo.text}
                      onChange={(event) =>
                        updateTodos(
                          todos.map((entry, index) =>
                            index === position ? { ...entry, text: event.target.value } : entry,
                          ),
                        )
                      }
                      style={{ border: 'none', background: 'transparent', padding: '2px 4px', minHeight: 28 }}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon todo__remove"
                      onClick={() => updateTodos(todos.filter((_, index) => index !== position))}
                      aria-label={`Remove “${todo.text}”`}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                ))}

                <form
                  className="row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = draftTodo.trim();
                    if (!text) return;
                    updateTodos([...todos, { text, done: false }]);
                    setDraftTodo('');
                  }}
                >
                  <input
                    className="input grow"
                    placeholder="Add a todo and press enter"
                    value={draftTodo}
                    onChange={(event) => setDraftTodo(event.target.value)}
                    maxLength={500}
                  />
                  <button type="submit" className="btn btn--icon" aria-label="Add todo" disabled={!draftTodo.trim()}>
                    <PlusIcon />
                  </button>
                </form>
              </div>

              <div className="stack stack--tight">
                <h3>Remarks</h3>
                <textarea
                  className="textarea"
                  value={remarks}
                  placeholder="What happened today, what you noticed, what to remember…"
                  onChange={(event) => {
                    setRemarks(event.target.value);
                    setDirty(true);
                  }}
                  style={{ fontFamily: 'var(--font-ui)', minHeight: 150 }}
                  maxLength={20000}
                />
              </div>

              <div className="stack stack--tight">
                <h3>Reflections</h3>
                <textarea
                  className="textarea"
                  value={reflections}
                  placeholder="Anything worth thinking about again."
                  onChange={(event) => {
                    setReflections(event.target.value);
                    setDirty(true);
                  }}
                  style={{ fontFamily: 'var(--font-ui)', minHeight: 110 }}
                  maxLength={20000}
                />
              </div>

              <p className="tiny faint" style={{ margin: 0 }}>
                Saves to <code>{`notebook/${weekOf(date)}/${date}.md`}</code> in your R2 bucket.
              </p>
            </div>
          ) : (
            <div className="stack stack--tight">
              <textarea
                className="textarea"
                value={markdown}
                onChange={(event) => {
                  setMarkdown(event.target.value);
                  setDirty(true);
                }}
                style={{ minHeight: 460 }}
                spellCheck={false}
                aria-label="Raw markdown for this day"
              />
              <p className="tiny faint" style={{ margin: 0 }}>
                The file is the source of truth. Editing here rewrites it exactly as typed.
              </p>
            </div>
          )}
        </Card>

        <Card
          title={`Week ${week.data?.week ?? weekOf(date)}`}
          action={
            <div className="row" style={{ gap: 6 }}>
              <Chip onClick={() => setDate(shiftDate(date, -7))} title="Previous week">
                ← Prev
              </Chip>
              <Chip onClick={() => setDate(today)} title="Jump to today">
                Today
              </Chip>
              <Chip onClick={() => setDate(shiftDate(date, 7))} title="Next week">
                Next →
              </Chip>
            </div>
          }
        >
          {week.initial && week.loading ? (
            <Spinner />
          ) : weekDays.length === 0 ? (
            <EmptyState title="No days in this week" message="Use the arrows to move between weeks." />
          ) : (
            <div className="week">
              {weekDays.map((entry) => (
                <button
                  key={entry.date}
                  type="button"
                  className={`daycard${entry.date === date ? ' daycard--today' : ''}${isWritten(entry) ? '' : ' daycard--empty'}`}
                  onClick={() => {
                    setDate(entry.date);
                    navigate(`/notebook?date=${entry.date}`);
                  }}
                  style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
                >
                  <div className="daycard__head">
                    <span className="daycard__name">
                      {weekdayShort(entry.date)} {entry.date.slice(8)}
                    </span>
                    {isWritten(entry) ? (
                      <span className="badge badge--muted">{entry.todos.length} todo{entry.todos.length === 1 ? '' : 's'}</span>
                    ) : (
                      <span className="tiny faint">empty</span>
                    )}
                  </div>
                  {isWritten(entry) ? (
                    <pre className="preview">{excerpt(entry.remarks || todosToText(entry), 220)}</pre>
                  ) : (
                    <span className="tiny faint">Tap to write</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <NotebookIcon size={16} />
            <span className="tiny faint">
              Each day is its own .md file at <code>notebook/{weekOf(date)}/</code>
            </span>
          </div>
        </Card>
      </div>

      {query.get('date') !== date && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setDate(today);
              navigate('/notebook');
            }}
          >
            Back to today
          </button>
        </div>
      )}
    </div>
  );
}

function isWritten(day: NotebookDay): boolean {
  return day.updatedAt !== null || day.todos.length > 0 || day.remarks.trim() !== '';
}

function todosToText(day: NotebookDay): string {
  const open = day.todos.filter((todo) => !todo.done).map((todo) => `• ${todo.text}`);
  return open.join('\n');
}

/** ISO week (`YYYY-Www`) for a calendar date - the folder the day file lives in. */
export function weekOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const thursday = new Date(parsed.getTime());
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
