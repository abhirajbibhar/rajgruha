import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { openShortcuts } from '../../components/AppShell';
import { PageHeader } from '../../components/ui';
import { SettingsShell } from '../../components/SettingsShell';
import { api } from '../../lib/api';
import { FORMAT_LABEL } from '../../lib/format';
import { meQuery, statsQuery } from '../../lib/queries';
import { useTheme, type ThemePreference } from '../../lib/theme';

export const Route = createFileRoute('/_app/settings')({ component: Settings });

const THEMES: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'Match my device', hint: 'Follows your operating system' }
];

function Settings() {
  const { data: me } = useQuery(meQuery);
  const { data: stats } = useQuery({ ...statsQuery, enabled: me?.role === 'admin' });
  const { preference, setPreference } = useTheme();
  const admin = me?.role === 'admin';

  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Account" title="Settings" />
      <SettingsShell
        sections={[
          {
            id: 'appearance', title: 'Appearance', desc: 'Choose how the library looks on this device.',
            children: (
              <div className="settings-form">
                <div className="settings-row">
                  <label>Theme</label>
                  <div className="settings-control" role="radiogroup" aria-label="Theme" style={{ display: 'grid', gap: 8 }}>
                    {THEMES.map((t) => (
                      <label key={t.value} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, cursor: 'pointer' }}>
                        <input type="radio" name="theme" checked={preference === t.value} onChange={() => setPreference(t.value)} />
                        <span>{t.label} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>· {t.hint}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )
          },
          {
            id: 'data', title: 'Your data', desc: 'Everything you’ve recorded — reading progress, sessions, notes and tasks — is yours to take with you.',
            children: (
              <div className="settings-form">
                <div className="settings-row">
                  <label>Reading data</label>
                  <div className="settings-control">
                    <a className="btn btn-outline" href={api.exportMyDataUrl} download>Download my data (JSON)</a>
                    <div className="settings-hint">Progress, every reading session, and your notes and tasks.</div>
                  </div>
                </div>
              </div>
            )
          },
          ...(admin ? [{
            id: 'library', title: 'Library', desc: 'Catalog tools for administrators.',
            children: (
              <div className="settings-form">
                <div className="settings-row">
                  <label>In the library</label>
                  <div className="settings-control">
                    {stats ? <strong>{stats.totalBooks} {stats.totalBooks === 1 ? 'book' : 'books'}</strong> : '…'}
                    {stats && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}> · {Object.entries(stats.byFormat).map(([f, n]) => `${n} ${FORMAT_LABEL[f as keyof typeof FORMAT_LABEL] ?? f}`).join(' · ') || 'nothing yet'}</span>}
                  </div>
                </div>
                <div className="settings-row">
                  <label>Catalog export</label>
                  <div className="settings-control">
                    <a className="btn btn-outline" href={api.exportCatalogUrl} download>Download catalog (CSV)</a>
                    <div className="settings-hint">Opens in Excel or Google Sheets. Use it as a backup of what you own.</div>
                  </div>
                </div>
                <div className="settings-row">
                  <label>Manage</label>
                  <div className="settings-control" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link className="btn btn-outline btn-sm" to="/upload">Add books</Link>
                    <Link className="btn btn-outline btn-sm" to="/files">Book files</Link>
                    <Link className="btn btn-outline btn-sm" to="/members">Members</Link>
                  </div>
                </div>
              </div>
            )
          }] : []),
          {
            id: 'shortcuts', title: 'Keyboard shortcuts', desc: 'Faster navigation without the mouse.',
            children: (
              <div className="settings-form">
                <div className="settings-row">
                  <label>Shortcuts</label>
                  <div className="settings-control">
                    <button type="button" className="btn btn-outline btn-sm" onClick={openShortcuts}>Show all shortcuts</button>
                    <div className="settings-hint">Press <kbd className="kbd">?</kbd> anywhere to open the list.</div>
                  </div>
                </div>
              </div>
            )
          },
          {
            id: 'about', title: 'About',
            children: (
              <div className="settings-form">
                <div className="settings-row">
                  <label>Rajgruha</label>
                  <div className="settings-control" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Your digital library. Interface built on the Gentelella design system (MIT).{' '}
                    <Link to="/help">Read the help guide</Link>.
                  </div>
                </div>
              </div>
            )
          }
        ]}
      />
    </div>
  );
}
