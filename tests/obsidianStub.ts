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

/**
 * A stand-in for an HTML element. The tests run without a browser, so this
 * only remembers what was done to it: text, classes, attributes, children and
 * event listeners. It has the helpers Obsidian adds to elements (empty,
 * setText, addClass, setAttr, createEl, createDiv).
 */
export class FakeElement {
  readonly tag: string;
  text = '';
  value = '';
  disabled = false;
  focused = false;
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
    this.children.length = 0;
    this.settings.length = 0;
    this.text = '';
  }

  setText(text: string): void {
    this.text = text;
  }

  addClass(...classes: string[]): void {
    for (const cls of classes) this.classes.add(cls);
  }

  setAttr(name: string, value: string | number | boolean | null): void {
    this.attrs[name] = value;
  }

  createEl(
    tag: string,
    info: { text?: string; value?: string; cls?: string; attr?: Record<string, string | number | boolean | null> } = {},
  ): FakeElement {
    const child = new FakeElement(tag);
    child.text = info.text ?? '';
    child.value = info.value ?? '';
    if (info.cls !== undefined) child.addClass(...info.cls.split(' '));
    Object.assign(child.attrs, info.attr ?? {});
    this.children.push(child);
    return child;
  }

  createDiv(info: { text?: string; cls?: string } = {}): FakeElement {
    return this.createEl('div', info);
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Deliver an event to the listeners, as the browser would. */
  dispatch(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
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
}

/** The parts of Plugin that src/main.ts uses. */
export class Plugin {
  app: unknown;
  manifest: unknown;
  readonly settingTabs: unknown[] = [];
  readonly commands: StubCommand[] = [];
  /** Every event handed to registerEvent, for tests that check nothing is left attached. */
  readonly registeredEvents: StubEventRef[] = [];
  private readonly cleanups: Array<() => unknown> = [];

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }

  addCommand(command: StubCommand): StubCommand {
    this.commands.push(command);
    return command;
  }

  register(callback: () => unknown): void {
    this.cleanups.push(callback);
  }

  registerEvent(ref: StubEventRef): void {
    this.registeredEvents.push(ref);
  }

  /** What Obsidian does when the plugin is disabled. */
  unload(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    for (const ref of this.registeredEvents.splice(0)) ref.e?.offref(ref);
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
