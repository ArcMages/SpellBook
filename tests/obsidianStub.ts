// A stand-in for the "obsidian" module, used only by the unit tests.
//
// The real module exists only inside the Obsidian app (the npm package holds
// type declarations and no code), so vitest.config.mts points imports of
// "obsidian" here. It provides just the pieces the plugin's code uses.
//
// YAML: there is no YAML library in this project, so the stand-in reads and
// writes frontmatter as JSON, which is itself valid YAML. This is enough to
// test what the plugin does with frontmatter; it does not test Obsidian's own
// YAML formatting.

export class TAbstractFile {
  path = '';
  name = '';
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  basename = '';
  extension = '';
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === '/' || this.path === '';
  }
}

/** Same rules as Obsidian's normalizePath (see its documentation in obsidian.d.ts). */
export function normalizePath(path: string): string {
  const tidy = path
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(new RegExp(`[${String.fromCharCode(0x00a0, 0x202f)}]`, 'g'), ' ')
    .normalize('NFC');
  return tidy === '' ? '/' : tidy;
}

export function parseYaml(yaml: string): unknown {
  return yaml.trim() === '' ? null : JSON.parse(yaml);
}

export function stringifyYaml(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const match = /^---\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
  const from = content.indexOf('\n') + 1;
  const frontmatter = match[1] ?? '';
  return { exists: true, frontmatter, from, to: from + frontmatter.length, contentStart: match[0].length };
}

// The plugin's timers call window.setTimeout, as code that runs in Obsidian
// should. Plain Node has no `window`, so the stand-in provides one: Node's own
// global object, which has the same timer functions.
const nodeGlobals = globalThis as { window?: unknown };
if (nodeGlobals.window === undefined) nodeGlobals.window = globalThis;

/** What createEl, createDiv and createSpan accept: Obsidian's DomElementInfo, or just a class name. */
export type FakeElementInfo =
  | string
  | {
      text?: string;
      value?: string;
      cls?: string | string[];
      attr?: Record<string, string | number | boolean | null>;
    };

/** Where an element is on the screen, as getBoundingClientRect() reports it. */
export interface FakeRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/**
 * A stand-in for an HTML element. The tests run without a browser, so this
 * only remembers what was done to it: text, classes, attributes, children and
 * event listeners. It has the helpers Obsidian adds to elements (empty,
 * setText, addClass, toggleClass, setAttr, createEl, createDiv, createSpan).
 *
 * It lays nothing out. Sizes and positions are whatever a test sets:
 * `clientWidth`, `scrollTop` and `rect`.
 */
export class FakeElement {
  readonly tag: string;
  text = '';
  value = '';
  disabled = false;
  focused = false;
  /** True once select() was called on it (a text field whose text was selected). */
  selected = false;
  parent: FakeElement | null = null;
  /** The icon put into this element with setIcon(), if any. */
  icon: string | null = null;
  scrollTop = 0;
  clientWidth = 0;
  rect: FakeRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  readonly classes = new Set<string>();
  readonly attrs: Record<string, string | number | boolean | null> = {};
  readonly children: FakeElement[] = [];
  /** The Setting rows built inside this element, in order. */
  readonly settings: Setting[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();

  constructor(tag = 'div') {
    this.tag = tag;
  }

  empty(): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.settings.length = 0;
    this.text = '';
    this.icon = null;
  }

  setText(text: string): void {
    this.text = text;
  }

  addClass(...classes: string[]): void {
    for (const cls of classes) if (cls !== '') this.classes.add(cls);
  }

  removeClass(...classes: string[]): void {
    for (const cls of classes) this.classes.delete(cls);
  }

  toggleClass(classes: string | string[], value: boolean): void {
    for (const cls of Array.isArray(classes) ? classes : [classes]) {
      if (value) this.addClass(cls);
      else this.removeClass(cls);
    }
  }

  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }

  /** As in Obsidian: null takes the attribute away. */
  setAttr(name: string, value: string | number | boolean | null): void {
    if (value === null) delete this.attrs[name];
    else this.attrs[name] = value;
  }

  getAttr(name: string): string | null {
    const value = this.attrs[name];
    return value === undefined || value === null ? null : String(value);
  }

  createEl(tag: string, info: FakeElementInfo = {}): FakeElement {
    const options = typeof info === 'string' ? { cls: info } : info;
    const child = new FakeElement(tag);
    child.parent = this;
    child.text = options.text ?? '';
    child.value = options.value ?? '';
    const classes = Array.isArray(options.cls) ? options.cls : (options.cls ?? '').split(' ');
    child.addClass(...classes);
    for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttr(name, value);
    this.children.push(child);
    return child;
  }

  createDiv(info: FakeElementInfo = {}): FakeElement {
    return this.createEl('div', info);
  }

  createSpan(info: FakeElementInfo = {}): FakeElement {
    return this.createEl('span', info);
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Deliver an event to the listeners, as the browser would. */
  dispatch(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** How many listeners are waiting for an event of this type. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  focus(): void {
    this.focused = true;
  }

  /** As on a text field: all of its text becomes the selection. */
  select(): void {
    this.selected = true;
  }

  getBoundingClientRect(): FakeRect {
    return { ...this.rect };
  }

  // --- helpers for the tests (not part of the DOM)

  /** This element and everything inside it, in document order. */
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }

  /** Everything inside this element (and the element itself) that has all the given classes. */
  withClass(...classes: string[]): FakeElement[] {
    return this.all().filter((element) => classes.every((cls) => element.classes.has(cls)));
  }

  /** The nearest element around this one (or this one) that has the class, or null. */
  closest(cls: string): FakeElement | null {
    for (let element: FakeElement | null = this; element; element = element.parent) {
      if (element.classes.has(cls)) return element;
    }
    return null;
  }

  /** All the text in this element, as a reader would see it. */
  get fullText(): string {
    return [this.text, ...this.children.map((child) => child.fullText)].filter((part) => part !== '').join(' ');
  }
}

/** An event reference as handed out by tests/fakeObsidianApp.ts: it knows where it is attached. */
interface StubEventRef {
  e?: { offref(ref: unknown): void };
}

export interface StubCommand {
  id: string;
  name: string;
  callback?: () => unknown;
  /** As in Obsidian: asked with true whether the command can run now, and with false to run it. */
  checkCallback?: (checking: boolean) => boolean | void;
}

/** A button on the ribbon, as added with addRibbonIcon(). */
export interface StubRibbonIcon {
  icon: string;
  title: string;
  callback: (event: unknown) => unknown;
  /** False once the plugin has been unloaded: Obsidian takes the button away. */
  shown: boolean;
}

/** What the stand-in asks of a workspace that can show the plugin's views (see tests/fakeObsidianApp.ts). */
interface ViewRegistry {
  registerViewCreator?(type: string, creator: (leaf: unknown) => unknown): void;
  unregisterViewCreator?(type: string): void;
}

/** The parts of Plugin that src/main.ts uses. */
export class Plugin {
  app: unknown;
  manifest: unknown;
  readonly settingTabs: unknown[] = [];
  readonly commands: StubCommand[] = [];
  readonly ribbonIcons: StubRibbonIcon[] = [];
  /** The view types registered with registerView(). */
  readonly viewTypes: string[] = [];
  /** Every event handed to registerEvent, for tests that check nothing is left attached. */
  readonly registeredEvents: StubEventRef[] = [];
  private readonly cleanups: Array<() => unknown> = [];

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  private get viewRegistry(): ViewRegistry | undefined {
    return (this.app as { workspace?: ViewRegistry } | undefined)?.workspace;
  }

  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }

  addCommand(command: StubCommand): StubCommand {
    this.commands.push(command);
    return command;
  }

  addRibbonIcon(icon: string, title: string, callback: (event: unknown) => unknown): FakeElement {
    const entry: StubRibbonIcon = { icon, title, callback, shown: true };
    this.ribbonIcons.push(entry);
    const element = new FakeElement();
    element.icon = icon;
    return element;
  }

  registerView(type: string, creator: (leaf: unknown) => unknown): void {
    this.viewTypes.push(type);
    this.viewRegistry?.registerViewCreator?.(type, creator);
  }

  register(callback: () => unknown): void {
    this.cleanups.push(callback);
  }

  registerEvent(ref: StubEventRef): void {
    this.registeredEvents.push(ref);
  }

  /**
   * What Obsidian does when the plugin is disabled: the plugin's own clean-up
   * runs, its listeners are detached, its ribbon buttons go, and its view
   * types stop existing, which closes any of its views that are open.
   */
  unload(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    for (const ref of this.registeredEvents.splice(0)) ref.e?.offref(ref);
    for (const icon of this.ribbonIcons) icon.shown = false;
    for (const type of this.viewTypes.splice(0)) this.viewRegistry?.unregisterViewCreator?.(type);
  }
}

/** The leaf a view lives in, as far as a view needs to know it. */
export interface StubLeaf {
  app: unknown;
}

/**
 * The parts of ItemView (and of View and Component under it) that the
 * plugin's views use. open() and close() do what Obsidian does when it shows
 * a view and when it takes it away.
 */
export class ItemView {
  app: unknown;
  leaf: StubLeaf;
  navigation = true;
  icon = '';
  readonly containerEl = new FakeElement();
  readonly contentEl = new FakeElement();
  /** Every event handed to registerEvent, for tests that check nothing is left attached. */
  readonly registeredEvents: StubEventRef[] = [];
  private readonly cleanups: Array<() => unknown> = [];

  constructor(leaf: StubLeaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.contentEl.addClass('view-content');
  }

  getViewType(): string {
    return '';
  }

  getDisplayText(): string {
    return '';
  }

  getIcon(): string {
    return this.icon;
  }

  onResize(): void {}

  register(callback: () => unknown): void {
    this.cleanups.push(callback);
  }

  registerEvent(ref: StubEventRef): void {
    this.registeredEvents.push(ref);
  }

  protected onOpen(): Promise<void> {
    return Promise.resolve();
  }

  protected onClose(): Promise<void> {
    return Promise.resolve();
  }

  /** Obsidian shows the view. */
  async open(): Promise<void> {
    await this.onOpen();
  }

  /** Obsidian takes the view away: the view's own clean-up, then everything it registered. */
  async close(): Promise<void> {
    await this.onClose();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    for (const ref of this.registeredEvents.splice(0)) ref.e?.offref(ref);
  }
}

/** Which kind of device Obsidian says it is running on. Tests change these and put them back. */
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isPhone: false,
  isTablet: false,
};

/** Make the stand-in report a desktop again. */
export function resetPlatform(): void {
  Object.assign(Platform, { isDesktop: true, isMobile: false, isPhone: false, isTablet: false });
}

interface StubUserEvent {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  button?: number;
}

export class Keymap {
  /** Same rules as Obsidian's (see its documentation in obsidian.d.ts). */
  static isModEvent(event?: StubUserEvent | null): 'tab' | 'split' | 'window' | boolean {
    if (!event) return false;
    const mod = event.metaKey === true || event.ctrlKey === true;
    if (!mod) return event.button === 1 ? 'tab' : false;
    if (event.altKey === true) return event.shiftKey === true ? 'window' : 'split';
    return 'tab';
  }
}

/** Icon names the stand-in pretends Obsidian does not know. Tests add to it and clear it. */
export const unknownIcons = new Set<string>();

export function getIcon(iconId: string): object | null {
  return unknownIcons.has(iconId) ? null : { iconId };
}

/** As in Obsidian: replaces what is in the element with the icon, or does nothing for an unknown icon. */
export function setIcon(parent: FakeElement, iconId: string): void {
  if (unknownIcons.has(iconId)) return;
  parent.empty();
  parent.icon = iconId;
  parent.createEl('svg', { cls: 'svg-icon' });
}

export class MenuItem {
  title = '';
  icon: string | null = null;
  checked: boolean | null = null;
  disabled = false;
  warning = false;
  private clicked: ((event: unknown) => unknown) | null = null;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string | null): this {
    this.icon = icon;
    return this;
  }

  setChecked(checked: boolean | null): this {
    this.checked = checked;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  setWarning(warning: boolean): this {
    this.warning = warning;
    return this;
  }

  onClick(callback: (event: unknown) => unknown): this {
    this.clicked = callback;
    return this;
  }

  /** As if the writer picked this item. A disabled item does nothing. */
  click(): void {
    if (!this.disabled) this.clicked?.({});
  }
}

/** A menu. Nothing is shown; every menu that was shown is kept in `Menu.shown` for the tests. */
export class Menu {
  static readonly shown: Menu[] = [];

  readonly items: MenuItem[] = [];
  position: { x: number; y: number; width?: number } | null = null;
  /** The event handed to showAtMouseEvent(), when the menu was shown that way. */
  mouseEvent: unknown = null;
  /** The items and the lines between them, top to bottom; null stands for a line. */
  private readonly layout: Array<MenuItem | null> = [];

  addItem(callback: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    this.items.push(item);
    this.layout.push(item);
    callback(item);
    return this;
  }

  addSeparator(): this {
    this.layout.push(null);
    return this;
  }

  showAtPosition(position: { x: number; y: number; width?: number }): this {
    this.position = position;
    Menu.shown.push(this);
    return this;
  }

  showAtMouseEvent(event: unknown): this {
    this.mouseEvent = event;
    Menu.shown.push(this);
    return this;
  }

  // --- helpers for the tests

  /**
   * The menu as a reader sees it, top to bottom: each item's title, "---"
   * for a line between items, and "(off)" after an item that cannot be picked.
   */
  get outline(): string[] {
    return this.layout.map((entry) => (entry === null ? '---' : `${entry.title}${entry.disabled ? ' (off)' : ''}`));
  }

  /** The item with this title, or a failed test. */
  item(title: string): MenuItem {
    const found = this.items.filter((item) => item.title === title);
    if (found.length !== 1) throw new Error(`expected one menu item "${title}", found ${found.length}`);
    return found[0] as MenuItem;
  }
}

export class PluginSettingTab {
  app: unknown;
  containerEl = new FakeElement();

  constructor(app: unknown, _plugin: unknown) {
    this.app = app;
  }

  hide(): void {
    this.containerEl.empty();
  }
}

/** A notice. Nothing is shown; every notice is kept in `Notice.shown` for the tests to read. */
export class Notice {
  static readonly shown: Notice[] = [];

  message: string;
  readonly duration: number | undefined;
  hidden = false;

  constructor(message: string, duration?: number) {
    this.message = message;
    this.duration = duration;
    Notice.shown.push(this);
  }

  setMessage(message: string): this {
    this.message = message;
    return this;
  }

  hide(): void {
    this.hidden = true;
  }
}

/** A modal window. open() and close() call onOpen() and onClose(), as Obsidian does. */
export class Modal {
  static readonly opened: Modal[] = [];

  app: unknown;
  readonly titleEl = new FakeElement();
  readonly contentEl = new FakeElement();
  readonly modalEl = new FakeElement();
  isOpen = false;

  constructor(app: unknown) {
    this.app = app;
  }

  open(): void {
    this.isOpen = true;
    Modal.opened.push(this);
    void this.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
  }

  onOpen(): Promise<void> | void {}

  onClose(): void {}
}

/** What a fuzzy list hands to renderSuggestion and onChooseSuggestion. */
export interface FuzzyMatch<T> {
  item: T;
  match: { score: number; matches: Array<[number, number]> };
}

/**
 * A list to pick from, as Obsidian's quick switcher is. Nothing is shown:
 * `shownFor()` gives the list a query would leave, and `pick()` chooses.
 * (Obsidian matches loosely, letter by letter; the stand-in simply looks for
 * the query inside the text, ignoring capitals.)
 */
export abstract class FuzzySuggestModal<T> extends Modal {
  readonly inputEl = new FakeElement('input');
  readonly resultContainerEl = new FakeElement();
  emptyStateText = 'No results found.';
  limit = 100;

  setPlaceholder(placeholder: string): void {
    this.inputEl.setAttr('placeholder', placeholder);
  }

  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, event: unknown): void;

  getSuggestions(query: string): Array<FuzzyMatch<T>> {
    const wanted = query.trim().toLowerCase();
    return this.getItems()
      .filter((item) => this.getItemText(item).toLowerCase().includes(wanted))
      .map((item) => ({ item, match: { score: 0, matches: [] } }));
  }

  renderSuggestion(match: FuzzyMatch<T>, el: FakeElement): void {
    el.setText(this.getItemText(match.item));
  }

  onChooseSuggestion(match: FuzzyMatch<T>, event: unknown): void {
    this.onChooseItem(match.item, event);
  }

  // --- helpers for the tests

  /** The rows the list shows for what was typed, as drawn by renderSuggestion. */
  shownFor(query = ''): FakeElement[] {
    return this.getSuggestions(query).map((match) => {
      const row = this.resultContainerEl.createDiv({ cls: 'suggestion-item' });
      this.renderSuggestion(match, row);
      return row;
    });
  }

  /** As if the writer picked the row with this text: the window closes, then the choice is handed on. */
  pick(text: string): void {
    const match = this.getSuggestions('').find((candidate) => this.getItemText(candidate.item) === text);
    if (!match) throw new Error(`the list has no "${text}"`);
    this.close();
    this.onChooseSuggestion(match, {});
  }
}

export class TextComponent {
  readonly inputEl = new FakeElement('input');
  private changed: ((value: string) => unknown) | null = null;

  setPlaceholder(placeholder: string): this {
    this.inputEl.setAttr('placeholder', placeholder);
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changed = callback;
    return this;
  }

  /** As if the writer typed this into the field. */
  type(value: string): void {
    this.inputEl.value = value;
    this.changed?.(value);
  }
}

export class DropdownComponent {
  readonly selectEl = new FakeElement('select');
  private changed: ((value: string) => unknown) | null = null;

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  getValue(): string {
    return this.selectEl.value;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changed = callback;
    return this;
  }

  /** As if the writer picked this option. */
  choose(value: string): void {
    this.selectEl.value = value;
    this.changed?.(value);
  }
}

export class ButtonComponent {
  readonly buttonEl = new FakeElement('button');
  disabled = false;
  private clicked: ((event: unknown) => unknown) | null = null;

  setButtonText(text: string): this {
    this.buttonEl.text = text;
    return this;
  }

  setCta(): this {
    this.buttonEl.addClass('mod-cta');
    return this;
  }

  setWarning(): this {
    this.buttonEl.addClass('mod-warning');
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  onClick(callback: (event: unknown) => unknown): this {
    this.clicked = callback;
    return this;
  }

  /** As if the writer clicked the button. A disabled button does nothing. */
  click(): void {
    if (!this.disabled) this.clicked?.({});
  }
}

/** One row of a settings page or a form. */
export class Setting {
  readonly settingEl: FakeElement;
  readonly nameEl: FakeElement;
  readonly descEl: FakeElement;
  readonly controlEl: FakeElement;
  readonly components: Array<TextComponent | DropdownComponent | ButtonComponent> = [];

  constructor(containerEl: FakeElement) {
    containerEl.settings.push(this);
    this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
    this.nameEl = this.settingEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.settingEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }

  setName(name: string): this {
    this.nameEl.text = name;
    return this;
  }

  setDesc(description: string): this {
    this.descEl.text = description;
    return this;
  }

  setHeading(): this {
    this.settingEl.addClass('setting-item-heading');
    return this;
  }

  addText(callback: (component: TextComponent) => unknown): this {
    const component = new TextComponent();
    this.components.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => unknown): this {
    const component = new DropdownComponent();
    this.components.push(component);
    callback(component);
    return this;
  }

  addButton(callback: (component: ButtonComponent) => unknown): this {
    const component = new ButtonComponent();
    this.components.push(component);
    callback(component);
    return this;
  }
}
