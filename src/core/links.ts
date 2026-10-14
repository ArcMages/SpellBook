// Links in a note's text, and pointing them at a note that was renamed.
//
// When an entity's note is renamed, Spellbook brings the links to it up to
// date itself, rather than leaving it to the vault: the vault does it only
// when the writer has told Obsidian to "Always update internal links", and
// otherwise stops to ask, which left a rename half done. Only the part of a
// link that names the note changes; a heading ("#Youth"), a block and what a
// link shows ("|the keeper") stay exactly as they are written:
//
//   [[Mara]]                    -> [[Mara Voss]]
//   [[World/Characters/Mara|M]] -> [[World/Characters/Mara Voss|M]]
//   ![[Mara#Youth]]             -> ![[Mara Voss#Youth]]
//   [the keeper](Mara.md)       -> [the keeper](Mara%20Voss.md)
//
// Links inside code ("`[[Mara]]`", or between ``` or ~~~ lines) are not links, and
// are left alone, as Obsidian leaves them.

/**
 * Where the links to a note that Spellbook renames or moves are brought up
 * to date: in the notes and boards of the open project only, or in every
 * note and board of the vault.
 */
export type LinkScope = 'project' | 'vault';

/** Where a link names its note, in a text. */
export interface LinkPlace {
  /** The stretch of the text that names the note, without a heading, a block or a shown text. */
  readonly from: number;
  readonly to: number;
  /** The note it names, as the vault reads it ("World/Characters/Mara", "Mara.md"). */
  readonly path: string;
  /** A wikilink ("[[Mara]]") or a markdown link ("[the keeper](Mara.md)"). */
  readonly kind: 'wiki' | 'markdown';
  /** For a markdown link: whether its address is written between "<" and ">" (and may hold spaces as they are). */
  readonly angle: boolean;
}

/** The stretches of a text that are code, where nothing is a link. */
function codeStretches(text: string): Array<{ from: number; to: number }> {
  const stretches: Array<{ from: number; to: number }> = [];
  const code = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`/g;
  let found: RegExpExecArray | null;
  while ((found = code.exec(text)) !== null) {
    if (found[0].length === 0) {
      code.lastIndex++;
      continue;
    }
    stretches.push({ from: found.index, to: found.index + found[0].length });
  }
  return stretches;
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Whether a markdown link's address leads out of the vault ("https://…", "mailto:…") or within the note itself ("#…"). */
function isExternal(address: string): boolean {
  return address === '' || address.startsWith('#') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(address);
}

/** Every link in a text, in order, with the stretch that names its note. */
export function linkPlaces(text: string): LinkPlace[] {
  const code = codeStretches(text);
  const inCode = (at: number): boolean => code.some((stretch) => at >= stretch.from && at < stretch.to);
  const places: LinkPlace[] = [];

  const wiki = /\[\[([^\]\n]*)\]\]/g;
  let found: RegExpExecArray | null;
  while ((found = wiki.exec(text)) !== null) {
    if (inCode(found.index)) continue;
    const inner = found[1] ?? '';
    const start = found.index + 2;
    let end = inner.length;
    for (const stop of ['|', '#', '^']) {
      const at = inner.indexOf(stop);
      if (at >= 0 && at < end) end = at;
    }
    // In a table, the bar that starts what a link shows is written "\|".
    if (end > 0 && inner.charAt(end - 1) === '\\' && inner.charAt(end) === '|') end--;
    const raw = inner.slice(0, end);
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const lead = raw.length - raw.trimStart().length;
    places.push({ from: start + lead, to: start + lead + trimmed.length, path: trimmed, kind: 'wiki', angle: false });
  }

  const markdown = /\[[^\]\n]*\]\(([^)\n]*)\)/g;
  while ((found = markdown.exec(text)) !== null) {
    if (inCode(found.index)) continue;
    const address = found[1] ?? '';
    const open = found.index + found[0].length - 1 - address.length;
    const lead = address.length - address.trimStart().length;
    const rest = address.slice(lead);
    let start = open + lead;
    let raw: string;
    let angle = false;
    if (rest.startsWith('<')) {
      const close = rest.indexOf('>');
      if (close < 0) continue;
      angle = true;
      start++;
      raw = rest.slice(1, close);
    } else {
      // A title may follow the address, after a space: (Mara.md "Mara").
      // Anything else after a space means the address itself holds a bare
      // space ("Mara notes.md"): not the link to "Mara", so left alone.
      const space = rest.search(/\s/);
      if (space >= 0 && !/^\s+(?:"[^"]*"|'[^']*'|\([^)]*\)?)\s*$/.test(rest.slice(space))) continue;
      raw = space < 0 ? rest : rest.slice(0, space);
    }
    const hash = raw.indexOf('#');
    if (hash >= 0) raw = raw.slice(0, hash);
    if (isExternal(raw)) continue;
    places.push({ from: start, to: start + raw.length, path: decoded(raw), kind: 'markdown', angle });
  }

  return places.sort((a, b) => a.from - b.from);
}

/** How a path is written in a markdown link: spaces as "%20", unless the address is between "<" and ">". */
function writtenFor(place: LinkPlace, path: string): string {
  if (place.kind === 'wiki' || place.angle) return path;
  return path.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * A text with some of its links pointed elsewhere. `retarget` is asked about
 * each link's note, as the link names it, and gives the path it is to name
 * now, or null to leave that link as it is. Nothing but the stretches that
 * name a note changes.
 */
export function retargetLinks(text: string, retarget: (path: string) => string | null): { readonly text: string; readonly count: number } {
  let result = '';
  let at = 0;
  let count = 0;
  for (const place of linkPlaces(text)) {
    const next = retarget(place.path);
    if (next === null || next === place.path) continue;
    result += text.slice(at, place.from) + writtenFor(place, next);
    at = place.to;
    count++;
  }
  return count === 0 ? { text, count } : { text: result + text.slice(at), count };
}

/** Every string inside a properties value (lists and nested objects included), with its links pointed elsewhere (see retargetLinks); how many links changed. */
export function retargetLinksInValue(value: unknown, retarget: (path: string) => string | null): { readonly value: unknown; readonly count: number } {
  if (typeof value === 'string') {
    const { text, count } = retargetLinks(value, retarget);
    return { value: text, count };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const items = value.map((item) => {
      const changed = retargetLinksInValue(item, retarget);
      count += changed.count;
      return changed.value;
    });
    return { value: count === 0 ? value : items, count };
  }
  if (typeof value === 'object' && value !== null) {
    let count = 0;
    const entries = Object.entries(value).map(([key, item]) => {
      const changed = retargetLinksInValue(item, retarget);
      count += changed.count;
      return [key, changed.value] as const;
    });
    return { value: count === 0 ? value : Object.fromEntries(entries), count };
  }
  return { value, count: 0 };
}

/** The last part of a path ("World/Mara.md" -> "Mara.md"). */
function lastPart(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * How a link is to name a note (or another file) that was renamed or moved,
 * written the way the link was: "Mara" stays a bare name ("Mara Voss"), a
 * path stays a path of as many steps ("Characters/Mara" -> "People/Mara"),
 * and a ".md" ending is written only where it was. The
 * first way that `resolves` (asked with the link as it would be written,
 * from where the link is) says leads to the file is taken; when none does,
 * the file's whole vault path.
 *
 * @param linkPath the note as the link names it now ("Mara", "World/Mara.md")
 * @param newPath the file's new vault path ("Novel/World/Mara Voss.md")
 */
export function movedLinkPath(linkPath: string, newPath: string, resolves: (candidate: string) => boolean): string {
  const note = /\.md$/i.test(newPath);
  // A note's ending is written only where the link wrote it; any other file's always.
  const keepEnding = !note || /\.md$/i.test(linkPath);
  const name = keepEnding ? lastPart(newPath) : lastPart(newPath).replace(/\.md$/i, '');
  const whole = keepEnding ? newPath : newPath.replace(/\.md$/i, '');
  const slash = linkPath.lastIndexOf('/');
  const candidates: string[] = [];
  if (slash < 0) candidates.push(name);
  else {
    // The same folders as before (a rename where it is), or else as many steps of the new path as the link had.
    candidates.push(`${linkPath.slice(0, slash + 1)}${name}`);
    const steps = linkPath.split('/').length;
    const parts = whole.split('/');
    if (parts.length > steps) candidates.push(parts.slice(-steps).join('/'));
  }
  for (const candidate of candidates) {
    if (resolves(candidate)) return candidate;
  }
  return whole;
}

/** Where every file inside a moved folder (or the moved file itself) lands: old vault path -> new vault path. */
export function movedPaths(from: string, to: string, files: readonly string[]): Map<string, string> {
  const moved = new Map<string, string>();
  for (const file of files) {
    if (file === from) moved.set(file, to);
    else if (file.startsWith(`${from}/`)) moved.set(file, `${to}${file.slice(from.length)}`);
  }
  return moved;
}
