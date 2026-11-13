export const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);

export const FORMAT_LABEL = { epub: 'EPUB', pdf: 'PDF', audio: 'Audio' } as const;
