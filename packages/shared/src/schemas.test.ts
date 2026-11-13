import { describe, expect, it } from 'vitest';
import { BookInput, BookListQuery } from './index';

describe('shared schemas', () => {
  it('BookInput applies defaults', () => {
    const b = BookInput.parse({ slug: 'a-b', title: 'A', author: 'B', format: 'epub' });
    expect(b).toMatchObject({ language: 'en', genres: [], toc: [], rating: 0 });
  });

  it('BookListQuery applies defaults and coerces query-string numbers', () => {
    const q = BookListQuery.parse({ page: '2' });
    expect(q).toMatchObject({ page: 2, pageSize: 24, sort: 'recent' });
  });
});
