import { queryOptions } from '@tanstack/react-query';
import type { BookListQuery } from '@rajgruha/shared';
import { ApiError, api } from './api';

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: api.me,
  staleTime: 5 * 60_000,
  retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2
});

export const booksQuery = (q: Partial<BookListQuery>) =>
  queryOptions({ queryKey: ['books', q], queryFn: () => api.books(q), placeholderData: (prev) => prev });

export const bookQuery = (id: string) => queryOptions({ queryKey: ['book', id], queryFn: () => api.book(id) });

export const continueQuery = queryOptions({ queryKey: ['continue'], queryFn: api.continueReading });
export const statsQuery = queryOptions({ queryKey: ['stats'], queryFn: api.stats });

export const filesQuery = (prefix: string) => queryOptions({ queryKey: ['files', prefix], queryFn: () => api.files(prefix) });
export const monthLogQuery = (month: string) => queryOptions({ queryKey: ['log', 'month', month], queryFn: () => api.logMonth(month) });
export const dayLogQuery = (day: string) => queryOptions({ queryKey: ['log', 'day', day], queryFn: () => api.logDay(day) });
export const analyticsQuery = (days: number, today: string) =>
  queryOptions({ queryKey: ['analytics', days, today], queryFn: () => api.analytics(days, today) });

export const facetsQuery = queryOptions({ queryKey: ['facets'], queryFn: api.facets, staleTime: 60_000 });
export const membersQuery = queryOptions({ queryKey: ['members'], queryFn: api.members });
export const acquisitionsQuery = queryOptions({ queryKey: ['acquisitions'], queryFn: api.acquisitions });
