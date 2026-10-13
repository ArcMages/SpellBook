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

/** The parts of Plugin that src/main.ts uses. */
export class Plugin {
  app: unknown;
  manifest: unknown;
  readonly settingTabs: unknown[] = [];
  private readonly cleanups: Array<() => unknown> = [];

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }

  register(callback: () => unknown): void {
    this.cleanups.push(callback);
  }

  /** What Obsidian does when the plugin is disabled. */
  unload(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

export class PluginSettingTab {
  app: unknown;
  containerEl = { empty(): void {} };

  constructor(app: unknown, _plugin: unknown) {
    this.app = app;
  }
}

export class Setting {
  constructor(_containerEl: unknown) {}

  setName(_name: string): this {
    return this;
  }

  setDesc(_description: string): this {
    return this;
  }
}
