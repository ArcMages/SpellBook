// Scrivenings: the scenes of the manuscript shown one after another, as one
// continuous text to read through.
//
//   header    the name of the pane, the scope button (the whole manuscript,
//             or one folder of the binder) and how many scenes and words
//             are on show
//   scenes    every scene of the scope in binder order, each under a small
//             divider with its title, its word count and an Edit button
//
// Everything it shows comes from its host (host.ts); where the scenes stand
// is worked out in src/core/scrivenings. The pane changes nothing in the
// vault. To change a scene the writer taps its text (or Edit, or its title):
// the scene's own note opens in Obsidian's editor, at the paragraph that was
// tapped. When the note is saved, the scene is drawn again here.
//
// Only the scenes near what the writer sees are drawn. A scene that is far
// away is empty room of about the right height (its measured height once it
// has been drawn, a guess from its word count before), so that a manuscript
// of a hundred scenes scrolls like a short one and takes little memory.
// Scenes are drawn one at a time, between two frames.
//
// The pane follows the project: a scene that is edited, added, moved,
// renamed or removed changes in its own place. What is drawn for the other
// scenes stays, and the line the writer was reading stays where it is: the
// pane keeps to "so far into this scene", not to a number of pixels.
//
// Touch first: the title and Edit are buttons, nothing depends on hovering,
// and whether the header is laid out for a narrow pane goes by the pane's
// measured width, never by the kind of device.

import { ItemView, Keymap, Menu, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { describeCount, formatCount } from '../../core/binderModel';
import { pathKey } from '../../core/paths';
import { isNarrowPane } from '../../core/report';
import type { ScopeFolder } from '../../core/report';
import {
  MIN_SCENE_HEIGHT,
  carryOver,
  estimateHeight,
  hasText,
  lineOfSnippet,
  offsetsOf,
  placeAt,
  planWindow,
  sameScriveningsScope,
  sceneText,
  scrollTopOf,
} from '../../core/scrivenings';
import type { RememberedPlace, ScriveningsScope } from '../../core/scrivenings';
import { iconName } from '../../ui/icons';
import { MISSING_LABEL } from '../../ui/missingNote';
import { safely } from '../../ui/safely';
import { drawPlain } from './drawing';
import type { Undraw } from './drawing';
import type { HostScene, ScriveningsChange, ScriveningsHost } from './host';

export const SCRIVENINGS_VIEW_TYPE = 'spellbook-scrivenings';
export const SCRIVENINGS_VIEW_NAME = 'Novel view';
/** The pane's icon, by every name Obsidian has had for it. */
export const SCRIVENINGS_ICONS = ['scroll-text', 'scroll', 'file-text'] as const;

/** The icon this version of Obsidian knows. */
export function scriveningsIcon(): string {
  return iconName(...SCRIVENINGS_ICONS) ?? 'file-text';
}

export const SCOPE_MANUSCRIPT_TEXT = 'Whole manuscript';
export const SCOPE_LABEL = 'Which scenes are shown';
export const EDIT_TEXT = 'Edit';

export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const NO_FOLDER_TEXT = 'This folder is no longer in the binder. Choose another scope above.';
export const NO_SCENES_TEXT = 'There are no scenes here yet.';
export const EMPTY_SCENE_TEXT = 'Nothing written yet.';
export const UNREAD_TEXT = 'This scene could not be read. It is tried again when its note changes.';

/** The class of every scene, of its text, and of a text that is still being drawn (it is not shown yet). */
const SCENE_CLASS = 'spellbook-scrivenings-scene';
const DIVIDER_CLASS = 'spellbook-scrivenings-divider';
const TEXT_CLASS = 'spellbook-scrivenings-text';
const PENDING_CLASS = 'spellbook-scrivenings-pending';
const NOTE_CLASS = 'spellbook-scrivenings-note';
/** Obsidian's own class for formatted text: with it, a scene looks as it does in the reading view of the theme in use. */
const FORMATTED_CLASS = 'markdown-rendered';

/** How long after the last scroll the place is saved on the device, in milliseconds. */
export const SAVE_PLACE_MS = 600;
/** The height taken for what the writer sees when the pane cannot be measured. */
const FALLBACK_VIEWPORT = 800;
/** A change of the pane's width smaller than this does not make the far scenes be guessed anew. */
const WIDTH_SLACK = 8;

/** What a tap inside a scene's text must not be taken from: these do something of their own. */
const OWN_TAPS = new Set(['button', 'input', 'select', 'textarea', 'label', 'summary', 'audio', 'video']);
/** The pieces of a text that have a line of their own in the note. */
const LINE_BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'tr', 'blockquote']);

interface Elements {
  readonly root: HTMLElement;
  readonly scopeButton: HTMLElement;
  readonly summary: HTMLElement;
  readonly message: HTMLElement;
  readonly scroller: HTMLElement;
  readonly list: HTMLElement;
}

/** One scene on show. */
interface Section {
  path: string;
  title: string;
  /** Null when the binder lists the scene but its note is not in the vault. */
  vaultPath: string | null;
  readonly el: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly countEl: HTMLElement;
  readonly editEl: HTMLElement;
  textEl: HTMLElement;
  /** True when the scene's text (or the line that says it has none) is on the page. */
  drawn: boolean;
  /** The text that is drawn, without the properties block; null when none is. */
  body: string | null;
  /** The line of the note the body starts on. */
  startLine: number;
  /** The height the scene had when it was last drawn and measured. */
  measured: number | null;
  /** The height set on the scene while it is empty room; null when it takes its own. */
  room: number | null;
  undraw: Undraw | null;
  /** The note changed on disk since the scene was drawn. */
  stale: boolean;
  /** The note could not be read. */
  failed: boolean;
  /** Goes up whenever a drawing that is under way is no longer wanted. */
  job: number;
}

/** The place for a menu that opens under something. */
function placeUnder(anchor: HTMLElement): { x: number; y: number; width: number } {
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom, width: box.width };
}

/** "1 scene", "12 scenes". */
export function describeScenes(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'scene' : 'scenes'}`;
}

function tagOf(el: HTMLElement): string {
  const tag: unknown = el.tagName;
  return typeof tag === 'string' ? tag.toLowerCase() : '';
}

export class ScriveningsView extends ItemView {
  private readonly host: ScriveningsHost;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private paneObserver: ResizeObserver | null = null;
  private sceneObserver: ResizeObserver | null = null;

  /** The project on show, by the vault path of its index note; null when none is. */
  private projectKey: string | null = null;
  /** Which scenes are on show. (Obsidian has a "scope" of its own on every pane: this is not it.) */
  private about: ScriveningsScope = { kind: 'manuscript' };
  private sections: Section[] = [];
  private readonly byElement = new Map<Element, Section>();
  /** Where each scene starts, as last worked out. */
  private offsets: number[] = [0];
  /** The place at the top of what the writer sees: so far into such a scene. Null for the top of the manuscript. */
  private place: RememberedPlace | null = null;
  /**
   * True when the manuscript is to be scrolled to the place outright: the
   * pane has just been opened, or come back onto the screen (a hidden pane
   * loses how far it was scrolled), or shows other scenes now. Otherwise the
   * pane only ever scrolls by as much as the scenes above the place changed.
   */
  private jump = true;
  /** Notes that were renamed since the scenes were last looked at: old vault path (as pathKey spells it) to new. */
  private readonly renames = new Map<string, string>();

  /** The measured width of the pane; 0 while it is hidden or not measured yet. */
  private width = 0;
  /** True when the pane is narrow (a phone, or a slim pane). */
  private narrow = false;
  private cancelFrame: (() => void) | null = null;
  private cancelSave: (() => void) | null = null;
  /** True while a scene is being read and drawn: one at a time. */
  private drawing = false;
  private readonly onScroll = (): void => {
    this.scrolled();
  };

  constructor(leaf: WorkspaceLeaf, host: ScriveningsHost) {
    super(leaf);
    this.host = host;
    // A note that is opened from here goes to another tab: the manuscript stays where it is.
    this.navigation = false;
  }

  override getViewType(): string {
    return SCRIVENINGS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return SCRIVENINGS_VIEW_NAME;
  }

  override getIcon(): string {
    return scriveningsIcon();
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-scrivenings-pane');

    const root = pane.createDiv({ cls: 'spellbook-scrivenings' });
    // Touch needs larger buttons. Platform.isMobile covers phones and tablets.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    // On a phone, Obsidian's own bar floats over the bottom of the pane: the
    // stylesheet keeps the last lines clear of it.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    // Until the pane has been measured, a phone is taken to be narrow.
    this.narrow = Platform.isPhone;
    root.toggleClass('spellbook-is-narrow', this.narrow);

    const header = root.createDiv({ cls: 'spellbook-scrivenings-header' });
    header.createDiv({ cls: 'spellbook-scrivenings-heading', text: SCRIVENINGS_VIEW_NAME });
    const bar = header.createDiv({ cls: 'spellbook-scrivenings-bar' });
    const scopeButton = bar.createEl('button', {
      cls: 'spellbook-scrivenings-scope',
      attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': SCOPE_LABEL },
    });
    scopeButton.addEventListener('click', () => {
      safely(SCOPE_LABEL, () => {
        this.showScopeMenu(scopeButton);
      });
    });
    const summary = bar.createSpan({ cls: 'spellbook-scrivenings-summary' });
    const message = root.createDiv({ cls: 'spellbook-scrivenings-message' });
    const scroller = root.createDiv({ cls: 'spellbook-scrivenings-scroll' });
    const list = scroller.createDiv({ cls: 'spellbook-scrivenings-list' });
    this.els = { root, scopeButton, summary, message, scroller, list };

    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    if (typeof ResizeObserver === 'function') {
      this.paneObserver = new ResizeObserver(() => {
        this.measurePane();
      });
      this.paneObserver.observe(pane);
      // A scene that is drawn may still grow (a picture arrives, the pane gets narrower).
      this.sceneObserver = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const section = this.byElement.get(entry.target);
          if (section?.drawn === true && this.measure(section)) changed = true;
        }
        // At once, before the screen is drawn: the writer's line must not be seen to move.
        if (changed) this.layout();
      });
    }
    this.stops.push(
      this.host.onChange((change) => {
        this.onHostChange(change);
      }),
    );

    this.width = this.contentEl.clientWidth;
    this.measurePane();
    this.takeProject();
  }

  protected override async onClose(): Promise<void> {
    // Where the writer was is kept, for the next time the pane is opened.
    this.cancelSave?.();
    this.cancelSave = null;
    if (!this.closed && this.sections.length > 0) this.savePlace();
    this.closed = true;
    this.cancelFrame?.();
    this.cancelFrame = null;
    for (const stop of this.stops.splice(0)) stop();
    this.paneObserver?.disconnect();
    this.paneObserver = null;
    this.clearSections();
    this.sceneObserver?.disconnect();
    this.sceneObserver = null;
    this.els?.scroller.removeEventListener('scroll', this.onScroll);
    this.els = null;
    this.projectKey = null;
    this.place = null;
    this.renames.clear();
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-scrivenings-pane');
  }

  override onResize(): void {
    this.measurePane();
  }

  private measurePane(): void {
    const els = this.els;
    if (!els) return;
    const width = this.contentEl.clientWidth;
    const narrow = isNarrowPane(width, this.narrow);
    if (narrow !== this.narrow) {
      this.narrow = narrow;
      els.root.toggleClass('spellbook-is-narrow', narrow);
    }
    // A hidden pane measures nothing: it keeps what it had.
    if (!(width > 0)) {
      this.width = 0;
      return;
    }
    const before = this.width;
    this.width = width;
    if (before === width) return;
    // Back on the screen: the place is found again.
    if (!(before > 0)) this.jump = true;
    if (Math.abs(width - before) > WIDTH_SLACK) {
      // The lines break elsewhere now: what the far scenes measured no longer holds.
      for (const section of this.sections) {
        if (!section.drawn) section.measured = null;
      }
    }
    this.schedule();
  }

  /** Whether the pane is on the screen: only then does it scroll and can it be measured. */
  private get visible(): boolean {
    return this.width > 0;
  }

  // ----------------------------------------------------- following the host

  private onHostChange(change: ScriveningsChange): void {
    if (this.closed) return;
    switch (change.type) {
      case 'project':
        // The same project under another path (its index note or its folder was renamed): the scenes on show stay.
        if (change.movedFrom !== undefined && change.movedFrom === this.projectKey) this.projectKey = this.host.projectKey;
        if (this.host.projectKey !== this.projectKey) this.takeProject();
        else this.sync();
        return;
      case 'renamed':
        this.renames.set(pathKey(change.from), change.to);
        return;
      case 'note': {
        const section = this.sectionOfNote(change.vaultPath);
        if (!section) return;
        // Whatever is being drawn for it is of the old text.
        section.job++;
        if (section.failed) this.toRoom(section);
        else if (section.drawn) section.stale = true;
        this.schedule();
        return;
      }
      case 'counts': {
        let any = false;
        for (const vaultPath of change.vaultPaths) {
          const section = this.sectionOfNote(vaultPath);
          if (!section) continue;
          this.showCount(section);
          any = true;
        }
        if (!any) return;
        this.showSummary();
        this.schedule();
        return;
      }
    }
  }

  private sectionOfNote(vaultPath: string): Section | null {
    const wanted = pathKey(vaultPath);
    return this.sections.find((section) => section.vaultPath !== null && pathKey(section.vaultPath) === wanted) ?? null;
  }

  /** Another project is open (or none): show it from where this device left it. */
  private takeProject(): void {
    this.cancelSave?.();
    this.cancelSave = null;
    this.clearSections();
    this.projectKey = this.host.projectKey;
    const remembered = this.host.recall();
    this.about = remembered.scope;
    this.place = remembered.place;
    this.jump = true;
    this.sync();
  }

  private choose(scope: ScriveningsScope): void {
    if (sameScriveningsScope(scope, this.about)) return;
    this.about = scope;
    this.place = null;
    this.jump = true;
    this.clearSections();
    this.sync();
    this.savePlace();
  }

  // -------------------------------------------------------------- the scenes

  /** Bring the scenes on show in line with the binder: what is there stays, what is new is made, what is gone goes. */
  private sync(): void {
    const els = this.els;
    if (!els) return;
    const found = this.host.scenesOf(this.about);
    this.showHeader();
    if (found.kind !== 'scenes' || found.scenes.length === 0) {
      this.clearSections();
      els.message.setText(found.kind === 'no-project' ? NO_PROJECT_TEXT : found.kind === 'no-folder' ? NO_FOLDER_TEXT : NO_SCENES_TEXT);
      els.root.addClass('spellbook-scrivenings-is-empty');
      this.showSummary();
      return;
    }
    els.message.setText('');
    els.root.removeClass('spellbook-scrivenings-is-empty');

    // Where the writer's line stands, before anything moves.
    const placeWas = this.placeTop();
    const before = this.sections;
    const placeIndex = this.place === null ? -1 : before.findIndex((section) => section.path === this.place?.path);
    const from = carryOver(before, found.scenes, this.renames);
    this.renames.clear();
    const kept = new Set<Section>();
    const next: Section[] = found.scenes.map((scene, at) => {
      const old = before[from[at] ?? -1];
      if (!old) return this.makeSection(els.list, scene);
      kept.add(old);
      this.update(old, scene);
      return old;
    });
    for (const section of before) {
      if (!kept.has(section)) this.removeSection(section);
    }
    this.sections = next;
    if (placeIndex >= 0 && this.place !== null && !next.some((section) => section.path === this.place?.path)) {
      // The scene the writer was in is gone: the scene that stands where it stood takes its place.
      const heir = next[Math.min(placeIndex, next.length - 1)];
      this.place = heir ? { path: heir.path, fraction: 0 } : null;
    }
    // Put the scenes in the binder's order, only when they are not.
    const children = els.list.children;
    if (children.length !== next.length || next.some((section, at) => children[at] !== section.el)) {
      for (const section of next) els.list.appendChild(section.el);
    }
    this.showSummary();
    this.arrange(placeWas);
  }

  private makeSection(list: HTMLElement, scene: HostScene): Section {
    const el = list.createEl('section', { cls: SCENE_CLASS });
    const divider = el.createDiv({ cls: DIVIDER_CLASS });
    // The title is the writer's own text: it takes the direction of its own words.
    const titleEl = divider.createEl('button', { cls: 'spellbook-scrivenings-title', text: scene.title, attr: { type: 'button', dir: 'auto' } });
    const countEl = divider.createSpan({ cls: 'spellbook-scrivenings-count' });
    const editEl = divider.createEl('button', { cls: 'spellbook-scrivenings-edit', text: EDIT_TEXT, attr: { type: 'button' } });
    const textEl = el.createDiv({ cls: [TEXT_CLASS, FORMATTED_CLASS], attr: { dir: 'auto' } });
    const section: Section = {
      path: scene.path,
      title: scene.title,
      vaultPath: scene.vaultPath,
      el,
      titleEl,
      countEl,
      editEl,
      textEl,
      drawn: false,
      body: null,
      startLine: 0,
      measured: null,
      room: null,
      undraw: null,
      stale: false,
      failed: false,
      job: 0,
    };
    this.byElement.set(el, section);
    this.label(section);
    titleEl.addEventListener('click', (event) => {
      safely(`Open "${section.title}"`, () => this.host.openScene(section.path, Keymap.isModEvent(event)));
    });
    editEl.addEventListener('click', (event) => {
      // At the top of the scene's text, under its properties.
      const line = section.body === null ? null : section.startLine;
      safely(EDIT_TEXT, () => this.host.openScene(section.path, Keymap.isModEvent(event), line));
    });
    el.addEventListener('click', (event) => {
      this.tapped(section, event);
    });
    if (section.vaultPath === null) this.showNote(section, MISSING_LABEL, false);
    return section;
  }

  /** A scene that stays on show may have another title, another path, or have found or lost its note. */
  private update(section: Section, scene: HostScene): void {
    if (this.place?.path === section.path && scene.path !== section.path) this.place = { path: scene.path, fraction: this.place.fraction };
    const hadNote = section.vaultPath !== null;
    section.path = scene.path;
    section.title = scene.title;
    section.vaultPath = scene.vaultPath;
    this.label(section);
    if (scene.vaultPath === null) {
      if (hadNote || !section.drawn) this.showNote(section, MISSING_LABEL, false);
    } else if (!hadNote || section.failed) {
      // The note has arrived (it may have been syncing): its text is read when the scene is near.
      this.toRoom(section);
    }
  }

  /** The words on a scene's divider: its title, its count, and what its buttons are called. */
  private label(section: Section): void {
    section.titleEl.setText(section.title);
    section.titleEl.setAttr('aria-label', `Open "${section.title}"`);
    section.editEl.setAttr('aria-label', `${EDIT_TEXT} "${section.title}"`);
    section.editEl.toggleClass('spellbook-scrivenings-is-off', section.vaultPath === null);
    this.showCount(section);
  }

  private showCount(section: Section): void {
    const words = section.vaultPath === null ? null : this.host.wordsOf(section.vaultPath);
    section.countEl.setText(typeof words === 'number' ? describeCount(words) : '');
  }

  private removeSection(section: Section): void {
    section.job++;
    section.undraw?.();
    section.undraw = null;
    this.sceneObserver?.unobserve(section.el);
    this.byElement.delete(section.el);
    section.el.remove();
  }

  private clearSections(): void {
    for (const section of this.sections) this.removeSection(section);
    this.sections = [];
    this.offsets = [0];
  }

  /** Put a line of the plugin's own in place of a scene's text: its note is missing, or could not be read. */
  private showNote(section: Section, text: string, failed: boolean): void {
    section.job++;
    section.undraw?.();
    section.undraw = null;
    section.textEl.empty();
    section.textEl.createDiv({ cls: NOTE_CLASS, text });
    section.drawn = true;
    section.body = null;
    section.stale = false;
    section.failed = failed;
    section.measured = null;
    this.setRoom(section, null);
    this.measure(section);
  }

  /** Take a scene's text off the page and leave room of its height. */
  private toRoom(section: Section): void {
    section.job++;
    section.undraw?.();
    section.undraw = null;
    this.sceneObserver?.unobserve(section.el);
    section.textEl.empty();
    section.drawn = false;
    section.body = null;
    section.stale = false;
    section.failed = false;
    this.setRoom(section, this.heightOf(section));
  }

  /** The height a scene is given while its text is not on the page; null lets it take its own. */
  private setRoom(section: Section, height: number | null): void {
    if (section.room === height) return;
    section.room = height;
    // Worked out, so it is set here and not in the stylesheet.
    section.el.style.height = height === null ? '' : `${height}px`;
    section.el.toggleClass('spellbook-scrivenings-is-room', height !== null);
  }

  /** Measure a scene that is drawn. True when its height is another than was known. */
  private measure(section: Section): boolean {
    const height = section.el.getBoundingClientRect().height;
    if (!(height > 0) || section.measured === height) return false;
    section.measured = height;
    return true;
  }

  /** How tall a scene is taken to be. */
  private heightOf(section: Section): number {
    if (section.measured !== null) return section.measured;
    if (section.vaultPath === null || section.failed) return MIN_SCENE_HEIGHT;
    const words = this.host.wordsOf(section.vaultPath);
    return estimateHeight(typeof words === 'number' ? words : null, this.width);
  }

  // ---------------------------------------------------------------- the place

  private viewport(): number {
    const els = this.els;
    if (!els) return FALLBACK_VIEWPORT;
    const own: unknown = els.scroller.clientHeight;
    if (typeof own === 'number' && own > 0) return own;
    const measured = els.scroller.getBoundingClientRect().height;
    return measured > 0 ? measured : FALLBACK_VIEWPORT;
  }

  /** Take note of where the writer scrolled to: so far into such a scene, by where the scenes were last known to stand. */
  private notePlace(): void {
    const els = this.els;
    if (!els || !this.visible || this.sections.length === 0) return;
    const at = placeAt(this.offsets, els.scroller.scrollTop);
    const section = at === null ? undefined : this.sections[at.index];
    if (at === null || !section) return;
    // The very top is the top, whatever scene is first by then.
    this.place = at.index === 0 && at.fraction === 0 ? null : { path: section.path, fraction: at.fraction };
  }

  /** How far the manuscript is to be scrolled for the place to be at the top of what the writer sees. */
  private placeTop(): number {
    const place = this.place;
    if (place === null) return 0;
    const index = this.sections.findIndex((section) => section.path === place.path);
    return index < 0 ? 0 : scrollTopOf(this.offsets, { index, fraction: place.fraction });
  }

  private scrolled(): void {
    if (this.closed || !this.visible) return;
    this.notePlace();
    this.schedule();
    this.cancelSave?.();
    this.cancelSave = this.host.later(() => {
      this.cancelSave = null;
      this.savePlace();
    }, SAVE_PLACE_MS);
  }

  private savePlace(): void {
    // Only for the project that is on show: another one may have been opened since.
    if (this.closed || this.projectKey === null || this.host.projectKey !== this.projectKey) return;
    this.host.keep({ scope: this.about, place: this.place });
  }

  // ------------------------------------------------------------------ drawing

  private schedule(): void {
    if (this.closed || this.cancelFrame !== null) return;
    this.cancelFrame = this.host.nextFrame(() => {
      this.cancelFrame = null;
      this.layout();
    });
  }

  /**
   * Work out where the scenes stand, keep the writer's line where it is,
   * let go of the scenes that are far away and draw the next one that is near.
   */
  private layout(): void {
    if (this.closed) return;
    this.arrange(this.placeTop());
  }

  /**
   * @param placeWas how far the manuscript had to be scrolled for the writer's place, as the scenes stood until now
   */
  private arrange(placeWas: number): void {
    const els = this.els;
    if (this.closed || !els) return;
    const heights = this.sections.map((section) => this.heightOf(section));
    this.sections.forEach((section, at) => {
      if (!section.drawn) this.setRoom(section, heights[at] ?? MIN_SCENE_HEIGHT);
    });
    this.offsets = offsetsOf(heights);

    let top = this.placeTop();
    if (this.visible) {
      if (this.jump) {
        this.jump = false;
        if (Math.abs(top - els.scroller.scrollTop) >= 1) els.scroller.scrollTop = top;
      } else if (Math.abs(top - placeWas) >= 1) {
        // The scenes above the writer's line take more room, or less: scroll by as much, so that the line stays
        // where it is. Only ever by the difference: where the writer has scrolled to since is left alone.
        els.scroller.scrollTop += top - placeWas;
      }
      top = els.scroller.scrollTop;
    }

    const plan = planWindow(
      this.offsets,
      top,
      this.viewport(),
      this.sections.map((section) => section.drawn && !section.stale),
    );
    for (const index of plan.drop) {
      const section = this.sections[index];
      if (section && section.vaultPath !== null && !section.failed) this.toRoom(section);
    }
    // A scene whose note changed while it is far away is simply let go of: it is read when it is near again.
    this.sections.forEach((section, index) => {
      if (section.stale && !plan.draw.includes(index)) this.toRoom(section);
    });
    if (this.drawing) return;
    const next = plan.draw.map((index) => this.sections[index]).find((section) => section !== undefined && section.vaultPath !== null);
    if (!next) return;
    this.drawing = true;
    void this.drawScene(next)
      .catch((error: unknown) => {
        console.error('Spellbook: a scene of the continuous manuscript could not be drawn', error);
      })
      .finally(() => {
        this.drawing = false;
        this.schedule();
      });
  }

  /** Read a scene's note and put its text on the page. What is on show stays until the new text is ready. */
  private async drawScene(section: Section): Promise<void> {
    const vaultPath = section.vaultPath;
    if (vaultPath === null) return;
    const job = ++section.job;
    const wanted = (): boolean => !this.closed && section.job === job && section.vaultPath === vaultPath && this.sections.includes(section);

    let note: string;
    try {
      note = await this.host.read(vaultPath);
    } catch {
      // Gone, or not readable: the scene says so, and the others are drawn all the same.
      if (wanted()) this.showNote(section, UNREAD_TEXT, true);
      return;
    }
    if (!wanted()) return;
    const { body, startLine } = sceneText(note);
    if (section.drawn && section.body === body) {
      // Only the properties changed, or the note was saved as it was: nothing to draw.
      section.startLine = startLine;
      section.stale = false;
      return;
    }

    // Drawn out of sight, in the scene itself, and shown when it is whole.
    const fresh = section.el.createDiv({ cls: [TEXT_CLASS, FORMATTED_CLASS, PENDING_CLASS], attr: { dir: 'auto' } });
    let undraw: Undraw = () => undefined;
    if (!hasText(body)) {
      fresh.createDiv({ cls: NOTE_CLASS, text: EMPTY_SCENE_TEXT });
    } else {
      try {
        undraw = await this.host.draw(body, fresh, vaultPath);
      } catch (error) {
        console.error('Spellbook: a scene could not be drawn as formatted text; it is shown as plain text', error);
        fresh.empty();
        drawPlain(body, fresh);
      }
    }
    if (!wanted()) {
      undraw();
      fresh.remove();
      return;
    }
    section.undraw?.();
    section.textEl.remove();
    section.textEl = fresh;
    fresh.removeClass(PENDING_CLASS);
    section.undraw = undraw;
    section.body = body;
    section.startLine = startLine;
    section.drawn = true;
    section.stale = false;
    section.failed = false;
    this.setRoom(section, null);
    this.measure(section);
    this.sceneObserver?.observe(section.el);
  }

  // --------------------------------------------------------------------- taps

  /**
   * A tap on a scene's text: open the scene's note in the editor, at the
   * paragraph that was tapped. A tap on a link follows the link; a tap that
   * ends a selection of text is left alone, so that text can be copied.
   */
  private tapped(section: Section, event: MouseEvent): void {
    if (this.closed || section.body === null) return;
    let inText = false;
    let block: HTMLElement | null = null;
    let outermost: HTMLElement | null = null;
    for (let at = event.target as HTMLElement | null; at && at !== section.el; at = at.parentElement) {
      if (at === section.textEl) {
        inText = true;
        break;
      }
      if (at.hasClass(DIVIDER_CLASS)) return;
      const tag = tagOf(at);
      if (tag === 'a') {
        this.followLink(section, at, event);
        return;
      }
      if (OWN_TAPS.has(tag)) return;
      if (block === null && LINE_BLOCKS.has(tag)) block = at;
      outermost = at;
    }
    if (!inText) return;
    const selection = section.el.ownerDocument.getSelection?.();
    if (selection && !selection.isCollapsed) return;

    const tappedOn = block ?? outermost;
    const snippet: unknown = tappedOn?.textContent;
    const within = typeof snippet === 'string' ? lineOfSnippet(section.body, snippet) : null;
    // Not found (a picture, an embedded note): the top of the scene's text.
    const line = section.startLine + (within ?? 0);
    safely(`Open "${section.title}"`, () => this.host.openScene(section.path, Keymap.isModEvent(event), line));
  }

  /** A link to another note is opened as Obsidian would; any other link is left to Obsidian. */
  private followLink(section: Section, link: HTMLElement, event: MouseEvent): void {
    if (!link.hasClass('internal-link') || section.vaultPath === null) return;
    const target = link.getAttr('data-href') ?? link.getAttr('href');
    if (target === null || target === '') return;
    event.preventDefault();
    const sourcePath = section.vaultPath;
    safely('Open link', () => this.host.openLink(target, sourcePath, Keymap.isModEvent(event)));
  }

  // ------------------------------------------------------------------- header

  private scopeText(folders: readonly ScopeFolder[]): string {
    const scope = this.about;
    if (scope.kind === 'manuscript') return SCOPE_MANUSCRIPT_TEXT;
    return folders.find((folder) => folder.id === scope.id)?.name ?? 'Folder';
  }

  private showHeader(): void {
    const els = this.els;
    if (!els) return;
    // The name of a folder is the writer's own text.
    els.scopeButton.setText(this.scopeText(this.host.folders()));
    els.scopeButton.setAttr('dir', this.about.kind === 'folder' ? 'auto' : null);
  }

  /** How many scenes are on show, and how many words they have together (as far as they are counted). */
  private showSummary(): void {
    const els = this.els;
    if (!els) return;
    if (this.sections.length === 0) {
      els.summary.setText('');
      return;
    }
    let words = 0;
    for (const section of this.sections) {
      const count = section.vaultPath === null ? null : this.host.wordsOf(section.vaultPath);
      if (typeof count === 'number') words += count;
    }
    els.summary.setText(`${describeScenes(this.sections.length)}, ${describeCount(words)}`);
  }

  private showScopeMenu(button: HTMLElement): void {
    const scope = this.about;
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(SCOPE_MANUSCRIPT_TEXT)
        .setChecked(scope.kind === 'manuscript')
        .onClick(() => {
          this.choose({ kind: 'manuscript' });
        });
    });
    const folders = this.host.folders();
    if (folders.length > 0) menu.addSeparator();
    for (const folder of folders) {
      menu.addItem((item) => {
        // A folder's name is the writer's own text; a folder inside another is set in.
        const title = createFragment();
        title.createSpan({
          cls: `spellbook-scrivenings-menu-name spellbook-scrivenings-menu-depth-${Math.min(folder.depth, 3)}`,
          text: folder.name,
          attr: { dir: 'auto' },
        });
        item
          .setTitle(title)
          .setChecked(scope.kind === 'folder' && scope.id === folder.id)
          .onClick(() => {
            this.choose({ kind: 'folder', id: folder.id });
          });
      });
    }
    menu.showAtPosition(placeUnder(button));
  }
}

export function createScriveningsView(leaf: WorkspaceLeaf, host: ScriveningsHost): ScriveningsView {
  return new ScriveningsView(leaf, host);
}
