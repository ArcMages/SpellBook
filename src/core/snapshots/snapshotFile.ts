// What a snapshot is on disk, and how it is told which scene it belongs to.
//
// A snapshot is a plain note, so that it syncs like every other note and can
// be read without the plugin:
//
//   <Project>/Snapshots/<scene title> - <scene id>/<date> <time> <name>.md
//
//   ---
//   spellbook-snapshot: 1
//   scene-id: m2k9x1ab          the scene it is a version of (see below)
//   scene: Manuscript/Opening.md   where that scene was at the time
//   name: Before the rewrite
//   taken: 2026-10-14T12:30:05     on the clock of the device that took it
//   taken-at: 1791973805000        the same moment, for sorting
//   automatic: false
//   words: 1234
//   device: a1b2c3
//   ---
//   ```yaml
//   synopsis: Anna arrives.        the scene's own properties, as text
//   status: First draft
//   ```
//   The scene's text, exactly as it was.
//
// The scene's properties are kept inside a code block: they are there to be
// read and to be put back, but Obsidian and Spellbook do not take them for
// properties of the snapshot, so a snapshot is never mistaken for a scene.
//
// Which scene a snapshot belongs to: a scene has no name of its own that
// lasts (its path changes when it is renamed or moved), so the first time a
// snapshot of it is taken the scene is given a short id, kept in its
// "snapshot-id" property. A snapshot carries that id, and so follows its
// scene through any renaming, on any device. A scene that has no id (yet)
// is matched by its path instead.

import { sanitiseFileName } from '../names';
import { pathKey } from '../paths';
import type { Frontmatter } from '../types';
import { stripFrontmatter } from '../wordCount';

/** The property that marks a note as a snapshot; its value is the layout's version. */
export const SNAPSHOT_MARK = 'spellbook-snapshot';
export const SNAPSHOT_VERSION = 1;
/** The property of a scene that holds its id. */
export const SCENE_ID_KEY = 'snapshot-id';

/** The name a snapshot has when the writer gave it none. */
export const UNNAMED_TEXT = 'Snapshot';
/** The name of a snapshot that was taken by itself before the day's first edit. */
export const AUTOMATIC_NAME = 'Automatic';

/** What is known of a snapshot without reading its text. */
export interface SnapshotInfo {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly sceneId: string | null;
  /** Where the scene was when the snapshot was taken, relative to the project folder. */
  readonly scenePath: string | null;
  /** The name the writer gave it; empty when none. */
  readonly name: string;
  /** When it was taken, as "YYYY-MM-DDTHH:MM:SS" on the clock of the device that took it; empty when unknown. */
  readonly taken: string;
  /** The same moment in milliseconds since 1970; 0 when unknown. */
  readonly takenAt: number;
  readonly automatic: boolean;
  /** The words of the scene's text at the time; null when unknown. */
  readonly words: number | null;
  readonly device: string;
}

/** A moment on a device's own clock. */
export interface LocalMoment {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const two = (value: number): string => String(value).padStart(2, '0');

/** "2026-10-14" */
export function dayOf(moment: LocalMoment): string {
  return `${String(moment.year).padStart(4, '0')}-${two(moment.month)}-${two(moment.day)}`;
}

/** "2026-10-14T12:30:05" */
export function stampOf(moment: LocalMoment): string {
  return `${dayOf(moment)}T${two(moment.hour)}:${two(moment.minute)}:${two(moment.second)}`;
}

/** What a snapshot's date looks like in a list: "2026-10-14 12:30". Empty for a stamp that is not one. */
export function shownDate(taken: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(taken);
  return match ? `${match[1]} ${match[2]}` : '';
}

/** A name typed for a snapshot, tidied: one line, no spaces at its ends, not overly long. */
export function tidySnapshotName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120).trim();
}

/** What the writer sees as a snapshot's name. */
export function shownName(info: Pick<SnapshotInfo, 'name' | 'automatic'>): string {
  if (info.name !== '') return info.name;
  return info.automatic ? AUTOMATIC_NAME : UNNAMED_TEXT;
}

/** The properties of a new snapshot, in the order they are written. */
export function snapshotFrontmatter(details: {
  readonly sceneId: string;
  readonly scenePath: string;
  readonly name: string;
  readonly moment: LocalMoment;
  readonly takenAt: number;
  readonly automatic: boolean;
  readonly words: number;
  readonly device: string;
}): Frontmatter {
  return {
    [SNAPSHOT_MARK]: SNAPSHOT_VERSION,
    'scene-id': details.sceneId,
    scene: details.scenePath,
    name: details.name,
    taken: stampOf(details.moment),
    'taken-at': details.takenAt,
    automatic: details.automatic,
    words: details.words,
    device: details.device,
  };
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/**
 * Read what a note's properties say about a snapshot. Null when the note is
 * not marked as one. The properties may have been changed by hand: whatever
 * is not as expected is read as "unknown", never trusted.
 *
 * @param path the note's path relative to the project folder
 */
export function readSnapshotInfo(path: string, frontmatter: Readonly<Frontmatter> | null): SnapshotInfo | null {
  if (frontmatter === null || !Object.prototype.hasOwnProperty.call(frontmatter, SNAPSHOT_MARK)) return null;
  const at = frontmatter['taken-at'];
  const words = frontmatter['words'];
  const sceneId = textOf(frontmatter['scene-id']).trim();
  const scenePath = textOf(frontmatter['scene']).trim();
  return {
    path,
    sceneId: sceneId === '' ? null : sceneId,
    scenePath: scenePath === '' ? null : scenePath,
    name: tidySnapshotName(textOf(frontmatter['name'])),
    taken: textOf(frontmatter['taken']),
    takenAt: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : 0,
    automatic: frontmatter['automatic'] === true,
    words: typeof words === 'number' && Number.isFinite(words) && words >= 0 ? Math.floor(words) : null,
    device: textOf(frontmatter['device']),
  };
}

/** The id a scene's properties give it, or null when it has none. */
export function sceneIdOf(frontmatter: Readonly<Frontmatter> | null): string | null {
  if (frontmatter === null) return null;
  const id = textOf(frontmatter[SCENE_ID_KEY]).trim();
  return id === '' ? null : id;
}

/**
 * A new id for a scene: the moment in a short form, the device, and a number
 * that tells apart ids made in the same millisecond. Lower-case letters and
 * digits only, so it is safe in a folder name.
 */
export function newSceneId(now: number, deviceId: string, count: number): string {
  const device = deviceId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
  return `${Math.max(0, Math.floor(now)).toString(36)}${device}${count > 0 ? count.toString(36) : ''}`;
}

/** The scene a list of snapshots is asked for. */
export interface SceneRef {
  /** The scene's id, when it has one. */
  readonly id: string | null;
  /** The scene's path relative to the project folder. */
  readonly path: string;
}

/** Whether a snapshot is a version of this scene: by id when the scene has one, by path when it has not. */
export function belongsTo(info: SnapshotInfo, scene: SceneRef): boolean {
  if (scene.id !== null) return info.sceneId === scene.id;
  return info.scenePath !== null && pathKey(info.scenePath) === pathKey(scene.path);
}

/**
 * The snapshots of one scene, newest first. A sync service may leave a second
 * copy of a snapshot next to it ("... 2.md"): a snapshot is never changed
 * once written, so two that were taken at the same moment on the same device
 * are the same one, and only the one with the shorter name is listed.
 */
export function snapshotsOf(all: readonly SnapshotInfo[], scene: SceneRef): SnapshotInfo[] {
  const byKey = new Map<string, SnapshotInfo>();
  for (const info of all) {
    if (!belongsTo(info, scene)) continue;
    // A snapshot whose moment is unknown can be nobody's copy.
    const key = info.takenAt === 0 ? `path ${info.path}` : `${info.takenAt} ${info.device} ${info.automatic ? 'a' : 'n'} ${info.name}`;
    const known = byKey.get(key);
    if (!known || info.path.length < known.path.length || (info.path.length === known.path.length && info.path < known.path)) {
      byKey.set(key, info);
    }
  }
  return [...byKey.values()].sort((a, b) => b.takenAt - a.takenAt || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The automatic snapshots that are one too many: all but the newest `keep`
 * of them. Snapshots the writer took are never among them.
 *
 * @param ofScene the snapshots of one scene, copies included
 */
export function automaticToRemove(ofScene: readonly SnapshotInfo[], keep: number): SnapshotInfo[] {
  const most = Math.max(1, Math.floor(keep));
  const automatic = ofScene.filter((info) => info.automatic).sort((a, b) => b.takenAt - a.takenAt);
  const kept = new Set<number>();
  const out: SnapshotInfo[] = [];
  for (const info of automatic) {
    // Copies of one snapshot count as one, and go together.
    if (kept.has(info.takenAt) || kept.size < most) kept.add(info.takenAt);
    else out.push(info);
  }
  return out;
}

/** The name of the folder a scene's snapshots are kept in: its title, then its id. */
export function snapshotFolderName(title: string, sceneId: string): string {
  const tidy = sanitiseFileName(title, 'Scene');
  // Short enough that the id always fits behind it.
  const short = [...tidy].slice(0, 60).join('').trim();
  return sanitiseFileName(`${short === '' ? 'Scene' : short} - ${sceneId}`, sceneId);
}

/**
 * The name of a snapshot's note, without ".md": the day, the time and the
 * name it was given. `attempt` above 0 adds a letter, for a second snapshot
 * in the same second.
 */
export function snapshotFileName(moment: LocalMoment, name: string, attempt = 0): string {
  const time = `${two(moment.hour)}.${two(moment.minute)}.${two(moment.second)}`;
  const extra = attempt > 0 ? String.fromCharCode(97 + ((attempt - 1) % 26)) : '';
  const label = [...sanitiseFileName(name, '')].slice(0, 60).join('').trim();
  return sanitiseFileName(`${dayOf(moment)} ${time}${extra}${label === '' ? '' : ` ${label}`}`, `${dayOf(moment)} ${time}${extra}`);
}

// ------------------------------------------------------------ the text

/** A note taken apart: its properties block and the rest. `head + body` is the note again. */
export interface NoteParts {
  /** The properties block with its two "---" lines, as it stands in the note; empty when there is none. */
  readonly head: string;
  /** What is between the two "---" lines; null when the note has no properties block. */
  readonly yaml: string | null;
  readonly body: string;
}

export function splitNote(text: string): NoteParts {
  const body = stripFrontmatter(text);
  const mark = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const head = text.slice(0, text.length - body.length);
  if (head.length <= mark) return { head: '', yaml: null, body };
  const lines = head.replace(/\n$/, '').split('\n');
  return { head, yaml: lines.slice(1, -1).join('\n'), body };
}

const FENCE_LINE = /^(`{3,})yaml[ \t\r]*$/;

/** The text of a snapshot under its own properties: the scene's properties in a code block, then the scene's text. */
export function snapshotBody(sceneText: string): string {
  const { yaml, body } = splitNote(sceneText);
  const inner = yaml ?? '';
  // Longer than any run of backticks inside, so that nothing in there can end the block.
  let longest = 2;
  for (const run of inner.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}yaml\n${inner}${inner === '' ? '' : '\n'}${fence}\n${body}`;
}

/** The scene as a snapshot holds it. */
export interface SnapshotText {
  /** The scene's properties at the time, as text; null when it had none (or the block was taken out by hand). */
  readonly yaml: string | null;
  /** The scene's text at the time. */
  readonly body: string;
}

/** Read the whole text of a snapshot note (its own properties included). */
export function readSnapshotText(noteText: string): SnapshotText {
  const text = stripFrontmatter(noteText);
  const firstEnd = text.indexOf('\n');
  const fence = firstEnd < 0 ? null : (FENCE_LINE.exec(text.slice(0, firstEnd))?.[1] ?? null);
  if (fence === null) return { yaml: null, body: text };
  let lineStart = firstEnd + 1;
  while (lineStart <= text.length) {
    const lineEnd = text.indexOf('\n', lineStart);
    const line = lineEnd < 0 ? text.slice(lineStart) : text.slice(lineStart, lineEnd);
    if (line.replace(/[ \t\r]+$/, '') === fence) {
      const yaml = text.slice(firstEnd + 1, Math.max(firstEnd + 1, lineStart - 1));
      return { yaml: yaml === '' ? null : yaml, body: lineEnd < 0 ? '' : text.slice(lineEnd + 1) };
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }
  // A block that is never closed is ordinary text.
  return { yaml: null, body: text };
}

/**
 * The text a scene has after a snapshot is restored.
 *
 * @param current        the scene's whole text as it is now
 * @param withProperties false: the scene keeps the properties it has now and
 *   only its text is put back; true: the properties of the time are put back too
 */
export function restoredText(current: string, snapshot: SnapshotText, withProperties: boolean): string {
  if (withProperties) {
    return snapshot.yaml === null ? snapshot.body : `---\n${snapshot.yaml}\n---\n${snapshot.body}`;
  }
  const { head } = splitNote(current);
  return `${head}${head === '' || head.endsWith('\n') ? '' : '\n'}${snapshot.body}`;
}
