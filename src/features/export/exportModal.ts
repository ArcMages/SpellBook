// The export window: the writer chooses a format, a preset, what to include
// and a few options (and, folded away, the pages before and after the text),
// and presses Export. When the file is saved the window says where
// it is and offers to open it, and (on a desktop) to show it in the file list.
//
// The window knows the project only through the exporter (exporter.ts). It
// is made of Obsidian's own rows, which are large enough for a finger and
// stack by themselves at phone width.

import { Modal, Notice, Platform, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { MATTER_KINDS, MAX_MATTER_TEXT, PRESET_IDS, withPreset } from '../../core/export';
import type { ExportFormat, ExportOptions, MatterChoice, MatterKind, PaperId, PresetId } from '../../core/export';
import { safely } from '../../ui/safely';
import { MATTER_NAMES } from './exporter';
import type { ExportCount, ExportOutcome, Exporter, ExportProject } from './exporter';

export const EXPORT_WINDOW_TITLE = 'Export manuscript';
export const EXPORT_BUTTON_TEXT = 'Export';
export const OPEN_BUTTON_TEXT = 'Open';
export const SHOW_IN_FOLDER_TEXT = 'Show in folder';
export const WHOLE_MANUSCRIPT_TEXT = 'Whole manuscript';

export const FORMAT_NAMES: Readonly<Record<ExportFormat, string>> = {
  docx: 'Word (.docx)',
  epub: 'E-book (.epub)',
  html: 'Web page (.html)',
  markdown: 'Markdown (.md)',
  print: 'Print / save as PDF',
};

export const PAPER_NAMES: Readonly<Record<PaperId, string>> = {
  a4: 'A4',
  letter: 'US Letter',
};

/** What stands under the list of formats, for the format chosen. */
export const FORMAT_NOTES: Readonly<Record<ExportFormat, string>> = {
  docx: 'A Word document, laid out by the preset below, each chapter on a new page. Opens in Word, Pages and Google Docs.',
  epub: 'An e-book for Apple Books and other e-book readers, with a table of contents and one part for each chapter. A Hebrew book reads right to left.',
  html: 'One page that opens in any browser, laid out as a manuscript when it is printed.',
  markdown: 'One note with the whole text, as you wrote it. It has no pages, so no line at the top and no page breaks.',
  print:
    'Makes a web page laid out for printing and opens it in your browser. There, press "Print / save as PDF" and choose "Save as PDF" where the printer is chosen.',
};

export const PRESET_NAMES: Readonly<Record<PresetId, string>> = {
  manuscript: 'Manuscript for an agent',
  reading: 'Reading copy',
  proof: 'Proof',
};

/** What stands under the list of presets, for the preset chosen. */
export const PRESET_NOTES: Readonly<Record<PresetId, string>> = {
  manuscript: 'The standard manuscript format: 12 point serif, double spacing, a # between scenes, one inch of margin, the number of words on the title page.',
  reading: 'Like a book: normal spacing, lines flush with both margins, large chapter titles, three stars between scenes, a list of contents.',
  proof: 'Double spacing with two inches of margin at the sides to write notes in, and scene titles printed. Word numbers the lines too; the other formats cannot.',
};

export const NO_COVER_TEXT = 'No cover';
export const MATTER_HEADING = 'Front and back matter';
export const MATTER_CHOICE_NAMES: Readonly<Record<MatterChoice['from'], string>> = {
  none: 'None',
  typed: 'Write it here',
  note: 'From a note',
};
export const MATTER_NOTE =
  'A dedication and an epigraph come after the title page, each on a page of its own; acknowledgements and about the author come at the end. A heading on the first line of the text becomes the page\'s title.';

/** Shown on a phone or a tablet, where the plugin cannot hand a page to the printer itself. */
export const MOBILE_PDF_NOTE =
  'For a PDF on a phone or tablet: export the web page, open it in the browser or the Files app, and print it from the share menu. Printing offers to save it as a PDF.';

export const COULD_NOT_OPEN_TEXT = 'The file could not be opened from here. You will find it in the Exports folder of the project.';

export const COULD_NOT_SHOW_TEXT = 'The file list could not be shown from here. You will find the file in the Exports folder of the project.';

/** Under the path of a Word file or a web page: why Obsidian's file list may not show it. */
export const HIDDEN_FILE_NOTE =
  'Obsidian\'s file list only shows Word and web-page files when "Detect all file extensions" is switched on, in Obsidian\'s settings under "Files and links".';

/** Shown on a phone or a tablet, where there is no "Show in folder": where the file is. */
export const MOBILE_WHERE_NOTE =
  'The file is in the Exports folder inside the project\'s folder. You can reach it from Obsidian\'s file list, or from the Files app.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
export const PROBLEM_NOTICE_MS = 10000;

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What an export of this part of the binder would take, in a sentence or two. */
export function countText(count: ExportCount): string {
  const parts = [`${plural(count.scenes, 'scene', 'scenes')} will be exported, in binder order.`];
  if (count.switchedOff > 0) {
    parts.push(`${plural(count.switchedOff, 'scene is', 'scenes are')} left out: the "compile" switch is off.`);
  }
  if (count.missing > 0) parts.push(`${plural(count.missing, 'scene has', 'scenes have')} no note and cannot be exported.`);
  return parts.join(' ');
}

/**
 * Whether this device can be handed a page to print. A phone or a tablet
 * cannot: there the writer prints the exported web page from another app.
 * Deciding by the kind of device happens here and nowhere else in the feature.
 */
export function canPrintHere(): boolean {
  return !Platform.isMobile;
}

/**
 * Whether "Show in folder" is offered. A desktop has the file list beside the
 * window; on a phone or a tablet the window says in words where the file is.
 */
export function canShowInFolderHere(): boolean {
  return canPrintHere();
}

/** The formats on offer on this device. */
export function formatsHere(): ExportFormat[] {
  return canPrintHere() ? ['docx', 'epub', 'html', 'markdown', 'print'] : ['docx', 'epub', 'html', 'markdown'];
}

/** The formats that have pages: a line at the top of each, and a size of paper. */
function paged(format: ExportFormat): boolean {
  return format === 'docx' || format === 'html' || format === 'print';
}

export class ExportModal extends Modal {
  private readonly exporter: Exporter;
  private readonly project: ExportProject;
  private choices: ExportOptions;
  private busy = false;
  private shut = false;
  /** Whether the pages before and after the text are unfolded. */
  private matterOpen = false;

  constructor(app: App, exporter: Exporter, project: ExportProject) {
    super(app);
    this.exporter = exporter;
    this.project = project;
    const remembered = exporter.options();
    // A format this device does not offer (the page for printing, on a phone) falls back to the web page.
    this.choices = formatsHere().includes(remembered.format) ? remembered : { ...remembered, format: 'html' };
  }

  override onOpen(): void {
    this.shut = false;
    this.modalEl.addClass('spellbook-export');
    this.titleEl.setText(EXPORT_WINDOW_TITLE);
    this.drawForm();
  }

  override onClose(): void {
    this.shut = true;
    this.contentEl.empty();
  }

  private change(changed: Partial<ExportOptions>): void {
    this.choices = { ...this.choices, ...changed };
  }

  // --------------------------------------------------------------- the form

  private drawForm(): void {
    const { contentEl, choices } = this;
    contentEl.empty();
    // The project's title is the writer's own text.
    contentEl.createEl('p', { cls: 'spellbook-export-project', text: this.project.title, attr: { dir: 'auto' } });

    new Setting(contentEl).setName('Format').addDropdown((dropdown) => {
      for (const format of formatsHere()) dropdown.selectEl.createEl('option', { value: format, text: FORMAT_NAMES[format] });
      dropdown.setValue(choices.format).onChange((value) => {
        this.change({ format: value as ExportFormat });
        // Which options apply depends on the format.
        this.drawForm();
      });
    });
    contentEl.createEl('p', { cls: 'spellbook-export-note', text: FORMAT_NOTES[choices.format] });
    if (!canPrintHere()) contentEl.createEl('p', { cls: 'spellbook-export-note', text: MOBILE_PDF_NOTE });

    new Setting(contentEl).setName('Preset').addDropdown((dropdown) => {
      for (const preset of PRESET_IDS) dropdown.selectEl.createEl('option', { value: preset, text: PRESET_NAMES[preset] });
      dropdown.setValue(choices.preset).onChange((value) => {
        // A preset sets the switches below to where it starts them.
        this.choices = withPreset(this.choices, value as PresetId);
        this.drawForm();
      });
    });
    contentEl.createEl('p', { cls: 'spellbook-export-note', text: PRESET_NOTES[choices.preset] });

    let summary: HTMLElement | null = null;
    const count = (): void => {
      summary?.setText(countText(this.exporter.count(this.choices.scope)));
    };
    new Setting(contentEl).setName('Include').addDropdown((dropdown) => {
      dropdown.selectEl.createEl('option', { value: '', text: WHOLE_MANUSCRIPT_TEXT });
      for (const folder of this.project.folders) {
        dropdown.selectEl.createEl('option', {
          value: folder.id,
          text: NO_BREAK_SPACE.repeat(folder.depth * 3) + folder.name,
          attr: { dir: 'auto' },
        });
      }
      dropdown.setValue(choices.scope ?? '').onChange((value) => {
        this.change({ scope: value === '' ? null : value });
        count();
      });
    });
    summary = contentEl.createEl('p', { cls: 'spellbook-export-summary' });
    count();

    const hasPages = paged(choices.format);
    new Setting(contentEl)
      .setName('Author')
      .setDesc('For the title page and the line at the top of each page.')
      .addText((text) => {
        text.inputEl.setAttr('dir', 'auto');
        text.setValue(choices.author).onChange((value) => {
          this.change({ author: value });
        });
      });
    this.addSwitch('Title page', 'The title and the author, and for an agent the number of words.', 'titlePage');
    if (hasPages) {
      this.addSwitch('Line at the top of each page', 'Author / Title / page number.', 'header');
    }
    this.addSwitch('List of contents', 'The chapters, after the title page.', 'contents');
    this.addSwitch(
      'Scene titles',
      'Print the title of each scene above it. When off, scenes are set apart by a scene break. A scene\'s own "export-title" property overrides this.',
      'sceneTitles',
    );
    if (hasPages) {
      new Setting(contentEl).setName('Paper').addDropdown((dropdown) => {
        for (const paper of ['a4', 'letter'] as const) dropdown.selectEl.createEl('option', { value: paper, text: PAPER_NAMES[paper] });
        dropdown.setValue(choices.paper).onChange((value) => {
          this.change({ paper: value as PaperId });
        });
      });
    }
    if (choices.format === 'epub') this.drawCover();
    this.drawMatter();

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setButtonText(EXPORT_BUTTON_TEXT)
          .setCta()
          .onClick(() => {
            safely(EXPORT_BUTTON_TEXT, () => this.runExport());
          });
      });
  }

  /** The picture for the cover of an e-book. */
  private drawCover(): void {
    const pictures = this.exporter.coverChoices();
    new Setting(this.contentEl)
      .setName('Cover')
      .setDesc('A picture from the vault, ideally upright, about 1600 by 2560 pixels. JPEG, PNG, GIF or WebP.')
      .addDropdown((dropdown) => {
        dropdown.selectEl.createEl('option', { value: '', text: NO_COVER_TEXT });
        // Paths of the vault are the writer's own text.
        for (const path of pictures) dropdown.selectEl.createEl('option', { value: path, text: path, attr: { dir: 'auto' } });
        dropdown.setValue(this.choices.cover ?? '').onChange((value) => {
          this.change({ cover: value === '' ? null : value });
        });
      });
  }

  /** The pages before and after the text, folded away until the writer opens them. */
  private drawMatter(): void {
    const details = this.contentEl.createEl('details', { cls: 'spellbook-export-matter' });
    details.open = this.matterOpen;
    const used = MATTER_KINDS.filter((kind) => this.choices.matter[kind].from !== 'none').length;
    details.createEl('summary', { text: used === 0 ? MATTER_HEADING : `${MATTER_HEADING} (${used})` });
    details.addEventListener('toggle', () => {
      this.matterOpen = details.open;
    });
    details.createEl('p', { cls: 'spellbook-export-note', text: MATTER_NOTE });
    const list = details.createDiv({ cls: 'spellbook-export-matter-list' });
    const notes = this.exporter.noteChoices();
    const draw = (): void => {
      list.empty();
      // Changing where a page comes from draws the four again; what was typed is kept in the choices.
      for (const kind of MATTER_KINDS) this.drawMatterChoice(list, kind, notes, draw);
    };
    draw();
  }

  private drawMatterChoice(parent: HTMLElement, kind: MatterKind, notes: ReturnType<Exporter['noteChoices']>, redraw: () => void): void {
    const choice = this.choices.matter[kind];
    const block = parent.createDiv({ cls: 'spellbook-export-matter-choice' });
    const setChoice = (changed: Partial<MatterChoice>): void => {
      this.change({ matter: { ...this.choices.matter, [kind]: { ...this.choices.matter[kind], ...changed } } });
    };
    new Setting(block).setName(MATTER_NAMES[kind]).addDropdown((dropdown) => {
      for (const from of ['none', 'typed', 'note'] as const) dropdown.selectEl.createEl('option', { value: from, text: MATTER_CHOICE_NAMES[from] });
      dropdown.setValue(choice.from).onChange((value) => {
        setChoice({ from: value as MatterChoice['from'] });
        redraw();
      });
    });
    if (choice.from === 'typed') {
      const area = block.createEl('textarea', {
        cls: 'spellbook-export-matter-text',
        attr: { dir: 'auto', rows: '4', maxlength: String(MAX_MATTER_TEXT), 'aria-label': MATTER_NAMES[kind] },
      });
      area.value = choice.text;
      area.addEventListener('input', () => {
        setChoice({ text: area.value });
      });
    } else if (choice.from === 'note') {
      new Setting(block).setName('Note').addDropdown((dropdown) => {
        dropdown.selectEl.createEl('option', { value: '', text: 'Choose a note' });
        // Paths of notes are the writer's own text.
        for (const note of notes) dropdown.selectEl.createEl('option', { value: note.path, text: note.path, attr: { dir: 'auto' } });
        dropdown.setValue(choice.note ?? '').onChange((value) => {
          setChoice({ note: value === '' ? null : value });
        });
      });
    }
  }

  private addSwitch(name: string, description: string, key: 'titlePage' | 'header' | 'contents' | 'sceneTitles'): void {
    new Setting(this.contentEl)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) => {
        toggle.setValue(this.choices[key]).onChange((value) => {
          this.change({ [key]: value });
        });
      });
  }

  // -------------------------------------------------------------- exporting

  private async runExport(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const choices = { ...this.choices, author: this.choices.author.replace(/\s+/g, ' ').trim() };
    this.exporter.remember(choices);
    this.contentEl.empty();
    this.contentEl.createEl('p', { cls: 'spellbook-export-note', text: 'Exporting...' });
    let outcome: ExportOutcome;
    try {
      outcome = await this.exporter.run(choices);
    } finally {
      this.busy = false;
    }
    if (outcome.status !== 'done') {
      new Notice(outcome.message, PROBLEM_NOTICE_MS);
      if (!this.shut) this.drawForm();
      return;
    }
    new Notice(`Exported to ${outcome.rel}`);
    if (this.shut) return;
    this.drawResult(outcome);
    // The page for printing is made to be opened: it goes to the browser at once.
    if (outcome.format === 'print') await this.openFile(outcome);
  }

  private drawResult(outcome: Extract<ExportOutcome, { status: 'done' }>): void {
    const { contentEl } = this;
    contentEl.empty();
    const result = contentEl.createDiv({ cls: 'spellbook-export-result' });
    result.createEl('p', { text: `Saved ${plural(outcome.scenes, 'scene', 'scenes')}, ${plural(outcome.words, 'word', 'words')}, as a new file in the project:` });
    result.createEl('p', { cls: 'spellbook-export-path', text: outcome.rel, attr: { dir: 'auto' } });
    const showsInFolder = canShowInFolderHere();
    if (!showsInFolder) result.createEl('p', { cls: 'spellbook-export-note', text: MOBILE_WHERE_NOTE });
    // A Markdown export is a note, which the file list always shows.
    if (outcome.format !== 'markdown') result.createEl('p', { cls: 'spellbook-export-note', text: HIDDEN_FILE_NOTE });
    this.listLeftOut(result, 'Left out, because the "compile" switch is off:', outcome.switchedOff);
    this.listLeftOut(result, 'Left out, because the note is missing or could not be read:', outcome.unread);
    for (const warning of outcome.warnings) result.createEl('p', { cls: 'spellbook-export-note', text: warning, attr: { dir: 'auto' } });

    const buttons = new Setting(contentEl).addButton((button) => {
      button.setButtonText('Done').onClick(() => {
        this.close();
      });
    });
    if (showsInFolder) {
      buttons.addButton((button) => {
        button.setButtonText(SHOW_IN_FOLDER_TEXT).onClick(() => {
          safely(SHOW_IN_FOLDER_TEXT, () => this.showFile(outcome));
        });
        // The folder is shown in Obsidian's own file list, in the sidebar.
        button.buttonEl.setAttr('aria-label', 'Show the file in Obsidian\'s file list');
      });
    }
    buttons
      .addButton((button) => {
        button
          .setButtonText(OPEN_BUTTON_TEXT)
          .setCta()
          .onClick(() => {
            safely(OPEN_BUTTON_TEXT, () => this.openFile(outcome));
          });
      });
  }

  private listLeftOut(parent: HTMLElement, heading: string, titles: readonly string[]): void {
    if (titles.length === 0) return;
    parent.createEl('p', { cls: 'spellbook-export-note', text: heading });
    const list = parent.createEl('ul', { cls: 'spellbook-export-left-out' });
    // Scene titles are the writer's own text.
    for (const title of titles) list.createEl('li', { text: title, attr: { dir: 'auto' } });
  }

  private async openFile(outcome: Extract<ExportOutcome, { status: 'done' }>): Promise<void> {
    const opened = await this.exporter.open(outcome);
    if (!opened) new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
    else if (outcome.format === 'markdown' && !this.shut) this.close();
  }

  private async showFile(outcome: Extract<ExportOutcome, { status: 'done' }>): Promise<void> {
    const shown = await this.exporter.showInFolder(outcome);
    if (!shown) new Notice(COULD_NOT_SHOW_TEXT, PROBLEM_NOTICE_MS);
    // The file list is on show: the window is out of its way.
    else if (!this.shut) this.close();
  }
}
