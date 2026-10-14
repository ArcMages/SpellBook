// Every notice about a problem stays up for the same time.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFUSED_NOTICE_MS } from '../src/features/modes/chrome';
import { PROBLEM_NOTICE_MS as AI_HELPER_NOTICE_MS } from '../src/features/aihelper/index';
import { PROBLEM_NOTICE_MS } from '../src/ui/notices';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('the length of a problem notice', () => {
  it('is 10 seconds, everywhere', () => {
    expect(PROBLEM_NOTICE_MS).toBe(10000);
    expect(REFUSED_NOTICE_MS).toBe(PROBLEM_NOTICE_MS);
    expect(AI_HELPER_NOTICE_MS).toBe(PROBLEM_NOTICE_MS);
  });

  it('is set in one place only', () => {
    const own = sourceFiles(src).filter((file) => /\bconst PROBLEM_NOTICE_MS\s*=/.test(readFileSync(file, 'utf8')));
    expect(own.map((file) => path.relative(src, file))).toEqual([path.join('ui', 'notices.ts')]);
  });
});
