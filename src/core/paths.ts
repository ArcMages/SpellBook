// Small helpers for vault paths. Vault paths always use forward slashes and
// never start or end with one; the vault root is the empty string.

/** Join path parts with single slashes, skipping empty parts. */
export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment !== '')
    .join('/');
}

/** The folder a path sits in; "" for something in the vault root. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** The last part of a path. */
export function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/** A note's title: its file name without the ".md" ending. */
export function noteTitle(path: string): string {
  const name = baseName(path);
  return isMarkdownPath(name) ? name.slice(0, -3) : name;
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** True when `path` is somewhere below `folder`. The root ("") contains everything. */
export function isInside(folder: string, path: string): boolean {
  if (folder === '') return path !== '';
  return path.length > folder.length + 1 && path.startsWith(folder) && path[folder.length] === '/';
}

/** `path` relative to `folder`, or null when it is not inside it. */
export function relativeTo(folder: string, path: string): string | null {
  if (!isInside(folder, path)) return null;
  return folder === '' ? path : path.slice(folder.length + 1);
}

/**
 * Swap a leading folder for another: used when a folder is renamed.
 * Returns null when `path` is neither `oldFolder` nor inside it.
 */
export function replaceFolderPrefix(path: string, oldFolder: string, newFolder: string): string | null {
  if (path === oldFolder) return newFolder;
  const rest = relativeTo(oldFolder, path);
  return rest === null ? null : joinPath(newFolder, rest);
}

/**
 * Key for deciding whether two paths name the same file. Accented and pointed
 * letters (for example Hebrew with niqqud) can be stored in two equivalent
 * Unicode forms, and iCloud does not promise to keep the form it was given.
 */
export function pathKey(path: string): string {
  return path.normalize('NFC');
}

/**
 * Key for deciding whether a name would clash on disk. macOS, iOS and Windows
 * treat "Letter.md" and "letter.md" as the same file.
 */
export function clashKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * True for a tidy path that stays inside the project folder: not empty, not
 * absolute, no backslashes, and without empty, "." or ".." steps.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.trim() === '' || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Tidy a hand-written relative path ("./Manuscript//A.md" becomes
 * "Manuscript/A.md"). Returns null when the path cannot be trusted to stay
 * inside the project folder: empty, absolute, with a backslash, or with "..".
 */
export function normaliseRelativePath(raw: string): string | null {
  if (raw.startsWith('/') || raw.includes('\\')) return null;
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return null;
  const tidy = segments.join('/');
  return tidy.trim() === '' ? null : tidy;
}
