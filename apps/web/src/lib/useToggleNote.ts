import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DayLog } from '@rajgruha/shared';
import { api } from './api';

/** Ticks a task instantly (optimistic) and rolls back if the API call fails. */
export function useToggleNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.patchNote(id, { done }),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: ['log', 'day'] });
      const previous = qc.getQueriesData<DayLog>({ queryKey: ['log', 'day'] });
      qc.setQueriesData<DayLog>({ queryKey: ['log', 'day'] }, (d) => d && { ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, done } : n)) });
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['log'] })
  });
}
