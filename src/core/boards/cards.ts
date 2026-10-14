// From idea to manuscript: what a text card of a board becomes when the
// writer turns it into a note.
//
// The card's first line is the new note's title, and the rest of its text is
// the scene's synopsis (or the entity's summary). Marks of Markdown at the
// start of the first line (a heading's "#", a list's "-", bold) are not part
// of the title.

import { sanitiseFileName, tidyDisplayName } from '../names';

/** The longest title a card gives, in characters; a longer first line is cut at a space. */
export const TITLE_MAX = 80;

/** A card's text taken apart. */
export interface CardText {
  /** The first line, without Markdown marks: the note's title. "" when the card holds no words. */
  readonly title: string;
  /** Everything after the first line, trimmed: the synopsis or the summary. "" for none. */
  readonly rest: string;
}

/** Take a card's text apart into a title and the rest. */
export function splitCardText(text: string): CardText {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first < 0) return { title: '', rest: '' };
  const title = shortTitle(plainLine(lines[first] ?? ''));
  const rest = lines.slice(first + 1).join('\n').trim();
  return { title, rest };
}

/** A line without the Markdown marks that start it, or that wrap it in bold or italics. */
function plainLine(line: string): string {
  let plain = line.trim();
  plain = plain.replace(/^#{1,6}\s+/, '');
  plain = plain.replace(/^(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '');
  const wrapped = /^(\*\*|__|\*|_)(.+)\1$/.exec(plain);
  if (wrapped) plain = wrapped[2] ?? plain;
  return tidyDisplayName(plain);
}

/** A title no longer than TITLE_MAX characters, cut at the last space before that when it is longer. */
function shortTitle(title: string): string {
  const characters = [...title];
  if (characters.length <= TITLE_MAX) return title;
  const cut = characters.slice(0, TITLE_MAX).join('');
  const space = cut.lastIndexOf(' ');
  return (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

/** The rest of a card on one line: an entity's summary is one line of text. */
export function oneLine(text: string): string {
  return tidyDisplayName(text);
}

/**
 * The name of the note a card becomes: the title as a file name, or
 * `fallback` when the title has no characters a file name can hold.
 */
export function cardNoteName(title: string, fallback: string): string {
  return sanitiseFileName(title, fallback);
}

/** What the writer chose for one card. */
export type CardChoice =
  | { readonly kind: 'keep' }
  | { readonly kind: 'scene' }
  | { readonly kind: 'entity'; readonly typeId: string };

/** The choices in the order they are offered, as keys a list of choices can use: "keep", "scene", "entity:<type id>". */
export function choiceKey(choice: CardChoice): string {
  return choice.kind === 'entity' ? `entity:${choice.typeId}` : choice.kind;
}

/** A choice from its key; "keep" for one that is not understood. */
export function choiceOf(key: string): CardChoice {
  if (key === 'scene') return { kind: 'scene' };
  if (key.startsWith('entity:') && key.length > 'entity:'.length) return { kind: 'entity', typeId: key.slice('entity:'.length) };
  return { kind: 'keep' };
}
