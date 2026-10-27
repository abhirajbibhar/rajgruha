/**
 * Settings.
 *
 * Account, reading defaults, notebook and quote preferences, the owner's
 * instance controls, and the maintenance actions for rebuilding the derived
 * indexes or exporting everything as JSON.
 */
import { useEffect, useState } from 'react';
import { api, downloadJson, errorMessage } from '../api';
import {
  Banner,
  Card,
  Chip,
  Field,
  Spinner,
  useAsync,
  useToast,
} from '../components/ui';
import { CheckIcon, DownloadIcon } from '../components/Icons';
import { formatDate } from '../lib/format';
import type { UserSettings, UserSummary } from '../../../shared/types';

interface Props {
  // Provided by App through the shell context in practice; props keep this page
  // usable on its own.
  currentUser?: { id: string; name: string; email: string; isOwner: boolean };
}

export default function Settings(_props: Props) {
  const toast = useToast();
  const me = useAsync(() => api.me(), []);
  const settingsState = useAsync(() => api.settings(), []);
  const instanceState = useAsync(() => api.instance(), []);

  const [theme, setTheme] = useState<UserSettings['theme']>('system');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (settingsState.data) {
      setSettings(settingsState.data.settings);
      setTheme(settingsState.data.settings.theme);
    }
  }, [settingsState.data]);

  async function patch(patchBody: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const result = await api.saveSettings(patchBody);
      setSettings(result.settings);
      setTheme(result.settings.theme);
      document.documentElement.dataset.theme =
        result.settings.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : result.settings.theme;
      try {
        localStorage.setItem('rajgruha-theme', result.settings.theme);
      } catch {
        /* Storage can be unavailable; the setting still applies. */
      }
      toast.push('Settings saved', 'success');
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(null);
    }
  }

  if (settingsState.initial && settingsState.loading) {
    return (
      <div className="page">
        <Spinner label="Loading settings…" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="page">
        <Banner kind="error">{settingsState.error?.message ?? 'Settings could not be loaded.'}</Banner>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__title">
          <h1>Settings</h1>
          <span className="page__subtitle">
            {me.data && `${me.data.user.name} · ${me.data.user.email}`}
            {me.data?.user.isOwner ? ' · owner' : ''}
          </span>
        </div>
      </header>

      <AppearanceCard theme={theme} onChoose={(value) => patch({ theme: value }, 'theme')} busy={busy === 'theme'} />

      <ReadingCard
        reader={settings.reader}
        onChange={(next) => patch({ reader: next }, 'reader')}
        busy={busy === 'reader'}
      />

      <NotebookCard
        notebook={settings.notebook}
        onChange={(next) => patch({ notebook: next }, 'notebook')}
        busy={busy === 'notebook'}
      />

      <QuotesCard
        quotes={settings.quotes}
        onChange={(next) => patch({ quotes: next }, 'quotes')}
        busy={busy === 'quotes'}
      />

      <LibraryCard
        library={settings.library}
        onChange={(next) => patch({ library: next }, 'library')}
        busy={busy === 'library'}
      />

      <AccountCard onChanged={() => me.reload()} />

      {me.data?.user.isOwner && (
        <InstanceCard
          state={instanceState.data}
          onChanged={() => {
            instanceState.reload();
            me.reload();
          }}
        />
      )}

      <Card title="Data and maintenance">
        <p className="small muted">
          Everything is stored as plain JSON, Markdown and PDF in one Cloudflare R2 bucket, so it stays
          readable with any S3 tool even if this app is gone.
        </p>
        <div className="row row--wrap">
          <button
            type="button"
            className="btn"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                const data = await api.exportAll();
                downloadJson(`rajgruha-export-${new Date().toISOString().slice(0, 10)}.json`, data);
                toast.push('Export downloaded', 'success');
              } catch (error) {
                toast.error(error);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? <Spinner /> : <DownloadIcon size={16} />}
            Export everything as JSON
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy === 'library-reindex'}
            onClick={async () => {
              setBusy('library-reindex');
              try {
                const result = await api.reindexLibrary();
                toast.push(`Library reindexed · ${result.books} books`, 'success');
              } catch (error) {
                toast.error(error);
              } finally {
                setBusy(null);
              }
            }}
          >
            Rebuild library index
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy === 'notes-reindex'}
            onClick={async () => {
              setBusy('notes-reindex');
              try {
                const result = await api.reindexAnnotations();
                toast.push(`Notes reindexed · ${result.annotations} annotations`, 'success');
              } catch (error) {
                toast.error(error);
              } finally {
                setBusy(null);
              }
            }}
          >
            Rebuild notes index
          </button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          PDF bytes are not included in the JSON export. Copy them with any S3 client from{' '}
          <code>u/&lt;your id&gt;/library/&lt;book id&gt;/book.pdf</code>.
        </p>
      </Card>

      <Card title="Session">
        <div className="row row--wrap">
          <button
            type="button"
            className="btn btn--danger"
            onClick={async () => {
              await api.logout();
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- sub-cards */

function AppearanceCard({
  theme,
  onChoose,
  busy,
}: {
  theme: UserSettings['theme'];
  onChoose: (value: UserSettings['theme']) => void;
  busy: boolean;
}) {
  return (
    <Card title="Appearance" action={busy ? <Spinner /> : null}>
      <div className="row row--wrap">
        {(['light', 'dark', 'system'] as const).map((option) => (
          <Chip key={option} active={theme === option} onClick={() => onChoose(option)}>
            {option === 'system' ? 'Match device' : option === 'light' ? 'Light' : 'Dark'}
          </Chip>
        ))}
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        This preference is stored on your account, so it follows you between devices.
      </p>
    </Card>
  );
}

function ReadingCard({
  reader,
  onChange,
  busy,
}: {
  reader: UserSettings['reader'];
  onChange: (next: UserSettings['reader']) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(reader);
  useEffect(() => setDraft(reader), [reader]);

  return (
    <Card title="Reading and annotations" action={busy ? <Spinner /> : null}>
      <Field label="Annotation author" hint="stamped on every highlight you make">
        <input
          className="input"
          value={draft.annotationAuthor}
          onChange={(event) => setDraft({ ...draft, annotationAuthor: event.target.value })}
          maxLength={120}
        />
      </Field>

      <Field label="Default highlight colour">
        <div className="row">
          <input
            type="color"
            value={draft.highlightColor}
            onChange={(event) => setDraft({ ...draft, highlightColor: event.target.value })}
            style={{ width: 46, height: 40, padding: 2, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--bg)' }}
            aria-label="Highlight colour"
          />
          <input
            className="input"
            value={draft.highlightColor}
            onChange={(event) => setDraft({ ...draft, highlightColor: event.target.value })}
            maxLength={40}
          />
        </div>
      </Field>

      <Field label="Scroll direction">
        <select
          className="select"
          value={draft.scrollStrategy}
          onChange={(event) => setDraft({ ...draft, scrollStrategy: event.target.value as 'vertical' | 'horizontal' })}
        >
          <option value="vertical">Vertical (continuous)</option>
          <option value="horizontal">Horizontal (facing pages)</option>
        </select>
      </Field>

      <Field label="Autosave delay" hint="seconds of inactivity before annotations are saved">
        <input
          className="input"
          type="number"
          min={5}
          max={600}
          value={draft.autosaveSeconds}
          onChange={(event) => setDraft({ ...draft, autosaveSeconds: Number(event.target.value) })}
        />
      </Field>

      <label className="row small" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={draft.showThumbnails}
          onChange={(event) => setDraft({ ...draft, showThumbnails: event.target.checked })}
        />
        Show the thumbnail panel by default
      </label>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => onChange(draft)} disabled={busy}>
          Save reading settings
        </button>
      </div>
    </Card>
  );
}

function NotebookCard({
  notebook,
  onChange,
  busy,
}: {
  notebook: UserSettings['notebook'];
  onChange: (next: UserSettings['notebook']) => void;
  busy: boolean;
}) {
  return (
    <Card title="Notebook" action={busy ? <Spinner /> : null}>
      <div className="stack stack--tight">
        <label className="row small" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={notebook.carryOverTodos}
            onChange={(event) => onChange({ ...notebook, carryOverTodos: event.target.checked })}
          />
          Offer to carry yesterday's unfinished todos into today
        </label>
        <label className="row small" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={notebook.showWeek}
            onChange={(event) => onChange({ ...notebook, showWeek: event.target.checked })}
          />
          Show the seven-day week panel next to the editor
        </label>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        One markdown file per day at <code>notebook/2026-W44/2026-10-27.md</code>. A week is therefore
        seven small files, so a bad write can never ruin a week's notes.
      </p>
    </Card>
  );
}

function QuotesCard({
  quotes,
  onChange,
  busy,
}: {
  quotes: UserSettings['quotes'];
  onChange: (next: UserSettings['quotes']) => void;
  busy: boolean;
}) {
  return (
    <Card title="Quotes" action={busy ? <Spinner /> : null}>
      <div className="stack stack--tight">
        <label className="row small" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={quotes.quoteOfTheDay}
            onChange={(event) => onChange({ ...quotes, quoteOfTheDay: event.target.checked })}
          />
          Show a quote of the day on the dashboard
        </label>
        <label className="row small" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={quotes.compactLayout}
            onChange={(event) => onChange({ ...quotes, compactLayout: event.target.checked })}
          />
          Compact quote layout
        </label>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        The quote of the day is derived from the date, so the same quote appears on every device all
        day without anything being stored or scheduled.
      </p>
    </Card>
  );
}

function LibraryCard({
  library,
  onChange,
  busy,
}: {
  library: UserSettings['library'];
  onChange: (next: UserSettings['library']) => void;
  busy: boolean;
}) {
  return (
    <Card title="Library" action={busy ? <Spinner /> : null}>
      <Field label="Default sort">
        <select
          className="select"
          value={library.sortBy}
          onChange={(event) => onChange({ ...library, sortBy: event.target.value as UserSettings['library']['sortBy'] })}
        >
          <option value="recent">Recently opened</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="added">Recently added</option>
        </select>
      </Field>
      <Field label="Default view">
        <div className="row">
          <Chip active={library.view === 'grid'} onClick={() => onChange({ ...library, view: 'grid' })}>
            Covers
          </Chip>
          <Chip active={library.view === 'list'} onClick={() => onChange({ ...library, view: 'list' })}>
            List
          </Chip>
        </div>
      </Field>
    </Card>
  );
}

function AccountCard({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const me = useAsync(() => api.me(), []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.user.name);
    setEmail(me.data.user.email);
  }, [me.data]);

  return (
    <Card title="Your account">
      {error && <Banner kind="error">{error}</Banner>}

      <Field label="Name">
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy === 'profile'}
          onClick={async () => {
            setBusy('profile');
            setError(null);
            try {
              await api.updateProfile({ name, email });
              toast.push('Profile updated', 'success');
              me.reload();
              onChanged();
            } catch (thrown) {
              setError(errorMessage(thrown));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === 'profile' ? <Spinner /> : <CheckIcon size={15} />}
          Save profile
        </button>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

      <Field label="Current password">
        <input
          className="input"
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <Field label="New password" hint="at least 10 characters">
        <input
          className="input"
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy === 'password' || !current || next.length < 10}
          onClick={async () => {
            setBusy('password');
            setError(null);
            try {
              await api.changePassword(current, next);
              setCurrent('');
              setNext('');
              toast.push('Password changed', 'success');
            } catch (thrown) {
              setError(errorMessage(thrown));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === 'password' ? <Spinner /> : null}
          Change password
        </button>
      </div>
    </Card>
  );
}

function InstanceCard({
  state,
  onChanged,
}: {
  state: { ownerId: string | null; registrationOpen: boolean; isOwner: boolean; createdAt: string } | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const users = useAsync(() => api.users(), []);
  const [busy, setBusy] = useState(false);

  return (
    <Card title="This instance" action={busy ? <Spinner /> : null}>
      {state && (
        <>
          <div className="row row--wrap">
            <Chip active={state.registrationOpen} onClick={async () => {
              setBusy(true);
              try {
                await api.saveInstance({ registrationOpen: !state.registrationOpen });
                toast.push(state.registrationOpen ? 'Sign-ups closed' : 'Sign-ups opened', 'success');
                onChanged();
              } catch (error) {
                toast.error(error);
              } finally {
                setBusy(false);
              }
            }}>
              {state.registrationOpen ? 'Sign-ups open' : 'Sign-ups closed'}
            </Chip>
            <span className="tiny faint">created {formatDate(state.createdAt)}</span>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            While sign-ups are open anyone who reaches this URL can create an account. The first
            account created is the owner; keep this closed unless you are adding someone.
          </p>
        </>
      )}

      <h3 style={{ marginTop: 12 }}>Accounts</h3>
      {users.data ? (
        <div className="list">
          {users.data.users.map((user: UserSummary) => (
            <div key={user.id} className="list__item" style={{ cursor: 'default' }}>
              <span className="grow">
                <strong>{user.name}</strong>
                <span className="tiny faint" style={{ display: 'block' }}>
                  {user.email} · joined {formatDate(user.createdAt)}
                </span>
              </span>
              {user.role === 'owner' && <span className="badge">owner</span>}
            </div>
          ))}
        </div>
      ) : (
        <p className="small faint">Only the owner can list accounts.</p>
      )}
    </Card>
  );
}
