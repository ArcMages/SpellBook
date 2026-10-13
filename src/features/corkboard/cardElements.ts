// One index card on the corkboard, as elements.
//
// A card is built once and then kept: when the scene behind it changes, the
// same elements are given new text and new marks, so nothing flickers and the
// keyboard stays where it was. What a card says is worked out by the engine
// (src/core/cards); this file only puts it on the screen.
//
// Text in any language: the title, the synopsis and the names of a status and
// a label are the writer's own text. Each of them, and only they, takes the
// direction of its own text. Word counts are numbers and always read left to
// right; the card around them follows the direction of Obsidian itself.

import { describeCount, formatCount } from '../../core/binderModel';
import type { CardTag, FolderCard, SceneCard } from '../../core/cards';
import { ROW_MORE_ICON, WARNING_ICON, showIcon } from '../../ui/icons';
import { MISSING_LABEL } from '../../views/binderActions';
import { MORE_LABEL, SWATCH_CLASS, iconButton, setColor, setShown, setTextOnce } from './parts';

export const CARD_CLASS = 'spellbook-card';
export const MISSING_CLASS = 'spellbook-is-missing';
/** The icon of a folder card. */
export const FOLDER_ICON = ['folder'] as const;

/** The parts of a scene card that change. */
export interface SceneParts {
  readonly kind: 'scene';
  readonly title: HTMLElement;
  readonly more: HTMLElement;
  readonly synopsis: HTMLElement;
  readonly warning: HTMLElement;
  readonly foot: HTMLElement;
  readonly label: HTMLElement;
  readonly labelSwatch: HTMLElement;
  readonly labelName: HTMLElement;
  readonly status: HTMLElement;
  readonly statusName: HTMLElement;
  readonly words: HTMLElement;
  readonly bar: HTMLElement;
  readonly barFill: HTMLElement;
}

/** The parts of a folder card that change. */
export interface FolderParts {
  readonly kind: 'folder';
  readonly title: HTMLElement;
  readonly more: HTMLElement;
  readonly scenes: HTMLElement;
  readonly missing: HTMLElement;
  readonly words: HTMLElement;
}

export type CardParts = SceneParts | FolderParts;

/** "1 scene", "12 scenes". */
export function describeScenes(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'scene' : 'scenes'}`;
}

/** The "more" button of a card: the last thing in its top line, at the far end from the title. */
function moreButton(top: HTMLElement, menu: (button: HTMLElement) => unknown): HTMLElement {
  const more = iconButton(top, 'spellbook-card-more', MORE_LABEL, ROW_MORE_ICON, menu);
  more.setAttr('aria-haspopup', 'menu');
  // Reached with Tab from its own card, while the keyboard is on that card.
  more.setAttr('tabindex', -1);
  return more;
}

/**
 * Build the inside of a scene card.
 *
 * @param menu what the card's "more" button does; it is handed the button
 */
export function buildSceneParts(card: HTMLElement, menu: (button: HTMLElement) => unknown): SceneParts {
  card.addClass('spellbook-card-scene');
  const top = card.createDiv({ cls: 'spellbook-card-head' });
  const title = top.createDiv({ cls: 'spellbook-card-title', attr: { dir: 'auto' } });
  const more = moreButton(top, menu);
  const synopsis = card.createDiv({ cls: 'spellbook-card-synopsis', attr: { dir: 'auto' } });

  const warning = card.createDiv({ cls: 'spellbook-card-warning' });
  showIcon(warning.createSpan({ cls: 'spellbook-card-warning-icon' }), ...WARNING_ICON);
  warning.createSpan({ cls: 'spellbook-card-warning-text', text: MISSING_LABEL });

  const foot = card.createDiv({ cls: 'spellbook-card-foot' });
  const label = foot.createSpan({ cls: 'spellbook-card-label' });
  const labelSwatch = label.createSpan({ cls: SWATCH_CLASS });
  const labelName = label.createSpan({ cls: 'spellbook-card-label-name', attr: { dir: 'auto' } });
  const status = foot.createSpan({ cls: 'spellbook-card-status' });
  const statusName = status.createSpan({ cls: 'spellbook-card-status-name', attr: { dir: 'auto' } });
  // Numbers read left to right in every language.
  const words = foot.createSpan({ cls: 'spellbook-card-words', attr: { dir: 'ltr' } });

  const bar = card.createDiv({ cls: 'spellbook-card-target', attr: { role: 'progressbar', 'aria-valuemin': 0 } });
  const barFill = bar.createDiv({ cls: 'spellbook-card-target-fill' });
  return {
    kind: 'scene',
    title,
    more,
    synopsis,
    warning,
    foot,
    label,
    labelSwatch,
    labelName,
    status,
    statusName,
    words,
    bar,
    barFill,
  };
}

function showTag(outer: HTMLElement, name: HTMLElement, colored: HTMLElement, tag: CardTag | null, what: string): void {
  setShown(outer, tag !== null);
  setTextOnce(name, tag?.name ?? '');
  setColor(colored, tag?.color ?? null);
  // A name the project's list does not have is shown, without a colour.
  outer.toggleClass('spellbook-is-unlisted', tag !== null && !tag.listed);
  outer.setAttr('aria-label', tag === null ? null : `${what}: ${tag.name}${tag.listed ? '' : ' (not in the list)'}`);
}

/** Make a scene card say what the engine worked out for its scene. */
export function drawScene(card: HTMLElement, parts: SceneParts, model: SceneCard): void {
  card.toggleClass(MISSING_CLASS, model.missing);
  card.setAttr('aria-disabled', model.missing ? 'true' : null);
  setTextOnce(parts.title, model.title);

  // A preview taken from the scene's text is shown in a quieter style than a synopsis the writer wrote.
  setTextOnce(parts.synopsis, model.missing ? '' : model.synopsis);
  parts.synopsis.toggleClass('spellbook-is-derived', model.synopsisDerived);
  setShown(parts.synopsis, !model.missing && model.synopsis !== '');
  setShown(parts.warning, model.missing);

  // The label is the card's coloured edge, and is named at its foot.
  setColor(card, model.label?.color ?? null);
  card.toggleClass('spellbook-has-label', model.label !== null);
  showTag(parts.label, parts.labelName, parts.labelSwatch, model.label, 'Label');
  showTag(parts.status, parts.statusName, parts.status, model.status, 'Status');

  const { words, target, progress } = model;
  let count = '';
  let spoken: string | null = null;
  if (words !== null && target !== null) {
    count = `${formatCount(words)} / ${describeCount(target)}`;
    spoken = `${describeCount(words)} of a target of ${formatCount(target)}`;
  } else if (words !== null) {
    count = describeCount(words);
  } else if (target !== null) {
    count = `Target ${formatCount(target)}`;
  }
  setTextOnce(parts.words, count);
  parts.words.setAttr('aria-label', spoken);
  setShown(parts.words, count !== '');
  setShown(parts.foot, model.label !== null || model.status !== null || count !== '');

  setShown(parts.bar, progress !== null);
  if (progress) {
    parts.barFill.style.width = `${Math.round(progress.fraction * 100)}%`;
    parts.bar.toggleClass('spellbook-is-reached', progress.reached);
    parts.bar.setAttr('aria-valuemax', progress.target);
    parts.bar.setAttr('aria-valuenow', Math.min(progress.words, progress.target));
    parts.bar.setAttr('aria-label', `${progress.percent}% of the word target`);
  }
}

/**
 * Build the inside of a folder card.
 *
 * @param menu what the card's "more" button does; it is handed the button
 */
export function buildFolderParts(card: HTMLElement, menu: (button: HTMLElement) => unknown): FolderParts {
  card.addClass('spellbook-card-folder');
  const top = card.createDiv({ cls: 'spellbook-card-head' });
  showIcon(top.createSpan({ cls: 'spellbook-card-folder-icon', attr: { 'aria-hidden': 'true' } }), ...FOLDER_ICON);
  const title = top.createDiv({ cls: 'spellbook-card-title', attr: { dir: 'auto' } });
  const more = moreButton(top, menu);

  const foot = card.createDiv({ cls: 'spellbook-card-foot' });
  const scenes = foot.createSpan({ cls: 'spellbook-card-scenes' });
  const missing = foot.createSpan({ cls: 'spellbook-card-folder-missing' });
  const words = foot.createSpan({ cls: 'spellbook-card-words', attr: { dir: 'ltr' } });
  return { kind: 'folder', title, more, scenes, missing, words };
}

/** Make a folder card say what the engine worked out for its folder. */
export function drawFolder(parts: FolderParts, model: FolderCard): void {
  setTextOnce(parts.title, model.name);
  setTextOnce(parts.scenes, describeScenes(model.sceneCount));
  setTextOnce(parts.missing, model.missingCount > 0 ? `${formatCount(model.missingCount)} not found` : '');
  setShown(parts.missing, model.missingCount > 0);
  // The sum is not known while a scene inside is still being counted.
  setTextOnce(parts.words, model.words === null ? '' : describeCount(model.words));
  setShown(parts.words, model.words !== null);
}
