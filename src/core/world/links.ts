// Scene links: which entities are in a scene (or in a timeline event).
//
// One convention, for scenes and events alike: the note lists them in its
// "entities" property, as links to the entity notes.
//
//   entities:
//     - "[[Mara]]"
//     - "[[Saltwick]]"
//
// They are ordinary Obsidian links, so Obsidian itself keeps them right when
// an entity note is renamed, and shows them in its own properties panel.
// Where a link leads is asked of the vault (a LinkResolver), never guessed
// from the name. An entity that is only mentioned in the text is not linked.
//
// Nothing here reads or writes a file: the two functions that change a list
// are given the note's properties, inside the store's read-change-save step.

import { pathKey } from '../paths';
import type { Frontmatter } from '../types';
import type { Entity } from './entity';
import { ENTITIES_KEY } from './types';

/**
 * Where a link leads: the vault path of the note it points at, or null.
 *
 * @param target what stands between the brackets, without heading or shown name
 * @param from   the vault path of the note the link is written in
 */
export type LinkResolver = (target: string, from: string) => string | null;

/** A link as it is written in a property. */
export interface WrittenLink {
  /** What it points at: a note's name or its path, without ".md" as a rule. */
  readonly target: string;
  /** The name it shows: what comes after the bar, or else the last step of the target. */
  readonly label: string;
}

/**
 * Read one entry of an "entities" list: "[[Mara]]", "[[World/Characters/Mara|Mara]]",
 * "[[Mara#Background]]". A bare name without brackets ("Mara"), as a writer
 * may type by hand, is read as a link to the note of that name. Null for
 * anything else.
 */
export function parseLink(value: unknown): WrittenLink | null {
  if (typeof value !== 'string') return null;
  let inner = value.trim();
  const bracketed = /^\[\[([\s\S]*)\]\]$/.exec(inner);
  if (bracketed) inner = (bracketed[1] ?? '').trim();
  else if (/[[\]|]/.test(inner)) return null;
  const bar = inner.indexOf('|');
  const shown = bar < 0 ? '' : inner.slice(bar + 1).trim();
  let target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const hash = target.indexOf('#');
  if (hash >= 0) target = target.slice(0, hash).trim();
  if (target === '') return null;
  const last = target.split('/').pop() ?? target;
  return { target, label: shown !== '' ? shown : last.replace(/\.md$/i, '') };
}

/** The entries of a note's "entities" property, as they are written. One text is a list of one. */
export function readEntityLinks(frontmatter: Readonly<Frontmatter> | null | undefined): string[] {
  const raw: unknown = frontmatter?.[ENTITIES_KEY];
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/** The link to write for a note of this name: "[[Mara]]". */
export function nameLink(name: string): string {
  return `[[${name}]]`;
}

/** The link to write when the name alone would lead elsewhere: the whole path, shown as the name. */
export function pathLink(vaultPath: string, name: string): string {
  return `[[${vaultPath.replace(/\.md$/i, '')}|${name}]]`;
}

/**
 * The link to write in the note at `from` so that it leads to an entity: its
 * name alone when the vault takes that to the entity's note, or else its
 * whole path (another note of the same name is in the way).
 */
export function linkTo(name: string, entityVaultPath: string, from: string, resolve: LinkResolver): string {
  const short = resolve(name, from);
  return short !== null && pathKey(short) === pathKey(entityVaultPath) ? nameLink(name) : pathLink(entityVaultPath, name);
}

/** What changing a note's list of entities came to. */
export type LinkChange = 'changed' | 'unchanged' | 'unreadable';

/**
 * Whether an "entities" property can be changed: nothing, one text, or a
 * list. Anything else was not written by this plugin and is left alone.
 */
function listOf(frontmatter: Frontmatter): unknown[] | null {
  const raw: unknown = frontmatter[ENTITIES_KEY];
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw];
  return Array.isArray(raw) ? raw : null;
}

/**
 * Add a link to a note's "entities" property, in place, at the end of the
 * list. Nothing changes when the list already has a link that leads to the
 * same note.
 *
 * @param link    the link to write, for example what linkTo gives
 * @param leadsTo whether an entry that is already there leads to the same note
 */
export function addEntityLink(frontmatter: Frontmatter, link: string, leadsTo: (entry: string) => boolean): LinkChange {
  const list = listOf(frontmatter);
  if (list === null) return 'unreadable';
  if (list.some((entry) => typeof entry === 'string' && (entry === link || leadsTo(entry)))) return 'unchanged';
  frontmatter[ENTITIES_KEY] = [...list, link];
  return 'changed';
}

/**
 * Take links out of a note's "entities" property, in place: every entry
 * `leadsTo` says yes to. The other entries stay as they are written, in
 * order. A list that comes out empty is taken away with its key.
 */
export function removeEntityLink(frontmatter: Frontmatter, leadsTo: (entry: string) => boolean): LinkChange {
  const list = listOf(frontmatter);
  if (list === null) return 'unreadable';
  const kept = list.filter((entry) => !(typeof entry === 'string' && leadsTo(entry)));
  if (kept.length === list.length) return 'unchanged';
  if (kept.length === 0) delete frontmatter[ENTITIES_KEY];
  else frontmatter[ENTITIES_KEY] = kept;
  return 'changed';
}

// ------------------------------------------------------------ the whole world

/** A scene or a timeline event, as the links are worked out from it. */
export interface LinkingNote {
  /** Path relative to the project folder. */
  readonly path: string;
  /** Where the note is in the vault; null for a scene whose note is missing. */
  readonly vaultPath: string | null;
  readonly title: string;
  readonly frontmatter: Readonly<Frontmatter> | null;
}

/** One entry of a note's "entities" list, with where it leads. */
export interface NoteLink {
  /** The entry exactly as it is written: what it is removed by. */
  readonly raw: string;
  /** The name to show: the entity's, or else what the link says. */
  readonly label: string;
  /** The entity it leads to; null for a link that leads to no entity (a broken link, or one to another kind of note). */
  readonly entity: Entity | null;
}

/** A scene or an event an entity is in. */
export interface Appearance {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
}

/** Who is where: the links of a project, both ways round. */
export interface WorldLinks {
  /** The entries of a scene's or an event's list, in the order they are written. */
  linksOf(notePath: string): readonly NoteLink[];
  /** The scenes an entity is in, in binder order. */
  scenesOf(entityPath: string): readonly Appearance[];
  /** The timeline events an entity is in, in the order they were given. */
  eventsOf(entityPath: string): readonly Appearance[];
}

export interface WorldSources {
  readonly entities: readonly Entity[];
  /** Where each entity's note is in the vault. */
  readonly entityVaultPath: (entityPath: string) => string | null;
  /** The scenes of the binder, in binder order. */
  readonly scenes: readonly LinkingNote[];
  /** The timeline's events. */
  readonly events: readonly LinkingNote[];
  readonly resolve: LinkResolver;
}

const NONE: readonly never[] = Object.freeze([]);

/**
 * Work out every link of a project once: which entities each scene and event
 * lists, and from that the scenes and events of each entity. A note that
 * lists the same entity twice counts once.
 */
export function buildWorldLinks(sources: WorldSources): WorldLinks {
  const byVaultPath = new Map<string, Entity>();
  for (const entity of sources.entities) {
    const vaultPath = sources.entityVaultPath(entity.path);
    if (vaultPath !== null) byVaultPath.set(pathKey(vaultPath), entity);
  }

  const links = new Map<string, NoteLink[]>();
  const scenes = new Map<string, Appearance[]>();
  const events = new Map<string, Appearance[]>();

  const read = (notes: readonly LinkingNote[], into: Map<string, Appearance[]>): void => {
    for (const note of notes) {
      const entries: NoteLink[] = [];
      const counted = new Set<string>();
      for (const raw of readEntityLinks(note.frontmatter)) {
        const written = parseLink(raw);
        const found = written === null || note.vaultPath === null ? null : sources.resolve(written.target, note.vaultPath);
        const entity = found === null ? null : (byVaultPath.get(pathKey(found)) ?? null);
        entries.push({ raw, label: entity?.name ?? written?.label ?? raw, entity });
        if (entity === null || counted.has(entity.path)) continue;
        counted.add(entity.path);
        const list = into.get(pathKey(entity.path)) ?? [];
        list.push({ path: note.path, title: note.title });
        into.set(pathKey(entity.path), list);
      }
      if (entries.length > 0) links.set(pathKey(note.path), entries);
    }
  };
  read(sources.scenes, scenes);
  read(sources.events, events);

  return {
    linksOf: (notePath) => links.get(pathKey(notePath)) ?? NONE,
    scenesOf: (entityPath) => scenes.get(pathKey(entityPath)) ?? NONE,
    eventsOf: (entityPath) => events.get(pathKey(entityPath)) ?? NONE,
  };
}
