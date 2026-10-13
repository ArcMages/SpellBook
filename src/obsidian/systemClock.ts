// The device's clock and timers, handed to the project store. The core never
// reads the clock itself, so that it can be tested with a fixed date.

import { formatLocalDate } from '../core/scene';

/** Today's date on this device, as YYYY-MM-DD in the local time zone. */
export function localToday(): string {
  const now = new Date();
  return formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
export function setTimer(callback: () => void, ms: number): () => void {
  const id = window.setTimeout(callback, ms);
  return () => {
    window.clearTimeout(id);
  };
}
