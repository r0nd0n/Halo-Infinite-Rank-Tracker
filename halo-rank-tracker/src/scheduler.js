/**
 * Daily scheduler. Runs the refresh at a fixed local time each day and also
 * whenever the app starts (the cache layer dedupes same-day runs).
 */

import { updateCache } from './update.js';

const MS_PER_MINUTE = 60 * 1000;

/** Milliseconds until the next occurrence of HH:MM local time. */
export function msUntil(hour, minute, from = new Date()) {
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next - from;
}

/**
 * Start the daily timer.
 * @param {object} opts
 * @param {number} opts.hour   local hour (0-23), default 6
 * @param {number} opts.minute local minute, default 0
 * @param {(r:object)=>void} opts.onRun
 */
export function startScheduler({ hour = 6, minute = 0, onRun, onProgress } = {}) {
  let timer = null;

  const scheduleNext = () => {
    const delay = msUntil(hour, minute);
    console.log(
      `Next automatic refresh in ${Math.round(delay / MS_PER_MINUTE)} min ` +
        `(daily at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}).`
    );
    timer = setTimeout(async () => {
      try {
        const result = await updateCache({ onProgress });
        console.log(`Scheduled refresh: ${result.reason}`);
        if (onRun) onRun(result);
      } catch (err) {
        console.error('Scheduled refresh failed:', err.message);
      } finally {
        scheduleNext();
      }
    }, delay);
    if (timer.unref) timer.unref();
  };

  scheduleNext();
  return () => timer && clearTimeout(timer);
}
