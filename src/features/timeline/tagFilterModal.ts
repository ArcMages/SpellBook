// The window that sets the timeline's filter by tags and by kind: the tags
// used in the project, each with how many things carry it, to tick; whether
// one of them is enough or all are needed; and which kinds to show (events,
// scenes, the entities of each type of the world).
//
// Rows are tapped to tick and tapped again to untick, so it works the same
// with a finger as with a mouse, in the style of the window that picks
// entities. Nothing is written here: the window hands the filter to whoever
// opened it.

import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { NO_TAG_FILTER, searchTags, tagKey } from '../../core/timeline';
import type { TagCount, TagFilter, TagMatch } from '../../core/timeline';
import { isInputMethodKey } from '../../ui/keys';
import type { KindChoice } from './timelineScene';

export const TAGS_WINDOW_TITLE = 'Filter by tags';
export const NO_TAGS_MESSAGE = 'No event, scene or entity of this project has a tag yet. Add tags in a note\'s "tags" property.';
export const NO_TAG_MATCH_MESSAGE = 'No tag has that in it.';
export const MATCH_ANY_LABEL = 'Any tag';
export const MATCH_ALL_LABEL = 'All tags';
export const KINDS_HEADING = 'Show only';
export const KINDS_NOTE = 'Nothing ticked: every kind';

/** The list shows this many tags at most; the rest are found by searching. */
export const TAG_ROWS = 200;

export interface TagFilterForm {
  /** Every tag used in the project, with its count. */
  readonly tags: readonly TagCount[];
  /** The kinds there are to choose from. */
  readonly kinds: readonly KindChoice[];
  /** The filter as it is now. */
  readonly filter: TagFilter;
  /** Called with the filter the writer chose (NO_TAG_FILTER to clear it). */
  readonly submit: (filter: TagFilter) => void;
}

export class TagFilterModal extends Modal {
  private readonly form: TagFilterForm;
  /** The ticked tags, by their key, each as it is written. */
  private readonly chosen = new Map<string, string>();
  private readonly kinds: Set<string>;
  private match: TagMatch;
  private search: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private matchButtons: Array<{ el: HTMLElement; match: TagMatch }> = [];

  constructor(app: App, form: TagFilterForm) {
    super(app);
    this.form = form;
    for (const tag of form.filter.tags) this.chosen.set(tagKey(tag), tag);
    this.kinds = new Set(form.filter.kinds);
    this.match = form.filter.match;
  }

  override onOpen(): void {
    const { contentEl, form } = this;
    contentEl.empty();
    this.titleEl.setText(TAGS_WINDOW_TITLE);
    this.modalEl.addClass('spellbook-prompt', 'spellbook-timeline-entity-window', 'spellbook-timeline-tags-window');

    const modes = contentEl.createDiv({ cls: 'spellbook-timeline-modes spellbook-timeline-tag-match', attr: { role: 'group', 'aria-label': 'Match' } });
    this.matchButtons = (['any', 'all'] as const).map((match) => {
      const el = modes.createEl('button', { cls: 'spellbook-timeline-button', text: match === 'any' ? MATCH_ANY_LABEL : MATCH_ALL_LABEL, attr: { type: 'button' } });
      el.addEventListener('click', () => {
        this.match = match;
        this.showMatch();
      });
      return { el, match };
    });
    this.showMatch();

    const field = contentEl.createDiv({ cls: 'spellbook-prompt-field' });
    const search = field.createEl('input', {
      cls: ['spellbook-prompt-input', 'spellbook-timeline-entity-search'],
      attr: { type: 'text', placeholder: 'Search tags', 'aria-label': 'Search tags', dir: 'auto', enterkeyhint: 'search' },
    });
    search.addEventListener('input', () => {
      this.draw();
    });
    this.search = search;
    this.list = contentEl.createDiv({ cls: 'spellbook-timeline-entity-list', attr: { role: 'group', 'aria-label': 'Tags' } });

    contentEl.createDiv({ cls: 'spellbook-timeline-tag-heading', text: KINDS_HEADING });
    contentEl.createDiv({ cls: 'spellbook-timeline-entity-none', text: KINDS_NOTE });
    const kinds = contentEl.createDiv({ cls: ['spellbook-timeline-entity-list', 'spellbook-timeline-kind-list'], attr: { role: 'group', 'aria-label': KINDS_HEADING } });
    for (const kind of form.kinds) {
      this.tickRow(kinds, kind.name, kind.world, null, () => this.kinds.has(kind.kind), () => {
        if (this.kinds.has(kind.kind)) this.kinds.delete(kind.kind);
        else this.kinds.add(kind.kind);
      });
    }

    contentEl.addEventListener('keydown', (event) => {
      if (isInputMethodKey(event)) return;
      if (event.key === 'Enter' && event.target === this.search) {
        event.preventDefault();
        this.submit(this.chosenFilter());
      }
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Clear').onClick(() => {
          this.submit(NO_TAG_FILTER);
        });
      })
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setButtonText('Show')
          .setCta()
          .onClick(() => {
            this.submit(this.chosenFilter());
          });
      });
    this.draw();
  }

  override onClose(): void {
    this.search = null;
    this.list = null;
    this.matchButtons = [];
    this.contentEl.empty();
  }

  private showMatch(): void {
    for (const { el, match } of this.matchButtons) {
      el.toggleClass('is-active', match === this.match);
      el.setAttr('aria-pressed', match === this.match ? 'true' : 'false');
    }
  }

  /** The filter as it is ticked: tags in the list's order, so that it does not depend on the order of the taps. */
  private chosenFilter(): TagFilter {
    const listed = this.form.tags.filter((entry) => this.chosen.has(tagKey(entry.tag))).map((entry) => entry.tag);
    // A tag that is no longer used anywhere stays chosen until it is unticked.
    const gone = [...this.chosen.entries()].filter(([key]) => !this.form.tags.some((entry) => tagKey(entry.tag) === key)).map(([, tag]) => tag);
    const kinds = this.form.kinds.filter((kind) => this.kinds.has(kind.kind)).map((kind) => kind.kind);
    return { tags: [...listed, ...gone], match: this.match, kinds };
  }

  private submit(filter: TagFilter): void {
    this.form.submit(filter);
    this.close();
  }

  private draw(): void {
    const list = this.list;
    if (!list) return;
    list.empty();
    if (this.form.tags.length === 0) {
      list.createDiv({ cls: 'spellbook-timeline-entity-none', text: NO_TAGS_MESSAGE });
      return;
    }
    const found = searchTags(this.form.tags, this.search?.value ?? '');
    if (found.length === 0) {
      list.createDiv({ cls: 'spellbook-timeline-entity-none', text: NO_TAG_MATCH_MESSAGE });
      return;
    }
    for (const entry of found.slice(0, TAG_ROWS)) {
      const key = tagKey(entry.tag);
      this.tickRow(list, `#${entry.tag}`, true, entry.count, () => this.chosen.has(key), () => {
        if (this.chosen.has(key)) this.chosen.delete(key);
        else this.chosen.set(key, entry.tag);
      });
    }
    if (found.length > TAG_ROWS) {
      list.createDiv({ cls: 'spellbook-timeline-entity-none', text: `and ${found.length - TAG_ROWS} more: search to find them` });
    }
  }

  /** A row that is tapped to tick it and tapped again to untick it. */
  private tickRow(
    parent: HTMLElement,
    text: string,
    ownText: boolean,
    count: number | null,
    ticked: () => boolean,
    flip: () => void,
  ): void {
    const row = parent.createEl('button', { cls: 'spellbook-timeline-entity-row', attr: { type: 'button' } });
    const tick = row.createSpan({ cls: 'spellbook-timeline-entity-tick' });
    const name = row.createSpan({ cls: 'spellbook-timeline-entity-name', text });
    // A tag and a type's name are the writer's own text: they take the direction of what they say.
    if (ownText) name.setAttr('dir', 'auto');
    if (count !== null) row.createSpan({ cls: 'spellbook-timeline-count', text: String(count) });
    const show = (): void => {
      const on = ticked();
      row.toggleClass('is-active', on);
      row.setAttr('aria-pressed', on ? 'true' : 'false');
      tick.setText(on ? '\u2713' : '');
    };
    show();
    row.addEventListener('click', () => {
      flip();
      show();
    });
  }
}
