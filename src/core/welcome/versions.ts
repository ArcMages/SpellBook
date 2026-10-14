// Version numbers as the plugin's manifest and the changelog write them:
// "1.1.0", "0.9.0", or with a pre-release part, "1.1.0-beta.2".

/** A version taken apart: three numbers, and the pre-release part (empty when there is none). */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The words after "-", split at the dots: ["beta", "2"]. Empty for a release. */
  readonly pre: readonly string[];
}

const PATTERN = /^v?(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]+))?$/;

/** A version read from text, or null when the text is not one. "1.1" is read as "1.1.0". */
export function parseVersion(text: unknown): Version | null {
  if (typeof text !== 'string') return null;
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split('.').filter((part) => part !== ''),
  };
}

function comparePre(a: readonly string[], b: readonly string[]): number {
  // A release comes after every pre-release of the same numbers.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  for (let at = 0; at < Math.max(a.length, b.length); at++) {
    const x = a[at];
    const y = b[at];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumber = /^\d+$/.test(x);
    const yNumber = /^\d+$/.test(y);
    if (xNumber && yNumber) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    } else if (xNumber !== yNumber) {
      return xNumber ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Which of two versions is later: -1 when `a` comes before `b`, 1 when after,
 * 0 when they are the same. Null when either is not a version.
 */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const [p, q] of [
    [x.major, y.major],
    [x.minor, y.minor],
    [x.patch, y.patch],
  ] as const) {
    if (p !== q) return p < q ? -1 : 1;
  }
  const pre = comparePre(x.pre, y.pre);
  return pre < 0 ? -1 : pre > 0 ? 1 : 0;
}
