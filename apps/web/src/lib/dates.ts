const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD (what the API stores in reading_sessions.day). */
export const localDay = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localMonth = (d: Date = new Date()) => localDay(d).slice(0, 7);
export const parseDay = (day: string) => new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
export const addDays = (day: string, n: number) => { const d = parseDay(day); d.setDate(d.getDate() + n); return localDay(d); };
export const addMonths = (month: string, n: number) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1); return localMonth(d); };

export const monthLabel = (month: string) => parseDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
export const dayLabel = (day: string) => parseDay(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export const fmtMinutes = (m: number) => (m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${Math.round(m % 60)}m` : ''}`);
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Session length: seconds under a minute, otherwise minutes/hours. */
export const fmtSession = (seconds: number) => (seconds < 60 ? `${seconds}s` : fmtMinutes(Math.round(seconds / 60)));
