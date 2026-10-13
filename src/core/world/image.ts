// An entity's picture: a portrait of a character, a view of a place.
//
// It is optional. The note names it in its "image" property, as a link to an
// image file anywhere in the vault:
//
//   image: "[[mara.png]]"
//
// A link, so that Obsidian itself keeps it right when the picture is renamed
// or moved, and shows it in its own properties panel. What a writer types by
// hand is read as well: a path without brackets ("Pictures/mara.png"), an
// embed ("![[mara.png]]"), and a link the YAML was written without quotes for.
// Where the link leads is asked of the vault, never guessed. A picture that
// is not there, or is not a picture, is no picture: the screens then show the
// type's icon, as they do for an entity without one.
//
// Nothing here reads or writes a file.

import { baseName, isImagePath, pathKey } from '../paths';
import type { Frontmatter } from '../types';
import type { LinkResolver } from './links';
import { searchKey } from './browse';
import { IMAGE_KEY } from './types';

/** `[[mara.png]]` written in YAML without quotes arrives as a list in a list. */
function unwrap(value: unknown): unknown {
  let inner = value;
  for (let depth = 0; depth < 2 && Array.isArray(inner) && inner.length === 1; depth++) {
    const only: unknown = inner[0];
    if (depth === 1 && typeof only === 'string') return `[[${only}]]`;
    inner = only;
  }
  return value;
}

/**
 * What an entity's "image" property points at: what stands between the
 * brackets, without a shown name or a size ("mara.png", "Pictures/mara.png"),
 * or the path itself when it is written without brackets. Null when the note
 * names no picture.
 */
export function readImageTarget(frontmatter: Readonly<Frontmatter> | null | undefined): string | null {
  const raw = unwrap(frontmatter?.[IMAGE_KEY]);
  if (typeof raw !== 'string') return null;
  let inner = raw.trim();
  const bracketed = /^!?\[\[([\s\S]*)\]\]$/.exec(inner);
  if (bracketed) inner = (bracketed[1] ?? '').trim();
  else if (/[[\]|]/.test(inner)) return null;
  const bar = inner.indexOf('|');
  const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  return target === '' ? null : target;
}

/**
 * The picture an entity's note names, as a vault path; null when it names
 * none, or the link leads to no file, or to a file that is not a picture.
 *
 * @param from the vault path of the entity's note
 */
export function resolveImage(frontmatter: Readonly<Frontmatter> | null | undefined, from: string, resolve: LinkResolver): string | null {
  const target = readImageTarget(frontmatter);
  if (target === null) return null;
  const found = resolve(target, from);
  return found !== null && isImagePath(found) ? found : null;
}

/**
 * The link to write in the note at `from` so that it leads to a picture: its
 * file name alone when the vault takes that to the picture, or else its whole
 * path (another file of the same name is in the way).
 */
export function imageLink(imageVaultPath: string, from: string, resolve: LinkResolver): string {
  const name = baseName(imageVaultPath);
  const short = resolve(name, from);
  return `[[${short !== null && pathKey(short) === pathKey(imageVaultPath) ? name : imageVaultPath}]]`;
}

/**
 * Set an entity note's picture, in place, or take it away (null). No other
 * property is touched.
 *
 * @returns whether anything changed
 */
export function setImage(frontmatter: Frontmatter, link: string | null): boolean {
  if (link === null) {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, IMAGE_KEY)) return false;
    delete frontmatter[IMAGE_KEY];
    return true;
  }
  if (frontmatter[IMAGE_KEY] === link) return false;
  frontmatter[IMAGE_KEY] = link;
  return true;
}

/** The pictures of a list whose path has every word typed in the search box, in the order given. */
export function searchImages(paths: readonly string[], query: string): string[] {
  const words = searchKey(query).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [...paths];
  return paths.filter((path) => {
    const hay = searchKey(path);
    return words.every((word) => hay.includes(word));
  });
}
