import { Link } from '@tanstack/react-router';
import type { Book } from '@rajgruha/shared';
import { compact } from '../lib/format';
import { BookCover, FormatTag, ProgressBar } from './ui';

export function BookCard({ book }: { book: Book }) {
  const p = book.progress;
  const cta = p?.status === 'reading' ? 'Continue reading' : 'Read now';
  const left = p ? Math.round(p.percent) : 0;
  return (
    <article className="book-card">
      <Link className="book-card-art" to="/books/$bookId" params={{ bookId: book.slug }} aria-label={`Open ${book.title}`}>
        <BookCover book={book} />
        <span className="book-card-cta">{cta}</span>
      </Link>
      <div className="book-card-body">
        <Link className="book-title" to="/books/$bookId" params={{ bookId: book.slug }}>{book.title}</Link>
        <div className="book-author">{book.author}</div>
        <div className="book-card-foot">
          <span className="book-rating">★ {book.rating.toFixed(1)} <span className="count">{compact(book.ratingCount)}</span></span>
          <FormatTag format={book.format} />
        </div>
        {p?.status === 'reading' && (
          <div className="book-card-progress">
            <ProgressBar percent={p.percent} />
            <div className="continue-sub"><span>{left}% read</span></div>
          </div>
        )}
        {p?.status === 'finished' && <div className="book-card-status finished"><span className="dot" /> Finished</div>}
        {p?.status === 'queued' && <div className="book-card-status queued"><span className="dot" /> Want to read</div>}
      </div>
    </article>
  );
}
