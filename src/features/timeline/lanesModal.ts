// The window that lists the lanes of the timeline: add one, and for each
// lane rename it, give it a colour, move it up or down, remove it, and hide
// or show it on this device.
//
// Every change goes through the timeline's actions to the host. The window
// draws its list again whenever the timeline behind it has read its data
// again, so the two always show the same lanes, as they are stored.

import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { DisplayLane } from '../../core/timeline';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { TimelineActions } from './timelineActions';
import type { TimelineHost } from './timelineHost';
import { MORE_LABEL, TIMELINE_ICONS, laneMenu } from './timelineMenus';

export const LANES_WINDOW_TITLE = 'Timeline lanes';

/** What is said next to the two lanes that are built in. */
const BUILT_IN_NOTES: Readonly<Record<string, string>> = {
  manuscript: 'Scenes that have a date',
  other: 'Events that name no listed lane',
};

/** Where the window's list comes from: the timeline it was opened from. */
export interface LanesSource {
  /** What the stored lanes could not be read for, in plain English; shown above the list. */
  problems(): readonly string[];
  /**
   * Call `listener` whenever the timeline has read its data again, so that
   * the window and the timeline always show the same lanes. Returns the
   * function that stops the calls.
   */
  watch(listener: () => void): () => void;
}

export class LanesModal extends Modal {
  private readonly host: TimelineHost;
  private readonly actions: TimelineActions;
  private readonly source: LanesSource;
  private list: HTMLElement | null = null;
  private stop: (() => void) | null = null;

  constructor(app: App, host: TimelineHost, actions: TimelineActions, source: LanesSource) {
    super(app);
    this.host = host;
    this.actions = actions;
    this.source = source;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(LANES_WINDOW_TITLE);
    this.modalEl.addClass('spellbook-timeline-lanes-window');
    this.list = contentEl.createDiv({ cls: 'spellbook-timeline-lane-list' });
    const add = contentEl.createEl('button', { cls: ['mod-cta', 'spellbook-timeline-lane-add'], text: 'Add lane' });
    add.addEventListener('click', () => {
      safely('Add lane', () => {
        this.actions.askNewLane();
      });
    });
    this.stop = this.source.watch(() => {
      this.draw();
    });
    this.draw();
  }

  override onClose(): void {
    this.stop?.();
    this.stop = null;
    this.list = null;
    this.contentEl.empty();
  }

  private draw(): void {
    const list = this.list;
    if (!list) return;
    list.empty();
    for (const problem of this.source.problems()) {
      list.createDiv({ cls: 'spellbook-timeline-alert', text: problem, attr: { dir: 'auto' } });
    }
    this.actions.lanes().forEach((lane, index) => {
      this.row(list, lane, index);
    });
  }

  private row(list: HTMLElement, lane: DisplayLane, index: number): void {
    const hidden = this.actions.isHidden(lane);
    const row = list.createDiv({ cls: 'spellbook-timeline-lane-row' });
    row.toggleClass('spellbook-is-hidden-lane', hidden);
    const swatch = row.createSpan({ cls: 'spellbook-timeline-swatch' });
    if (lane.color !== null) swatch.addClass(`spellbook-color-${lane.color}`);

    const text = row.createDiv({ cls: 'spellbook-timeline-lane-text' });
    const name = text.createDiv({ cls: 'spellbook-timeline-lane-title', text: lane.name });
    // Only a lane the writer named holds the writer's own text.
    if (lane.kind === 'lane') name.setAttr('dir', 'auto');
    const note = [BUILT_IN_NOTES[lane.kind], hidden ? 'Hidden on this device' : undefined].filter(
      (part): part is string => part !== undefined,
    );
    if (note.length > 0) text.createDiv({ cls: 'spellbook-timeline-lane-note', text: note.join(' - ') });

    const toggle = row.createEl('button', {
      cls: 'spellbook-timeline-lane-toggle',
      text: hidden ? 'Show' : 'Hide',
      attr: { 'aria-pressed': hidden ? 'true' : 'false' },
    });
    toggle.addEventListener('click', () => {
      this.actions.toggleHidden(lane);
    });

    const more = row.createEl('button', {
      cls: ['clickable-icon', 'spellbook-timeline-lane-more'],
      attr: { 'aria-label': MORE_LABEL, 'aria-haspopup': 'menu' },
    });
    showIcon(more, ...TIMELINE_ICONS.more);
    more.addEventListener('click', (event) => {
      safely(MORE_LABEL, () => {
        const box = more.getBoundingClientRect();
        const place = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: box.left, y: box.bottom };
        laneMenu(this.actions, this.host.clock, lane, index, place).showAtPosition(place);
      });
    });
  }
}
