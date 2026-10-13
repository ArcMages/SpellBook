// Entities on events: the people, places and things an event involves.
//
// An entity is a note in the project's World folder. An event (or a scene)
// names its entities in a property of its own, as links:
//
//   entities: ["[[Mara]]", "[[Saltwick]]"]
//
// Only that convention is known here: what an entity note holds is another
// part of the plugin's business. A link is matched to a note of the World
// folder by its name or by the end of its path, whatever its capitals. A link
// that matches none is still shown, by the name it gives, so that an entity
// whose note has not synced yet (or was renamed) does not vanish.

import { clashKey, noteTitle } from './../paths';
import { isRecord } from './common';
import type { FrontmatterPatch } from './common';
import { createSceneResolver, linkTarget, linkTexts } from './events';
import type { TimelineEvent } from './events';

/** The folder of a project that holds one note per entity. */
export const WORLD_FOLDER = 'World';

/** The property of an event or a scene that lists its entities. */
export const ENTITIES_KEY = 'entities';

/** One entity an event names. */
export interface EventEntity {
  /** What entities are compared by: the same for every link that points at the same note. */
  readonly key: string;
  /** The name to show: the note's title, or what the link says when no note matches. */
  readonly name: string;
  /** The note's path as it was given, or null when no note of the World folder matches. */
  readonly path: string | null;
}

/** The notes of the World folder, and what links to them resolve to. */
export interface EntityIndex {
  /** Every entity note, sorted by name. */
  readonly all: readonly EventEntity[];
  /** The entity a link target ("Mara", "World/Mara") points at; an entity without a note when none matches. */
  resolve(target: string): EventEntity;
  /** The link to write in a note for an entity, by its key: "[[Mara]]". Null for a key no note has. */
  linkFor(key: string): string | null;
}

function lastPart(target: string): string {
  const parts = target.split('/').filter((part) => part.trim() !== '');
  const last = (parts[parts.length - 1] ?? target).trim();
  return last.toLowerCase().endsWith('.md') && last.length > 3 ? last.slice(0, -3) : last;
}

/**
 * Index the notes of the World folder.
 *
 * @param worldPaths the paths of the notes in the World folder, written the same way everywhere
 */
export function createEntityIndex(worldPaths: readonly string[]): EntityIndex {
  const find = createSceneResolver(worldPaths);
  const byKey = new Map<string, EventEntity>();
  const nameCount = new Map<string, number>();
  for (const path of worldPaths) {
    const key = `note:${clashKey(path)}`;
    if (byKey.has(key)) continue;
    const name = noteTitle(path);
    byKey.set(key, { key, name, path });
    nameCount.set(clashKey(name), (nameCount.get(clashKey(name)) ?? 0) + 1);
  }
  const all = [...byKey.values()].sort((a, b) => {
    const first = clashKey(a.name);
    const second = clashKey(b.name);
    return first < second ? -1 : first > second ? 1 : (a.path ?? '') < (b.path ?? '') ? -1 : 1;
  });
  return {
    all,
    resolve: (target) => {
      const path = find(target);
      const found = path === null ? undefined : byKey.get(`note:${clashKey(path)}`);
      if (found !== undefined) return found;
      const name = lastPart(target);
      return { key: `name:${clashKey(name)}`, name, path: null };
    },
    linkFor: (key) => {
      const entity = byKey.get(key);
      if (entity === undefined || entity.path === null) return null;
      // A name two notes share is told apart by where the note is.
      if ((nameCount.get(clashKey(entity.name)) ?? 0) <= 1) return `[[${entity.name}]]`;
      const at = entity.path.toLowerCase().lastIndexOf(`${WORLD_FOLDER.toLowerCase()}/`);
      const from = at >= 0 ? entity.path.slice(at) : entity.path;
      return `[[${from.toLowerCase().endsWith('.md') ? from.slice(0, -3) : from}]]`;
    },
  };
}

/** The entities an event names, each once, in the order the note lists them. */
export function eventEntities(event: TimelineEvent, index: EntityIndex): EventEntity[] {
  const found: EventEntity[] = [];
  const seen = new Set<string>();
  for (const target of event.entities) {
    const entity = index.resolve(target);
    if (seen.has(entity.key)) continue;
    seen.add(entity.key);
    found.push(entity);
  }
  return found;
}

/** True when an event names at least one of the entities wanted (by key). With none wanted, every event passes. */
export function eventHasEntity(event: TimelineEvent, wanted: ReadonlySet<string>, index: EntityIndex): boolean {
  if (wanted.size === 0) return true;
  return event.entities.some((target) => wanted.has(index.resolve(target).key));
}

const isLink = (text: string): boolean => /^!?\[\[.*\]\]$/.test(text) || /^\[[^\]]*\]\(.+\)$/.test(text);

/**
 * The change that makes a note name exactly the entities wanted.
 *
 * An entity the note names already keeps its link as it is written (an alias
 * and all) and its place; one that is no longer wanted is taken out; a new
 * one is added at the end as a plain link, "[[Mara]]". Only "entities" is
 * ever named, and only when the list really changes.
 *
 * @param frontmatter the note's properties as they are now
 * @param wanted      the keys of the entities the note should name
 */
export function setEntitiesPatch(frontmatter: unknown, wanted: readonly string[], index: EntityIndex): FrontmatterPatch {
  const properties = isRecord(frontmatter) ? frontmatter : {};
  const current = properties[ENTITIES_KEY];
  const want = new Set(wanted);
  const next: string[] = [];
  const have = new Set<string>();
  for (const text of linkTexts(current)) {
    const written = text.trim();
    const target = linkTarget(written);
    if (target === null) continue;
    const entity = index.resolve(target);
    if (!want.has(entity.key) || have.has(entity.key)) continue;
    have.add(entity.key);
    next.push(isLink(written) ? written : `[[${written}]]`);
  }
  for (const key of wanted) {
    if (have.has(key)) continue;
    const link = index.linkFor(key);
    if (link === null) continue;
    have.add(key);
    next.push(link);
  }
  const absent = current === undefined || current === null;
  if (absent && next.length === 0) return {};
  if (Array.isArray(current) && JSON.stringify(current) === JSON.stringify(next)) return {};
  return { [ENTITIES_KEY]: next };
}
