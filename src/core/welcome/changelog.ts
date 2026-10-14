// The changelog, read: what changed in each version, for the short "What is
// new" note the plugin shows once after an update.
//
// The plugin ships the text of CHANGELOG.md (see
// src/features/welcome/bundledText.ts, which the build makes from it), so the note always says what the changelog says.
// A version is a level-two heading whose first word is a version number:
//
//   ## 1.1.0 (3 November 2026)
//
// Under it come paragraphs, "- " lists and "### " headings. Any other
// level-two heading ("## Unreleased") is not a version and is left out.

import { compareVersions, parseVersion } from './versions';

/** One piece of a version's notes. The text is plain: Markdown marks are taken out. */
export type NoteBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

/** What the changelog says about one version. */
export interface ChangelogEntry {
  /** As written in the heading, for example "1.1.0". */
  readonly version: string;
  /** What the heading says after the version, without brackets ("14 October 2026"), or null. */
  readonly date: string | null;
  readonly blocks: readonly NoteBlock[];
}

/**
 * Markdown made into plain text: links keep their words, and the marks for
 * bold, italics and code go. Underscores inside words stay.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(\S(?:[^*_]*\S)?)\1/g, '$2')
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every version the changelog describes, in the order it gives them (newest first, by its own rule). */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; date: string | null; blocks: NoteBlock[] } | null = null;
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const closeParagraph = (): void => {
    if (current && paragraph.length > 0) {
      const text = plainText(paragraph.join(' '));
      if (text !== '') current.blocks.push({ kind: 'paragraph', text });
    }
    paragraph = [];
  };
  const closeList = (): void => {
    if (current && list && list.length > 0) {
      current.blocks.push({ kind: 'list', items: list.map(plainText).filter((item) => item !== '') });
    }
    list = null;
  };
  const closeAll = (): void => {
    closeParagraph();
    closeList();
  };

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    const heading2 = /^##\s+(.*)$/.exec(line);
    if (heading2 && !line.startsWith('###')) {
      closeAll();
      if (current) entries.push(current);
      current = null;
      const title = (heading2[1] ?? '').trim();
      const first = title.split(/\s+/)[0] ?? '';
      if (parseVersion(first) !== null) {
        const rest = title.slice(first.length).trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '').trim();
        current = { version: first.replace(/^v/, ''), date: rest === '' ? null : rest, blocks: [] };
      }
      continue;
    }
    if (!current) continue;
    const heading3 = /^#{3,6}\s+(.*)$/.exec(line);
    if (heading3) {
      closeAll();
      const text = plainText(heading3[1] ?? '');
      if (text !== '') current.blocks.push({ kind: 'heading', text });
      continue;
    }
    const item = /^\s{0,3}[-*+]\s+(.*)$/.exec(line);
    if (item) {
      closeParagraph();
      list ??= [];
      list.push(item[1] ?? '');
      continue;
    }
    if (line.trim() === '') {
      closeAll();
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // A line that carries on the list item above it.
      list[list.length - 1] = `${list[list.length - 1] ?? ''} ${line.trim()}`;
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  closeAll();
  if (current) entries.push(current);
  return entries;
}

/**
 * The entries of the versions after `after` up to and including `upTo`,
 * newest first. With `after` null, only the entry of `upTo` itself.
 */
export function notesBetween(entries: readonly ChangelogEntry[], after: string | null, upTo: string): ChangelogEntry[] {
  const picked = entries.filter((entry) => {
    const toTop = compareVersions(entry.version, upTo);
    if (toTop === null || toTop > 0) return false;
    if (after === null) return toTop === 0;
    const toBottom = compareVersions(entry.version, after);
    return toBottom !== null && toBottom > 0;
  });
  return picked.sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}
