// Relations: which entities an entity has to do with, and how.
//
// An entity note lists them in its "related" property. Each entry is a link
// to the other entity's note; the short label ("sister", "keeps") is the
// name the link shows:
//
//   related:
//     - "[[Tamar|sister]]"
//     - "[[Saltwick]]"
//
// Each entry is one ordinary Obsidian link and nothing else, so that
// Obsidian itself keeps it right when the other note is renamed, and shows
// it in its own properties panel. What a writer may type by hand is read as
// well: the label after the link ("[[Tamar]] | sister", "[[Tamar]] - sister",
// "[[Tamar]]: sister") and a bare name ("Tamar | sister").
//
// A relation is written on one side only. The other side shows it too, as
// "mentioned by", worked out from the notes that list it: nothing is ever
// written into the other note.
//
// Nothing here reads or writes a file: the functions that change a list are
// given the note's properties, inside the store's read-change-save step.

import { pathKey } from '../paths';
import type { Frontmatter } from '../types';
import type { Entity } from './entity';
import { parseLink } from './links';
import type { LinkChange, LinkResolver } from './links';
import { OTHER_NAME, OTHER_TYPE } from './browse';
import { RELATED_KEY, findType } from './types';
import type { EntityType } from './types';

/** No label is longer than this many characters. */
export const RELATION_LABEL_MAX = 60;

/** An entry of a "related" list, as it is written. */
export interface WrittenRelation {
  /** What the link points at: a note's name or its path. */
  readonly target: string;
  /** How the two have to do with each other; "" when the entry does not say. */
  readonly label: string;
}

/** A label as it is stored: on one line, without the characters a link is written with. */
export function tidyLabel(label: string): string {
  return label
    .replace(/[[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, RELATION_LABEL_MAX)
    .trim();
}

/** The last step of a link's target, without ".md": what the link shows when it shows no other name. */
function lastStep(target: string): string {
  return (target.split('/').pop() ?? target).replace(/\.md$/i, '');
}

/**
 * Read one entry of a "related" list. The label is what the link shows
 * ("[[Tamar|sister]]"), unless that is only the note's own name (a link
 * written with its whole path, "[[World/Characters/Tamar|Tamar]]"); a label
 * written after the link wins over both. Null for what is not a link.
 */
export function parseRelation(value: unknown): WrittenRelation | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const linked = /^(\[\[[^\]]*\]\])\s*(?:[|:–—-]\s*)?([\s\S]*)$/.exec(text);
  let after = '';
  let link = text;
  if (linked) {
    link = linked[1] ?? '';
    after = linked[2] ?? '';
  } else {
    // A bare name, typed by hand: "Tamar", "Tamar | sister".
    const bar = text.indexOf('|');
    if (bar >= 0) {
      link = text.slice(0, bar);
      after = text.slice(bar + 1);
    }
  }
  const written = parseLink(link);
  if (written === null) return null;
  const shown = written.label === lastStep(written.target) ? '' : written.label;
  return { target: written.target, label: tidyLabel(after) || tidyLabel(shown) };
}

/** The entry to write for a link target and a label: "[[Tamar|sister]]", "[[Tamar]]". */
export function writeRelation(target: string, label: string): string {
  const tidy = tidyLabel(label);
  if (tidy !== '') return `[[${target}|${tidy}]]`;
  // A link by its whole path shows the note's name, as an entry of a scene's list does.
  return target.includes('/') ? `[[${target}|${lastStep(target)}]]` : `[[${target}]]`;
}

/**
 * The entry to write in the note at `from` so that it leads to an entity:
 * by its name alone when the vault takes that to the entity's note, or else
 * by its whole path (another note of the same name is in the way).
 */
export function relationTo(name: string, entityVaultPath: string, from: string, resolve: LinkResolver, label: string): string {
  const short = resolve(name, from);
  const direct = short !== null && pathKey(short) === pathKey(entityVaultPath);
  return writeRelation(direct ? name : entityVaultPath.replace(/\.md$/i, ''), label);
}

/** The entries of a note's "related" property, as they are written. One text is a list of one. */
export function readRelationEntries(frontmatter: Readonly<Frontmatter> | null | undefined): string[] {
  const raw: unknown = frontmatter?.[RELATED_KEY];
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/** Whether a "related" property can be changed: nothing, one text, or a list. Anything else is left alone. */
function listOf(frontmatter: Frontmatter): unknown[] | null {
  const raw: unknown = frontmatter[RELATED_KEY];
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw];
  return Array.isArray(raw) ? raw : null;
}

/**
 * Add an entry to a note's "related" property, in place, at the end of the
 * list. Nothing changes when the list already has an entry that leads to the
 * same note: one entity is related to another once.
 */
export function addRelation(frontmatter: Frontmatter, entry: string, leadsTo: (entry: string) => boolean): LinkChange {
  const list = listOf(frontmatter);
  if (list === null) return 'unreadable';
  if (list.some((item) => typeof item === 'string' && (item === entry || leadsTo(item)))) return 'unchanged';
  frontmatter[RELATED_KEY] = [...list, entry];
  return 'changed';
}

/**
 * Give an entry of a note's "related" property another label, in place. The
 * entry is found by how it is written; its link stays as it is, and so does
 * every other entry.
 */
export function relabelRelation(frontmatter: Frontmatter, raw: string, label: string): LinkChange {
  const list = listOf(frontmatter);
  if (list === null) return 'unreadable';
  const written = parseRelation(raw);
  if (written === null || !list.includes(raw)) return 'unchanged';
  const next = writeRelation(written.target, label);
  if (next === raw) return 'unchanged';
  frontmatter[RELATED_KEY] = list.map((item) => (item === raw ? next : item));
  return 'changed';
}

/**
 * Take an entry out of a note's "related" property, in place, by how it is
 * written. The other entries stay as they are, in order. A list that comes
 * out empty is taken away with its key.
 */
export function removeRelation(frontmatter: Frontmatter, raw: string): LinkChange {
  const list = listOf(frontmatter);
  if (list === null) return 'unreadable';
  const kept = list.filter((item) => item !== raw);
  if (kept.length === list.length) return 'unchanged';
  if (kept.length === 0) delete frontmatter[RELATED_KEY];
  else frontmatter[RELATED_KEY] = kept;
  return 'changed';
}

// ------------------------------------------------------------ the whole world

/** One entry of an entity's "related" list, with where it leads. */
export interface Relation {
  /** The entry exactly as it is written: what it is changed and removed by. */
  readonly raw: string;
  /** The other entity's name, or else what the link says. */
  readonly name: string;
  /** How the two have to do with each other; "" when the entry does not say. */
  readonly label: string;
  /** The entity it leads to; null for a link that leads to no entity of the project. */
  readonly entity: Entity | null;
}

/** An entity that lists this one as related: the relation seen from the other side. */
export interface BackRelation {
  readonly entity: Entity;
  /** The label the other note gives the relation; "" for none. */
  readonly label: string;
}

/** Who has to do with whom: the relations of a project, both ways round. */
export interface WorldRelations {
  /** The entries of an entity's own list, in the order they are written. */
  of(entityPath: string): readonly Relation[];
  /** The entities that list this one and that it does not list itself, by name. */
  mentionedBy(entityPath: string): readonly BackRelation[];
}

export interface RelationSources {
  readonly entities: readonly Entity[];
  /** Where each entity's note is in the vault. */
  readonly entityVaultPath: (entityPath: string) => string | null;
  readonly resolve: LinkResolver;
}

const NONE: readonly never[] = Object.freeze([]);

/**
 * Work out every relation of a project once: what each entity lists, and
 * from that who lists each entity. An entity that lists another twice counts
 * once on the other side, and one that lists itself is not "mentioned by"
 * itself.
 */
export function buildRelations(sources: RelationSources): WorldRelations {
  const byVaultPath = new Map<string, Entity>();
  const vaultPaths = new Map<string, string | null>();
  for (const entity of sources.entities) {
    const vaultPath = sources.entityVaultPath(entity.path);
    vaultPaths.set(entity.path, vaultPath);
    if (vaultPath !== null) byVaultPath.set(pathKey(vaultPath), entity);
  }

  const own = new Map<string, Relation[]>();
  const back = new Map<string, BackRelation[]>();
  for (const entity of sources.entities) {
    const from = vaultPaths.get(entity.path) ?? null;
    const entries: Relation[] = [];
    const counted = new Set<string>();
    for (const raw of readRelationEntries(entity.frontmatter)) {
      const written = parseRelation(raw);
      const found = written === null || from === null ? null : sources.resolve(written.target, from);
      const other = found === null ? null : (byVaultPath.get(pathKey(found)) ?? null);
      entries.push({ raw, name: other?.name ?? (written === null ? raw : lastStep(written.target)), label: written?.label ?? '', entity: other });
      if (other === null || other.path === entity.path || counted.has(other.path)) continue;
      counted.add(other.path);
      const list = back.get(pathKey(other.path)) ?? [];
      list.push({ entity, label: written?.label ?? '' });
      back.set(pathKey(other.path), list);
    }
    if (entries.length > 0) own.set(pathKey(entity.path), entries);
  }

  return {
    of: (entityPath) => own.get(pathKey(entityPath)) ?? NONE,
    mentionedBy: (entityPath) => {
      const listed = new Set((own.get(pathKey(entityPath)) ?? []).map((relation) => relation.entity?.path));
      return (back.get(pathKey(entityPath)) ?? []).filter((relation) => !listed.has(relation.entity.path));
    },
  };
}

/** The relations of one entity that lead to entities of one type. */
export interface RelationGroup<T> {
  /** The type's id, or OTHER_TYPE. */
  readonly id: string;
  /** The type; null for the group of what has no type of the list, and of links that lead to no entity. */
  readonly type: EntityType | null;
  /** The heading: the type's folder name ("Characters"), or "Other". */
  readonly name: string;
  readonly relations: readonly T[];
}

/**
 * Relations in groups by the other entity's type, in the order of the list
 * of types, with "Other" last (entities without a type of the list, and
 * links that lead to no entity). A group with nothing in it is left out.
 */
export function groupRelations<T extends { readonly entity: Entity | null }>(relations: readonly T[], types: readonly EntityType[]): RelationGroup<T>[] {
  const groups: RelationGroup<T>[] = [];
  for (const type of types) {
    const members = relations.filter((relation) => relation.entity?.typeId === type.id);
    if (members.length > 0) groups.push({ id: type.id, type, name: type.folder, relations: members });
  }
  const others = relations.filter((relation) => findType(types, relation.entity?.typeId ?? null) === null);
  if (others.length > 0) groups.push({ id: OTHER_TYPE, type: null, name: OTHER_NAME, relations: others });
  return groups;
}
