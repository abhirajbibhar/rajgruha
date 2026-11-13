import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { Book, BookFormat } from '@rajgruha/shared';
import { FORMAT_LABEL } from '../lib/format';

export function PageHeader({ pretitle, title, actions }: { pretitle?: ReactNode; title: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div>
          {pretitle && <div className="page-pretitle">{pretitle}</div>}
          <h1 className="page-title">{title}</h1>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function FormatTag({ format }: { format: BookFormat }) {
  return <span className={clsx('format-tag', format)}>{FORMAT_LABEL[format]}</span>;
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="reading-progress" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

/**
 * Cover art. Books imported from folders/Calibre have no cover yet, so fall back
 * to a typographic tile that reuses the .book-cover box (same 2:3 ratio + shadow).
 */
export function BookCover({ book, small }: { book: Pick<Book, 'title' | 'author' | 'cover'>; small?: boolean }) {
  const cls = clsx('book-cover', small && 'sm');
  if (book.cover) {
    return <img className={cls} src={book.cover} alt={small ? '' : `Cover of ${book.title} by ${book.author}`} width={480} height={720} loading="lazy" decoding="async" />;
  }
  return (
    <div className={cls} role="img" aria-label={`${book.title} by ${book.author}`}
      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: small ? 4 : 14, textAlign: 'center',
        background: 'linear-gradient(160deg, var(--primary-dk), #1e2633)', color: '#fff', overflow: 'hidden' }}>
      <strong style={{ fontSize: small ? 7 : 14, lineHeight: 1.2 }}>{book.title}</strong>
      {!small && <span style={{ fontSize: 11, opacity: 0.8, marginTop: 8 }}>{book.author}</span>}
    </div>
  );
}

export function StatCard({ icon, tone, label, value, sub }: { icon: ReactNode; tone: 'teal' | 'blue' | 'yellow' | 'green'; label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="stat">
        <div className={clsx('stat-icon', tone)}>{icon}</div>
        <div className="stat-content">
          <div className="stat-label">{label}</div>
          <div className="stat-value-row"><span className="stat-value">{value}</span></div>
          {sub && <div className="stat-subtext">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
