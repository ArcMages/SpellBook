// What version 1.1 added to the export, as the writer meets it: the e-book
// with its cover, the presets, the window's memory for each project, the
// pages before and after the text, and a scene's own export properties. The
// real feature runs on a vault in memory (stage.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromUtf8, unzipStored } from '../../../src/core/export';
import { MATTER_HEADING, NO_COVER_TEXT } from '../../../src/features/export/exportModal';
import { PROJECT_OPTIONS_KEY } from '../../../src/features/export/exporter';
import { Modal as StubModal, Notice as StubNotice, resetPlatform } from '../../obsidianStub';
import type { DropdownComponent, FakeElement, Setting } from '../../obsidianStub';
import { TODAY } from '../../storeHarness';
import {
  CLOSING,
  CLOSING_LINE,
  LETTER,
  LETTER_LINE,
  NIGHT_LINE,
  NOVEL_INDEX,
  OPENING_LINE,
  SECOND_INDEX,
  dropdown,
  exportsOf,
  inNovel,
  novelVault,
  openWindow,
  pressExport,
  toggle,
  wire,
} from './stage';
import type { Wired, Window } from './stage';
import { textOf } from './xml';

beforeEach(() => {
  StubModal.opened.length = 0;
  StubNotice.shown.length = 0;
  resetPlatform();
});

afterEach(() => {
  resetPlatform();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

/** Every row of the window, also those folded inside the pages before and after the text. */
function allRows(window: Window): Setting[] {
  return window.content.all().flatMap((element: FakeElement) => element.settings);
}

/** The row with this name; `nth` picks among rows of the same name ("Note"). */
function deepRow(window: Window, name: string, nth = 0): Setting {
  const found = allRows(window).filter((setting) => setting.nameEl.text === name)[nth];
  if (!found) throw new Error(`the window has no row "${name}"`);
  return found;
}

function deepDropdown(window: Window, name: string, nth = 0): DropdownComponent {
  return deepRow(window, name, nth).components[0] as DropdownComponent;
}

async function exportNow(stage: Wired, window: Window): Promise<string> {
  const before = exportsOf(stage.vault);
  await pressExport(stage, window);
  const made = exportsOf(stage.vault).filter((path) => !before.includes(path));
  if (made.length !== 1) throw new Error(`expected one new file, found ${made.length}: ${StubNotice.shown.map((notice) => notice.message).join(' | ')}`);
  return made[0] as string;
}

describe('an e-book from the window', () => {
  it('is a new .epub file in the Exports folder, with the scenes in order and the chosen cover', async () => {
    const vault = novelVault();
    vault.seed('Novel/Research/cover.png', { bytes: PNG });
    vault.seed('Pictures/elsewhere.jpg', { bytes: PNG });
    vault.seed('Pictures/drawing.bmp', { bytes: PNG });
    const stage = await wire(vault);
    const window = openWindow(stage);
    dropdown(window, 'Format').choose('epub');
    // The project's own pictures first, then the rest of the vault; only kinds an e-book can hold.
    expect(dropdown(window, 'Cover').selectEl.children.map((option) => [option.value, option.text])).toEqual([
      ['', NO_COVER_TEXT],
      ['Novel/Research/cover.png', 'Novel/Research/cover.png'],
      ['Pictures/elsewhere.jpg', 'Pictures/elsewhere.jpg'],
    ]);
    dropdown(window, 'Cover').choose('Novel/Research/cover.png');
    const path = await exportNow(stage, window);
    expect(path).toBe(`Novel/Exports/My Novel ${TODAY}.epub`);
    const entries = unzipStored(stage.vault.bytesOf(path));
    expect(entries[0]?.name).toBe('mimetype');
    expect(entries.find((entry) => entry.name === 'OEBPS/images/cover.png')?.data).toEqual(PNG);
    const pages = entries.filter((entry) => /OEBPS\/text-\d+\.xhtml$/.test(entry.name)).map((entry) => textOf(fromUtf8(entry.data))).join('\n');
    const order = [OPENING_LINE, 'Part one', LETTER_LINE, NIGHT_LINE, CLOSING_LINE];
    let from = 0;
    for (const piece of order) {
      const at = pages.indexOf(piece, from);
      expect(at, piece).toBeGreaterThanOrEqual(from);
      from = at + piece.length;
    }
    // The picture was only read: nothing but the export was written.
    expect(stage.vault.writes.map((write) => write.op)).toEqual(['createFolder', 'createBinary']);
  });

  it('says so when the cover cannot be read, and makes the book without it', async () => {
    const vault = novelVault();
    vault.seed('Novel/Research/cover.png', { bytes: PNG });
    const stage = await wire(vault);
    const window = openWindow(stage);
    dropdown(window, 'Format').choose('epub');
    dropdown(window, 'Cover').choose('Novel/Research/cover.png');
    // Taken away on another device while the window is open.
    stage.vault.external.delete('Novel/Research/cover.png');
    const path = await exportNow(stage, window);
    expect(unzipStored(stage.vault.bytesOf(path)).some((entry) => entry.name.includes('cover'))).toBe(false);
    expect(window.content.fullText).toContain('The cover picture could not be read');
  });
});

describe('the presets and the window\'s memory', () => {
  it('a preset sets the switches, and the choices are remembered for each project by itself', async () => {
    const stage = await wire();
    const first = openWindow(stage);
    dropdown(first, 'Preset').choose('reading');
    expect(toggle(first, 'Line at the top of each page').getValue()).toBe(false);
    expect(toggle(first, 'List of contents').getValue()).toBe(true);
    dropdown(first, 'Format').choose('html');
    await exportNow(stage, first);
    const raw = stage.storage.load(PROJECT_OPTIONS_KEY);
    const saved = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, { preset: string }>;
    expect(Object.keys(saved)).toEqual([NOVEL_INDEX]);
    expect(saved[NOVEL_INDEX]?.preset).toBe('reading');

    const again = openWindow(stage);
    expect(dropdown(again, 'Preset').getValue()).toBe('reading');
    expect(dropdown(again, 'Format').getValue()).toBe('html');

    // Another project remembers its own.
    expect((await stage.store.openProject(SECOND_INDEX)).status).toBe('done');
    const second = openWindow(stage);
    dropdown(second, 'Preset').choose('proof');
    await pressExport(stage, second);
    expect(stage.vault.listFiles('Second/Exports')).toHaveLength(1);
    expect((await stage.store.openProject(NOVEL_INDEX)).status).toBe('done');
    expect(dropdown(openWindow(stage), 'Preset').getValue()).toBe('reading');
    expect((await stage.store.openProject(SECOND_INDEX)).status).toBe('done');
    expect(dropdown(openWindow(stage), 'Preset').getValue()).toBe('proof');
  });

  it('a proof in Word has wide margins and numbered lines', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    dropdown(window, 'Preset').choose('proof');
    const path = await exportNow(stage, window);
    const main = fromUtf8(unzipStored(stage.vault.bytesOf(path)).find((entry) => entry.name === 'word/document.xml')?.data ?? new Uint8Array());
    expect(main).toContain('w:left="2880"');
    expect(main).toContain('<w:lnNumType');
  });
});

describe('the pages before and after the text', () => {
  it('are folded away, and can be typed or taken from a note of the project', async () => {
    const vault = novelVault();
    vault.seed('Novel/Research/Thanks.md', { frontmatter: { tags: ['matter'] }, body: '# With thanks\nTo the harbour master.\n' });
    const stage = await wire(vault);
    const window = openWindow(stage);
    expect(window.content.withClass('spellbook-export-matter')[0]?.children[0]?.text).toBe(MATTER_HEADING);
    deepDropdown(window, 'Dedication').choose('typed');
    const area = window.content.withClass('spellbook-export-matter-text')[0] as FakeElement;
    expect(area.getAttr('dir')).toBe('auto');
    area.value = 'לאחותי';
    area.dispatch('input');
    deepDropdown(window, 'Acknowledgements').choose('note');
    // The plugin's own notes are not offered; the writer's are.
    const notes = deepDropdown(window, 'Note').selectEl.children.map((option) => option.value);
    expect(notes).toContain('Research/Thanks.md');
    expect(notes).toContain('Manuscript/Opening.md');
    expect(notes.some((note) => note.startsWith('Exports/') || note.startsWith('Stats/'))).toBe(false);
    deepDropdown(window, 'Note').choose('Research/Thanks.md');
    // What was typed stays when another page is changed.
    expect((window.content.withClass('spellbook-export-matter-text')[0] as FakeElement).value).toBe('לאחותי');

    dropdown(window, 'Format').choose('markdown');
    const path = await exportNow(stage, window);
    const text = await stage.vault.readText(path);
    expect(text.indexOf('לאחותי')).toBeLessThan(text.indexOf(OPENING_LINE));
    expect(text.indexOf('## With thanks\n\nTo the harbour master.')).toBeGreaterThan(text.indexOf(CLOSING_LINE));
    expect(text).not.toContain('tags');
    // The note was read, not changed.
    expect(stage.vault.textOf('Novel/Research/Thanks.md')).toContain('# With thanks');

    // Remembered for this project, typed text and all.
    const again = openWindow(stage);
    expect(deepDropdown(again, 'Dedication').getValue()).toBe('typed');
    expect((again.content.withClass('spellbook-export-matter-text')[0] as FakeElement).value).toBe('לאחותי');
    expect(deepDropdown(again, 'Note').getValue()).toBe('Research/Thanks.md');
  });
});

describe('a scene\'s own export properties', () => {
  it('"export-page-break" and "export-title" are read from the scene, and change no note', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(inNovel(CLOSING), (frontmatter) => {
      frontmatter['export-title'] = true;
    });
    vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['export-page-break'] = true;
    });
    const stage = await wire(vault);
    const before = stage.vault.textOf(inNovel(CLOSING));
    const window = openWindow(stage);
    dropdown(window, 'Format').choose('html');
    const path = await exportNow(stage, window);
    const html = await stage.vault.readText(path);
    expect(html).toMatch(/<h4 class="scene-title[^"]*" id="part-\d+" dir="ltr">Closing<\/h4>/);
    expect(html).not.toMatch(/scene-title[^>]*>Opening</);
    expect(stage.vault.textOf(inNovel(CLOSING))).toBe(before);
  });
});
