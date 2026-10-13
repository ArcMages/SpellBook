// How numbers and dates read on screen. The interface is English, so these do
// not follow the device's language: the same text on every device.

import { isDateText } from './../dates';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A whole number with thousands separators: 1234567 becomes "1,234,567" and
 * -1200 becomes "-1,200". Fractions are rounded; anything that is not a
 * number reads as "0".
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const whole = Math.round(value);
  const digits = String(Math.abs(whole));
  // Numbers too large to be written out digit by digit are left as they are.
  if (!/^\d+$/.test(digits)) return String(whole);
  let grouped = '';
  for (let end = digits.length; end > 0; end -= 3) {
    const group = digits.slice(Math.max(0, end - 3), end);
    grouped = grouped === '' ? group : `${group},${grouped}`;
  }
  return whole < 0 ? `-${grouped}` : grouped;
}

/**
 * A date written as YYYY-MM-DD, as it reads on screen: "13 Oct 2026".
 * Null when the text is not a real date.
 */
export function formatDisplayDate(date: string): string | null {
  if (!isDateText(date)) return null;
  const month = MONTH_NAMES[Number(date.slice(5, 7)) - 1];
  if (month === undefined) return null;
  return `${Number(date.slice(8, 10))} ${month} ${Number(date.slice(0, 4))}`;
}
