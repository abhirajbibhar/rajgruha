import { useEffect, useRef } from 'react';
import { api } from './api';
import { localDay } from './dates';

const IDLE_AFTER_S = 5 * 60; // stop counting after 5 minutes without any sign of life
const HEARTBEAT_MS = 30_000;
const MIN_SECONDS = 10; // don't record accidental opens

/**
 * Records reading time for the Reading log & analytics. Counts only seconds where the tab is visible
 * and the reader was recently active. `touch()` lets embedded readers (EPUB iframe) report activity
 * the parent document can't see. Sends a heartbeat every 30 s and a final keepalive on leave.
 */
export function useReadingSession(bookId: string | undefined, getPercent: () => number) {
  const touchRef = useRef<() => void>(() => undefined);
  const percentRef = useRef(getPercent);
  percentRef.current = getPercent;

  useEffect(() => {
    if (!bookId) return;
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const day = localDay();
    const startPercent = percentRef.current();
    let seconds = 0;
    let idle = 0;
    let sentSeconds = 0;

    const touch = () => { idle = 0; };
    touchRef.current = touch;

    const tick = setInterval(() => {
      idle++;
      if (document.visibilityState === 'visible' && idle <= IDLE_AFTER_S) seconds++;
    }, 1000);

    const send = (keepalive = false) => {
      if (seconds < MIN_SECONDS || seconds === sentSeconds) return;
      sentSeconds = seconds;
      void api
        .putSession(id, { bookId, day, startedAt, durationS: seconds, startPercent, endPercent: Math.round(percentRef.current() * 10) / 10 }, keepalive)
        .catch(() => { sentSeconds = 0; /* retry on next beat */ });
    };

    const beat = setInterval(() => send(), HEARTBEAT_MS);
    const onHide = () => send(true);
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send(true));

    return () => {
      clearInterval(tick);
      clearInterval(beat);
      events.forEach((e) => window.removeEventListener(e, touch));
      window.removeEventListener('pagehide', onHide);
      send(true);
    };
  }, [bookId]);

  return { touch: () => touchRef.current() };
}
