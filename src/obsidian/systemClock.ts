// The device's clock and timers, handed to the project store. The core never
// reads the clock itself, so that it can be tested with a fixed date.

import { formatLocalDate } from '../core/scene';

/** Today's date on this device, as YYYY-MM-DD in the local time zone. */
export function localToday(): string {
  return localDay(Date.now());
}

/** The date of a moment (milliseconds since 1970, as the clock gives them) on this device, as YYYY-MM-DD in the local time zone. */
export function localDay(time: number): string {
  const moment = new Date(time);
  return formatLocalDate(moment.getFullYear(), moment.getMonth() + 1, moment.getDate());
}

/** This moment, in milliseconds since 1970. */
export function nowMs(): number {
  return Date.now();
}

/** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
export function setTimer(callback: () => void, ms: number): () => void {
  const id = window.setTimeout(callback, ms);
  return () => {
    window.clearTimeout(id);
  };
}

/**
 * Call `callback` once, just before the screen is next drawn, with the time
 * in milliseconds. Returns a function that cancels it.
 */
export function nextFrame(callback: (time: number) => void): () => void {
  const id = window.requestAnimationFrame(callback);
  return () => {
    window.cancelAnimationFrame(id);
  };
}
