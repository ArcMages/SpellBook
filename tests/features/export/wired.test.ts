// The export as the writer meets it: the command, the window, and the file
// that comes out. The real feature runs on a vault in memory (stage.ts).
//
// What these tests are for, above all: an exported file holds the scenes in
// binder order and leaves out what is switched off, in each of the three
// formats; a Hebrew scene goes out right to left; the file is a new file in
// the project's Exports folder; nothing is ever written over; and no note of
// the writer's is changed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromUtf8, unzipStored } from '../../../src/core/export';
import { EXPORTED_TITLE, ExportDoneModal, VAULT_ROOT_TEXT, fileNameOf, folderOf } from '../../../src/features/export/doneModal';
import type { DoneOutcome } from '../../../src/features/export/doneModal';
import type { Exporter } from '../../../src/features/export/exporter';
import {
  COULD_NOT_OPEN_TEXT,
  COULD_NOT_SHOW_TEXT,
  EXPORT_WINDOW_TITLE,
  FORMAT_NOTES,
  HEADINGS_NOTE,
  HIDDEN_FILE_NOTE,
  MATTER_NOTE,
  MOBILE_PDF_NOTE,
  MOBILE_WHERE_NOTE,
  PRESET_NOTES,
  WHOLE_MANUSCRIPT_TEXT,
} from '../../../src/features/export/exportModal';
import { NOTHING_TEXT, NO_PROJECT_TEXT, OPTIONS_KEY } from '../../../src/features/export/exporter';
import { EXPORT_COMMANDS } from '../../../src/features/export/index';
import { Modal as StubModal, Notice as StubNotice, Platform as StubPlatform, resetPlatform } from '../../obsidianStub';
import { setLayoutChoice, stopLayout } from '../../../src/ui/layout';
import type { FakeElement } from '../../obsidianStub';
import { MemoryDeviceStorage, TODAY } from '../../storeHarness';
import {
  CLOSING,
  CLOSING_LINE,
  DRAFT,
  DRAFT_LINE,
  INNER_NAME,
  LETTER,
  LETTER_LINE,
  NIGHT,
  NIGHT_LINE,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  OPENING_LINE,
  PRIVATE_NOTE,
  SECOND_INDEX,
  button,
  calm,
  choicesOf,
  doneWindow,
  dropdown,
  exportsOf,
  hasRow,
  inNovel,
  novelVault,
  openWindow,
  pressExport,
  textField,
  textsOf,
  toggle,
  wire,
} from './stage';
import type { Wired } from './stage';
import { textOf } from './xml';

beforeEach(() => {
  StubModal.opened.length = 0;
  StubNotice.shown.length = 0;
  resetPlatform();
});

afterEach(() => {
  stopLayout();
  resetPlatform();
});

const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

/** The text of every note in the vault, by path: to show that an export changed none. */
function notesOf(stage: Wired): Record<string, string> {
  return Object.fromEntries(
    stage.vault
      .paths()
      .filter((path) => !path.startsWith('Novel/Exports/'))
      .map((path) => [path, stage.vault.textOf(path)]),
  );
}

/** Choose a format in a fresh window, press Export, and give the new file's vault path. */
async function exportAs(stage: Wired, format: string, prepare?: (window: ReturnType<typeof openWindow>) => void): Promise<string> {
  const before = exportsOf(stage.vault);
  const window = openWindow(stage);
  dropdown(window, 'Format').choose(format);
  prepare?.(window);
  await pressExport(stage, window);
  const made = exportsOf(stage.vault).filter((path) => !before.includes(path));
  if (made.length !== 1) throw new Error(`expected one new file, found ${made.length}: ${notices().join(' | ')}`);
  return made[0] as string;
}

/** The lines of the novel that must be in an export of all of it, in binder order. */
const IN_ORDER = [OPENING_LINE, 'Part one', LETTER_LINE, INNER_NAME, NIGHT_LINE, CLOSING_LINE];

function expectInOrder(text: string, pieces: readonly string[]): void {
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    expect(at, `"${piece}" should come after what is before it`).toBeGreaterThanOrEqual(from);
    from = at + piece.length;
  }
}

function expectOnlyTheManuscript(text: string): void {
  expect(text).not.toContain(DRAFT_LINE); // its "compile" switch is off
  expect(text).not.toContain(PRIVATE_NOTE); // a comment
  expect(text).not.toContain('Anna arrives'); // a property
  expect(text).not.toContain('status');
  expect(text).not.toContain('Not part of any project');
  expect(text).not.toContain('Long ago'); // the other project
}

// ---------------------------------------------------------------- the command

describe('the export command', () => {
  it('is called "Export manuscript" and opens the export window', async () => {
    const stage = await wire();
    expect(stage.plugin.commands.map((command) => [command.id, command.name])).toEqual([['export-manuscript', 'Export manuscript']]);
    expect(EXPORT_COMMANDS.exportManuscript.id).toBe('export-manuscript');
    const window = openWindow(stage);
    expect(window.modal.isOpen).toBe(true);
    expect(window.modal.titleEl.text).toBe(EXPORT_WINDOW_TITLE);
    expect(window.modal.modalEl.hasClass('spellbook-export')).toBe(true);
    // The project's title is the writer's own text: it chooses its own direction.
    const title = window.content.withClass('spellbook-export-project')[0];
    expect(title?.text).toBe('My Novel');
    expect(title?.getAttr('dir')).toBe('auto');
    expect(stage.vault.writes).toEqual([]); // opening the window writes nothing
  });

  it('says so when no project is open, and opens nothing', async () => {
    const stage = await wire(novelVault(), { open: null });
    stage.command('export-manuscript').callback?.();
    expect(StubModal.opened).toEqual([]);
    expect(notices()).toEqual([NO_PROJECT_TEXT]);
  });

  it('shows one window at a time, and closes it when the plugin is switched off', async () => {
    const stage = await wire();
    const first = openWindow(stage);
    const second = openWindow(stage);
    expect(first.modal.isOpen).toBe(false);
    expect(second.modal.isOpen).toBe(true);
    stage.switchOff();
    expect(second.modal.isOpen).toBe(false);
    stage.plugin.commands[0]?.callback?.();
    expect(StubModal.opened).toHaveLength(2); // nothing opens after that
  });
});

// ----------------------------------------------------------------- the window

describe('the export window', () => {
  it('offers the formats, the folders of the binder, and the options of a standard manuscript', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    expect(choicesOf(window, 'Format')).toEqual([
      ['docx', 'Word (.docx)'],
      ['epub', 'E-book (.epub)'],
      ['html', 'Web page (.html)'],
      ['markdown', 'Markdown (.md)'],
      ['print', 'Print / save as PDF'],
    ]);
    expect(dropdown(window, 'Format').getValue()).toBe('docx');
    expect(choicesOf(window, 'Include').map(([value, text]) => [value, text.trim()])).toEqual([
      ['', WHOLE_MANUSCRIPT_TEXT],
      ['f-one', 'Part one'],
      ['f-inner', INNER_NAME],
    ]);
    // A folder's name is the writer's own text.
    expect(dropdown(window, 'Include').selectEl.children.map((option) => option.getAttr('dir'))).toEqual([null, 'auto', 'auto']);
    expect(toggle(window, 'Title page').getValue()).toBe(true);
    expect(toggle(window, 'Line at the top of each page').getValue()).toBe(true);
    expect(toggle(window, 'List of contents').getValue()).toBe(false);
    expect(toggle(window, 'Scene titles').getValue()).toBe(false);
    expect(choicesOf(window, 'Paper')).toEqual([
      ['a4', 'A4'],
      ['letter', 'US Letter'],
    ]);
    expect(textField(window, 'Author').inputEl.getAttr('dir')).toBe('auto');
    expect(textsOf(window, 'spellbook-export-note')).toEqual([FORMAT_NOTES.docx, PRESET_NOTES.manuscript, MATTER_NOTE, HEADINGS_NOTE]);
    expect(dropdown(window, 'Preset').getValue()).toBe('manuscript');
  });

  it('says what an export would take: how many scenes, how many are switched off, how many have no note', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    expect(textsOf(window, 'spellbook-export-summary')).toEqual([
      '4 scenes will be exported, in binder order. 1 scene is left out: the "compile" switch is off. 1 scene has no note and cannot be exported.',
    ]);
    dropdown(window, 'Include').choose('f-inner');
    expect(textsOf(window, 'spellbook-export-summary')).toEqual(['1 scene will be exported, in binder order.']);
    expect(stage.vault.reads.readText).toBe(0); // told from the index: no note is read for it
  });

  it('shows only the options that mean something for the format', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    dropdown(window, 'Format').choose('markdown');
    expect(hasRow(window, 'Paper')).toBe(false);
    expect(hasRow(window, 'Line at the top of each page')).toBe(false);
    expect(hasRow(window, 'Title page')).toBe(true);
    expect(textsOf(window, 'spellbook-export-note')).toEqual([FORMAT_NOTES.markdown, PRESET_NOTES.manuscript, MATTER_NOTE, HEADINGS_NOTE]);
    dropdown(window, 'Format').choose('print');
    expect(hasRow(window, 'Paper')).toBe(true);
    expect(textsOf(window, 'spellbook-export-note')).toEqual([FORMAT_NOTES.print, PRESET_NOTES.manuscript, MATTER_NOTE, HEADINGS_NOTE]);
    expect(hasRow(window, 'Cover')).toBe(false);
    dropdown(window, 'Format').choose('epub');
    // An e-book has no pages of a fixed size: no paper, no line at the top; it may have a cover.
    expect(hasRow(window, 'Paper')).toBe(false);
    expect(hasRow(window, 'Line at the top of each page')).toBe(false);
    expect(hasRow(window, 'Cover')).toBe(true);
    dropdown(window, 'Format').choose('print');
    expect(dropdown(window, 'Format').getValue()).toBe('print');
  });

  it('on a phone or tablet offers no printing, and says how to get a PDF there', async () => {
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: true });
    const storage = new MemoryDeviceStorage();
    // The choice of another device's kind does not carry over to a phone.
    storage.save(OPTIONS_KEY, JSON.stringify({ format: 'print' }));
    const stage = await wire(novelVault(), { storage });
    const window = openWindow(stage);
    expect(choicesOf(window, 'Format').map(([value]) => value)).toEqual(['docx', 'epub', 'html', 'markdown']);
    expect(dropdown(window, 'Format').getValue()).toBe('html');
    expect(textsOf(window, 'spellbook-export-note')).toEqual([FORMAT_NOTES.html, MOBILE_PDF_NOTE, PRESET_NOTES.manuscript, MATTER_NOTE, HEADINGS_NOTE]);
    expect(MOBILE_PDF_NOTE).toMatch(/export the web page/);
  });

  it('offers printing by what the device can do, whatever the "Layout" setting says', async () => {
    // A touch-screen laptop with the touch layout can still print.
    setLayoutChoice('touch');
    const laptop = await wire(novelVault());
    expect(choicesOf(openWindow(laptop), 'Format').map(([value]) => value)).toContain('print');

    // A phone with the desktop layout still cannot.
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: true });
    setLayoutChoice('desktop');
    StubModal.opened.length = 0;
    const phone = await wire(novelVault());
    expect(choicesOf(openWindow(phone), 'Format').map(([value]) => value)).toEqual(['docx', 'epub', 'html', 'markdown']);
  });

  it('remembers the choices on this device, and takes the author from the project the first time', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['author'] = 'Dana Marlow';
    });
    const stage = await wire(vault);
    const first = openWindow(stage);
    expect(textField(first, 'Author').getValue()).toBe('Dana Marlow');
    dropdown(first, 'Format').choose('markdown');
    dropdown(first, 'Include').choose('f-one');
    textField(first, 'Author').type('  דנה מרלו ');
    toggle(first, 'List of contents').flip();
    toggle(first, 'Title page').flip();
    await pressExport(stage, first);
    expect(JSON.parse(stage.storage.values.get(OPTIONS_KEY) ?? 'null')).toBeTruthy();
    expect(stage.vault.frontmatterOf(NOVEL_INDEX)?.['author']).toBe('Dana Marlow'); // the project is not changed

    const second = openWindow(stage);
    expect(dropdown(second, 'Format').getValue()).toBe('markdown');
    expect(dropdown(second, 'Include').getValue()).toBe('f-one');
    expect(textField(second, 'Author').getValue()).toBe('דנה מרלו');
    expect(toggle(second, 'List of contents').getValue()).toBe(true);
    expect(toggle(second, 'Title page').getValue()).toBe(false);
  });

  it('forgets a remembered folder that the binder no longer has, and works when the device remembers nothing or nonsense', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(OPTIONS_KEY, JSON.stringify({ format: 'html', scope: 'f-gone' }));
    const stage = await wire(novelVault(), { storage });
    const window = openWindow(stage);
    expect(dropdown(window, 'Format').getValue()).toBe('html');
    expect(dropdown(window, 'Include').getValue()).toBe('');

    const broken = new MemoryDeviceStorage();
    broken.broken = true;
    const other = await wire(novelVault(), { storage: broken });
    const plain = openWindow(other);
    expect(dropdown(plain, 'Format').getValue()).toBe('docx');
    await pressExport(other, plain);
    expect(exportsOf(other.vault)).toHaveLength(1); // the export itself does not need the storage
  });

  it('Cancel closes the window and writes nothing', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    button(window, 'Cancel').click();
    expect(window.modal.isOpen).toBe(false);
    expect(stage.vault.writes).toEqual([]);
    expect(stage.storage.saves).toEqual([]);
  });
});

// ------------------------------------------------------------ the three files

describe('an exported file', () => {
  it('as Markdown: the scenes in binder order, without what is switched off, properties or comments', async () => {
    const stage = await wire();
    const path = await exportAs(stage, 'markdown');
    expect(path).toBe(`Novel/Exports/My Novel ${TODAY}.md`);
    const text = await stage.vault.readText(path);
    expectInOrder(text, ['# My Novel', ...IN_ORDER]);
    expectOnlyTheManuscript(text);
    expect(text).toContain(`${OPENING_LINE}\n\n\n\nThe **rain** fell.`);
    expect(text).toContain(`\n## Part one\n\n${LETTER_LINE}\n\n### ${INNER_NAME}\n\n${NIGHT_LINE}\n\n* * *\n\n${CLOSING_LINE}\n`);
  });

  it('as a web page: the same order, and the Hebrew scene right to left', async () => {
    const stage = await wire();
    const path = await exportAs(stage, 'html');
    expect(path).toBe(`Novel/Exports/My Novel ${TODAY}.html`);
    const html = await stage.vault.readText(path);
    expectInOrder(textOf(html.slice(html.indexOf('<body>'))), ['My Novel', ...IN_ORDER]);
    expectOnlyTheManuscript(html);
    expect(html).toContain(`<p class="first" dir="rtl">${NIGHT_LINE}</p>`);
    expect(html).toContain(`<p class="first" dir="ltr">${LETTER_LINE}</p>`);
    expect(html).toMatch(new RegExp(`<h3 class="chapter level-2" id="part-\\d+" dir="rtl">${INNER_NAME}</h3>`));
    expect(html).toContain('<p dir="ltr">The <strong>rain</strong> fell.</p>');
    expect(html).not.toContain('Novel/');
  });

  it('as a Word file: a zip that opens again, the same order, and the Hebrew scene right to left', async () => {
    const stage = await wire();
    const path = await exportAs(stage, 'docx');
    expect(path).toBe(`Novel/Exports/My Novel ${TODAY}.docx`);
    const files = new Map(unzipStored(stage.vault.bytesOf(path)).map((entry) => [entry.name, fromUtf8(entry.data)]));
    expect([...files.keys()]).toContain('[Content_Types].xml');
    const main = files.get('word/document.xml') ?? '';
    const paragraphs = main.match(/<w:p>.*?<\/w:p>/g) ?? [];
    expectInOrder(paragraphs.map(textOf).join('\n'), ['My Novel', ...IN_ORDER]);
    for (const xml of files.values()) {
      expectOnlyTheManuscript(xml);
      expect(xml).not.toContain('Novel/');
    }
    const night = paragraphs.find((paragraph) => paragraph.includes(NIGHT_LINE));
    expect(night).toBe(
      `<w:p><w:pPr><w:pStyle w:val="ManuscriptTextFirst"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${NIGHT_LINE}</w:t></w:r></w:p>`,
    );
    expect(paragraphs.find((paragraph) => paragraph.includes(LETTER_LINE))).not.toContain('<w:bidi/>');
    expect(textOf(files.get('word/header1.xml') ?? '')).toContain('My Novel / ');
  });

  it('follows the binder when it is put in another order', async () => {
    const stage = await wire();
    expect((await stage.store.moveNode({ kind: 'scene', path: CLOSING }, { at: 'start', parentId: null })).status).toBe('done');
    expect((await stage.store.moveNode({ kind: 'scene', path: NIGHT }, { at: 'start', parentId: 'f-one' })).status).toBe('done');
    await calm(stage);
    for (const format of ['markdown', 'html', 'docx']) {
      const path = await exportAs(stage, format);
      const text =
        format === 'docx'
          ? textOf(fromUtf8(unzipStored(stage.vault.bytesOf(path)).find((entry) => entry.name === 'word/document.xml')!.data).replace(/<\/w:p>/g, '\n'))
          : await stage.vault.readText(path);
      // The Hebrew scene now comes first in its folder; its own folder is empty and leaves no heading.
      expectInOrder(text.slice(text.indexOf(format === 'markdown' ? '\n' : 'words')), [CLOSING_LINE, OPENING_LINE, 'Part one', NIGHT_LINE, LETTER_LINE]);
      expect(text.indexOf(INNER_NAME, text.indexOf(CLOSING_LINE)), format).toBe(-1);
    }
  });

  it('goes by each scene\'s "compile" switch as it is in the note at that moment', async () => {
    const stage = await wire();
    // Flipped a moment ago: the notes say so, the index has not caught up yet.
    stage.vault.external.editFrontmatter(inNovel(DRAFT), (frontmatter) => (frontmatter['compile'] = true), { silent: true });
    stage.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => (frontmatter['compile'] = false), { silent: true });
    for (const format of ['markdown', 'html', 'docx']) {
      const path = await exportAs(stage, format);
      const text = format === 'docx' ? fromUtf8(unzipStored(stage.vault.bytesOf(path))[2]!.data) : await stage.vault.readText(path);
      expect(text, format).toContain(DRAFT_LINE);
      expect(text, format).not.toContain(LETTER_LINE);
      expectInOrder(text, [OPENING_LINE, 'Part one', DRAFT_LINE, NIGHT_LINE, CLOSING_LINE]);
    }
  });

  it('holds one folder alone when that is chosen, and its name says so', async () => {
    const stage = await wire();
    const path = await exportAs(stage, 'markdown', (window) => dropdown(window, 'Include').choose('f-one'));
    expect(path).toBe(`Novel/Exports/My Novel - Part one ${TODAY}.md`);
    const text = await stage.vault.readText(path);
    expectInOrder(text, ['## Part one', LETTER_LINE, INNER_NAME, NIGHT_LINE]);
    expect(text).not.toContain(OPENING_LINE);
    expect(text).not.toContain(CLOSING_LINE);
    expect(text).not.toContain(DRAFT_LINE);
  });

  it('carries the author and the options chosen', async () => {
    const stage = await wire();
    const path = await exportAs(stage, 'html', (window) => {
      textField(window, 'Author').type('Dana Marlow');
      toggle(window, 'Scene titles').flip();
      toggle(window, 'List of contents').flip();
      dropdown(window, 'Paper').choose('letter');
    });
    const html = await stage.vault.readText(path);
    expect(html).toContain('<p class="author" dir="auto">Dana Marlow</p>');
    expect(html).toContain('content: "Marlow / My Novel / " counter(page)');
    expect(html).toContain('@page { size: letter;');
    expect(html).toMatch(new RegExp(`<h4 class="scene-title" id="part-\\d+" dir="rtl">${NIGHT_TITLE}</h4>`));
    expect(html).toContain('<nav class="contents">');
  });
});

// ------------------------------------------------------- where the file goes

describe('saving an export', () => {
  it('makes one new file in the project\'s Exports folder, and changes no note', async () => {
    const stage = await wire();
    const before = notesOf(stage);
    const path = await exportAs(stage, 'docx');
    expect(stage.vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Exports' },
      { op: 'createBinary', path },
    ]);
    expect(notesOf(stage)).toEqual(before);
    expect(stage.vault.listFiles('Second/Exports')).toEqual([]);
  });

  it('never writes over an export: the next one of the same day gets a number', async () => {
    const stage = await wire();
    const first = await exportAs(stage, 'docx');
    const bytes = stage.vault.bytesOf(first);
    stage.vault.external.editFrontmatter(inNovel(CLOSING), (frontmatter) => (frontmatter['compile'] = false));
    const second = await exportAs(stage, 'docx');
    const third = await exportAs(stage, 'docx');
    expect([first, second, third]).toEqual([
      `Novel/Exports/My Novel ${TODAY}.docx`,
      `Novel/Exports/My Novel ${TODAY} 2.docx`,
      `Novel/Exports/My Novel ${TODAY} 3.docx`,
    ]);
    expect(stage.vault.bytesOf(first)).toEqual(bytes);
    expect(stage.vault.bytesOf(second)).not.toEqual(bytes);
    // A file of that name in other capitals, or of another kind, is in nobody's way.
    expect(await exportAs(stage, 'html')).toBe(`Novel/Exports/My Novel ${TODAY}.html`);
  });

  it('writes a long manuscript\'s count with commas between the thousands, as everywhere else', () => {
    const outcome = {
      status: 'done',
      format: 'docx',
      path: 'Novel/Exports/My Novel.docx',
      rel: 'Exports/My Novel.docx',
      scenes: 1204,
      words: 28510,
      switchedOff: [],
      unread: [],
      warnings: [],
    } as unknown as DoneOutcome;
    const done = new ExportDoneModal({} as never, {} as Exporter, outcome, false);
    done.open();
    expect((done.contentEl as unknown as FakeElement).withClass('spellbook-export-saved')[0]?.text).toBe('Saved 1,204 scenes, 28,510 words, as a new file.');
    done.close();
  });

  it('makes way for a small window that says the file\'s name and folder, lists what was left out, and offers to open it', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    await pressExport(stage, window);
    expect(window.modal.isOpen).toBe(false);
    const done = doneWindow();
    expect(done.modal.isOpen).toBe(true);
    expect(done.modal.titleEl.text).toBe(EXPORTED_TITLE);
    expect(done.modal.modalEl.hasClass('spellbook-export')).toBe(true);
    expect(textsOf(done, 'spellbook-export-file')).toEqual([`My Novel ${TODAY}.docx`]);
    expect(textsOf(done, 'spellbook-export-folder')).toEqual(['Novel/Exports']);
    for (const cls of ['spellbook-export-file', 'spellbook-export-folder']) expect(done.content.withClass(cls)[0]?.getAttr('dir')).toBe('auto');
    expect(textsOf(done, 'spellbook-export-where-label')).toEqual(['File', 'Folder']);
    expect(done.content.withClass('spellbook-export-result')[0]?.fullText).toContain('Saved 4 scenes, 26 words, as a new file.');
    const leftOut = done.content.withClass('spellbook-export-left-out').map((list) => list.children.map((item) => [item.text, item.getAttr('dir')]));
    expect(leftOut).toEqual([[['Draft', 'auto']], [['Ghost', 'auto']]]);
    // A window that stays, not a notice that fades.
    expect(notices()).toEqual([]);
    expect(stage.opened).toEqual([]); // not opened until asked
    expect(button(done, 'Show in file list')).toBeDefined();

    button(done, 'Open').click();
    await calm(stage);
    expect(stage.opened).toEqual([{ path: `Novel/Exports/My Novel ${TODAY}.docx`, where: false }]);
    expect(done.modal.isOpen).toBe(true);
    button(done, 'OK').click();
    expect(done.modal.isOpen).toBe(false);
  });

  it('names the file and the folder from the vault path', () => {
    expect(fileNameOf('Novel/Exports/My Novel.docx')).toBe('My Novel.docx');
    expect(folderOf('Novel/Exports/My Novel.docx')).toBe('Novel/Exports');
    expect(fileNameOf('לילה.md')).toBe('לילה.md');
    expect(folderOf('לילה.md')).toBe('');
    expect(VAULT_ROOT_TEXT).toMatch(/top of the vault/);
  });

  it('still says the export is saved when the form was closed while it was being made, and nothing after the plugin is switched off', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    button(window, 'Export').click();
    window.modal.close();
    await calm(stage);
    expect(doneWindow().modal.isOpen).toBe(true);
    // Switching the plugin off closes it.
    stage.switchOff();
    expect(doneWindow().modal.isOpen).toBe(false);

    const other = await wire();
    const before = StubModal.opened.length;
    const form = openWindow(other);
    button(form, 'Export').click();
    other.switchOff();
    await calm(other);
    expect(StubModal.opened).toHaveLength(before + 1); // the form only
  });

  it('opens a Markdown export as a note in a new tab, and says so when a file cannot be opened', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    dropdown(window, 'Format').choose('markdown');
    await pressExport(stage, window);
    const done = doneWindow();
    button(done, 'Open').click();
    await calm(stage);
    expect(stage.opened).toEqual([{ path: `Novel/Exports/My Novel ${TODAY}.md`, where: 'tab' }]);
    expect(done.modal.isOpen).toBe(false); // the note is on show: the window is out of its way

    stage.canOpen.value = false;
    const other = openWindow(stage);
    dropdown(other, 'Format').choose('docx');
    await pressExport(stage, other);
    const second = doneWindow();
    button(second, 'Open').click();
    await calm(stage);
    expect(notices()).toContain(COULD_NOT_OPEN_TEXT);
    expect(second.modal.isOpen).toBe(true);
  });

  describe('"Show in file list"', () => {
    /** Obsidian's file list, standing in the sidebar; what it was asked to point at is kept. */
    function fileList(stage: Wired, view: Record<string, unknown> | null = null): string[] {
      const pointed: string[] = [];
      const leaf = stage.fake.workspace.addLeaf(stage.fake.workspace.leftSplit);
      leaf.type = 'file-explorer';
      leaf.view = (view ?? {
        revealInFolder: (file: { path: string }) => {
          pointed.push(file.path);
        },
      }) as never;
      return pointed;
    }

    it('brings Obsidian\'s file list to the front, points at the file, and gets out of the way', async () => {
      const stage = await wire();
      const pointed = fileList(stage);
      const window = openWindow(stage);
      await pressExport(stage, window);
      const path = `Novel/Exports/My Novel ${TODAY}.docx`;
      stage.fake.vault.attachFile(path, '');
      const done = doneWindow();
      // A Word file: the file list may be set not to show it, and the window says so.
      expect(textsOf(done, 'spellbook-export-note')).toContain(HIDDEN_FILE_NOTE);
      expect(textsOf(done, 'spellbook-export-note')).not.toContain(MOBILE_WHERE_NOTE);

      button(done, 'Show in file list').click();
      await calm(stage);
      expect(stage.fake.workspace.revealed.map((leaf) => leaf.type)).toEqual(['file-explorer']);
      expect(pointed).toEqual([path]);
      expect(done.modal.isOpen).toBe(false);
      expect(stage.opened).toEqual([]);
      expect(notices()).not.toContain(COULD_NOT_SHOW_TEXT);
    });

    it('points at the folder when the file list cannot point at the file', async () => {
      const stage = await wire();
      const pointed: string[] = [];
      fileList(stage, {
        revealInFolder: (file: { path: string; children?: unknown }) => {
          if (file.children === undefined) throw new Error('not in the list');
          pointed.push(file.path);
        },
      });
      const window = openWindow(stage);
      await pressExport(stage, window);
      stage.fake.vault.attachFile(`Novel/Exports/My Novel ${TODAY}.docx`, '');
      const done = doneWindow();
      button(done, 'Show in file list').click();
      await calm(stage);
      expect(pointed).toEqual(['Novel/Exports']);
      expect(done.modal.isOpen).toBe(false);
    });

    it('still shows the file list when it has no way of pointing at a file', async () => {
      const stage = await wire();
      fileList(stage, {});
      const window = openWindow(stage);
      await pressExport(stage, window);
      stage.fake.vault.attachFile(`Novel/Exports/My Novel ${TODAY}.docx`, '');
      const done = doneWindow();
      button(done, 'Show in file list').click();
      await calm(stage);
      expect(stage.fake.workspace.revealed).toHaveLength(1);
      expect(done.modal.isOpen).toBe(false);
    });

    it('says so when there is no file list to show, and stays open', async () => {
      const stage = await wire();
      const window = openWindow(stage);
      await pressExport(stage, window);
      const done = doneWindow();
      button(done, 'Show in file list').click();
      await calm(stage);
      expect(notices()).toContain(COULD_NOT_SHOW_TEXT);
      expect(done.modal.isOpen).toBe(true);
    });

    it('does not warn about hidden files for a Markdown export, which is a note', async () => {
      const stage = await wire();
      const window = openWindow(stage);
      dropdown(window, 'Format').choose('markdown');
      await pressExport(stage, window);
      const done = doneWindow();
      expect(textsOf(done, 'spellbook-export-note')).not.toContain(HIDDEN_FILE_NOTE);
      expect(button(done, 'Show in file list')).toBeDefined();
    });

    it('is offered on a phone or tablet too, where the file list is the drawer at the side', async () => {
      Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: true });
      const stage = await wire();
      const pointed = fileList(stage);
      const window = openWindow(stage);
      dropdown(window, 'Format').choose('docx');
      await pressExport(stage, window);
      const done = doneWindow();
      expect(button(done, 'Open')).toBeDefined();
      expect(button(done, 'OK')).toBeDefined();
      const notes = textsOf(done, 'spellbook-export-note');
      expect(notes).toContain(MOBILE_WHERE_NOTE);
      expect(notes).toContain(HIDDEN_FILE_NOTE);
      expect(MOBILE_WHERE_NOTE).toMatch(/Files app/);
      expect(HIDDEN_FILE_NOTE).toMatch(/"Detect all file extensions"/);
      const path = `Novel/Exports/My Novel ${TODAY}.docx`;
      stage.fake.vault.attachFile(path, '');
      button(done, 'Show in file list').click();
      await calm(stage);
      expect(pointed).toEqual([path]);
      expect(done.modal.isOpen).toBe(false);
    });
  });

  it('"Print / save as PDF" saves the page made for printing and opens it at once', async () => {
    const stage = await wire();
    const path = await exportAs(stage, 'print');
    expect(path).toBe(`Novel/Exports/My Novel (to print) ${TODAY}.html`);
    const html = await stage.vault.readText(path);
    expect(html).toContain('<button type="button" onclick="print()">Print / save as PDF</button>');
    expectInOrder(html, IN_ORDER);
    expectOnlyTheManuscript(html);
    expect(stage.opened).toEqual([{ path, where: false }]);
    // The plain web page has no button.
    expect(await stage.vault.readText(await exportAs(stage, 'html'))).not.toContain('<button');
  });

  it('writes nothing when there is nothing to export, and says so', async () => {
    const vault = novelVault();
    for (const scene of [OPENING, LETTER, NIGHT, CLOSING]) {
      vault.external.editFrontmatter(inNovel(scene), (frontmatter) => (frontmatter['compile'] = false));
    }
    const stage = await wire(vault);
    const window = openWindow(stage);
    await pressExport(stage, window);
    expect(notices()).toEqual([NOTHING_TEXT]);
    expect(stage.vault.writes).toEqual([]);
    expect(window.modal.isOpen).toBe(true);
    expect(hasRow(window, 'Format')).toBe(true); // the form is back
  });

  it('says so when the file cannot be saved, and leaves the form to try again', async () => {
    const stage = await wire();
    stage.vault.failNext('createBinary');
    const window = openWindow(stage);
    await pressExport(stage, window);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/could not be saved/);
    expect(exportsOf(stage.vault)).toEqual([]);
    await pressExport(stage, window);
    expect(exportsOf(stage.vault)).toEqual([`Novel/Exports/My Novel ${TODAY}.docx`]);
  });

  it('leaves out a scene that cannot be read, and exports the rest', async () => {
    const stage = await wire();
    const read = stage.vault.readText.bind(stage.vault);
    stage.vault.readText = async (path: string) => {
      if (path === inNovel(LETTER)) throw new Error('the disk is not available');
      return read(path);
    };
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const window = openWindow(stage);
      dropdown(window, 'Format').choose('markdown');
      await pressExport(stage, window);
      const leftOut = doneWindow().content.withClass('spellbook-export-left-out').map((list) => list.children.map((item) => item.text));
      expect(leftOut).toEqual([['Draft'], ['The Letter', 'Ghost']]);
    } finally {
      console.error = log;
    }
    expect(errors).toHaveLength(1);
    const text = await read(`Novel/Exports/My Novel ${TODAY}.md`);
    expect(text).not.toContain(LETTER_LINE);
    expectInOrder(text, [OPENING_LINE, NIGHT_LINE, CLOSING_LINE]);
  });

  it('writes nothing into a project that was opened while the export was being made', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    button(window, 'Export').click();
    // Before the export's turn comes, the writer opens the other project.
    void stage.store.openProject(SECOND_INDEX);
    await calm(stage);
    expect(stage.vault.listFiles('Second/Exports')).toEqual([]);
    expect(stage.vault.hasFolder('Second/Exports')).toBe(false);
    for (const path of stage.vault.paths()) expect(path.startsWith('Second/Exports/')).toBe(false);
  });

  it('a second press while the first export is under way does nothing', async () => {
    const stage = await wire();
    const window = openWindow(stage);
    const press = button(window, 'Export');
    press.click();
    press.click();
    await calm(stage);
    expect(exportsOf(stage.vault)).toHaveLength(1);
  });
});
