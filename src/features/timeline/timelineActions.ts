// What the timeline's taps, menus, drops and windows do.
//
// Every change is worked out by the timeline engine (src/core/timeline) and
// handed to the host, which writes it. Nothing here touches a note. A change
// to a note goes over twice: as the engine made it from the properties on
// screen, and as a function that makes it again from the note's properties at
// the moment of writing (see NoteChange).

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import { tidyDisplayName } from '../../core/names';
import {
  MANUSCRIPT_LANE,
  OTHER_LANE,
  addEventToLanePatch,
  addLane,
  isEmptyPatch,
  laneKey,
  laneNameFor,
  moveEventToLanePatch,
  moveLane,
  newEventFrontmatter,
  recolourLane,
  removeEventFromLanePatch,
  removeLane,
  renameLane,
  renameLaneInEventPatch,
  sameStoryDate,
  setEntitiesPatch,
  shiftStoryDate,
  storyDateToFrontmatter,
  storyDateToText,
} from '../../core/timeline';
import type {
  DisplayLane,
  EventEntity,
  FrontmatterPatch,
  LaneChange,
  LaneColor,
  LaneContext,
  StoryDate,
  TimelineEvent,
} from '../../core/timeline';
import { ConfirmModal } from '../../ui/confirmModal';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import { CalendarModal } from './calendarModal';
import { EntityPickerModal } from './entityPicker';
import { EventModal } from './eventModal';
import { redateEntityPatch } from '../../core/world';
import type { WorldLane } from '../../core/world';
import type { NoteChange, TimelineHost } from './timelineHost';
import { allLanes } from './timelineScene';
import type { TimeMode, TimelineContent } from './timelineScene';

/** How long a notice about something that was refused stays up, in milliseconds. */
const REFUSAL_NOTICE_MS = 8000;

/** Where a dragged card was dropped: the engine's answer, as far as it matters here. */
export interface DropResult {
  readonly start: StoryDate;
  readonly dateChanged: boolean;
  /** The key of the lane it was dropped in. */
  readonly lane: string;
  readonly laneChanged: boolean;
}

type PatchMaker = (frontmatter: unknown) => FrontmatterPatch;

function hasValue(frontmatter: unknown, key: string): boolean {
  if (typeof frontmatter !== 'object' || frontmatter === null) return false;
  const value = (frontmatter as Record<string, unknown>)[key];
  return value !== undefined && value !== null && value !== '';
}

export class TimelineActions {
  private readonly host: TimelineHost;
  private readonly current: () => TimelineContent | null;
  private readonly mode: () => TimeMode;

  /**
   * @param current what the screen shows at the moment, or null when no project is open
   * @param mode    whether the screen is in date or story order
   */
  constructor(host: TimelineHost, current: () => TimelineContent | null, mode: () => TimeMode) {
    this.host = host;
    this.current = current;
    this.mode = mode;
  }

  // ------------------------------------------------------------------ events

  open(event: TimelineEvent, where: PaneType | boolean): void {
    safely('Open', () => {
      this.host.openNote(event.path, where);
    });
  }

  /** Move an event by whole steps of its own precision: a day, a month or a year earlier or later. */
  shift(event: TimelineEvent, steps: number): void {
    if (event.start === null) return;
    const target = shiftStoryDate(event.start, steps);
    this.change(steps < 0 ? 'Move earlier' : 'Move later', event, (frontmatter) => redateEntityPatch(frontmatter, target));
  }

  /** A dragged card was dropped: a new date, another lane, or both. */
  drop(event: TimelineEvent, fromLane: string, result: DropResult): void {
    const context = this.context(event);
    if (context === null) return;
    this.change('Move event', event, (frontmatter) => ({
      // An entity's moments come along with its dates; an event has none.
      ...(result.dateChanged ? redateEntityPatch(frontmatter, result.start) : {}),
      ...(result.laneChanged ? moveEventToLanePatch(frontmatter, fromLane, result.lane, context) : {}),
    }));
  }

  moveToLane(event: TimelineEvent, fromLane: string, toLane: string): void {
    const context = this.context(event);
    if (context === null) return;
    this.change('Move to lane', event, (frontmatter) => moveEventToLanePatch(frontmatter, fromLane, toLane, context));
  }

  addToLane(event: TimelineEvent, lane: string): void {
    const context = this.context(event);
    if (context === null) return;
    this.change('Also show in lane', event, (frontmatter) => addEventToLanePatch(frontmatter, lane, context));
  }

  removeFromLane(event: TimelineEvent, lane: string): void {
    const context = this.context(event);
    if (context === null) return;
    this.change('Remove from this lane', event, (frontmatter) => removeEventFromLanePatch(frontmatter, lane, context));
  }

  /** The lanes an event could be moved to from the lane it is shown in. */
  lanesToMoveTo(event: TimelineEvent, fromLane: string): DisplayLane[] {
    const context = this.context(event);
    if (context === null) return [];
    const frontmatter = this.frontmatterOf(event);
    return this.lanes().filter(
      (lane) => lane.key !== fromLane && !isEmptyPatch(moveEventToLanePatch(frontmatter, fromLane, lane.key, context)),
    );
  }

  /** The lanes an event is not in yet and could be shown in as well. */
  lanesToAddTo(event: TimelineEvent): DisplayLane[] {
    const context = this.context(event);
    if (context === null) return [];
    const frontmatter = this.frontmatterOf(event);
    return this.lanes().filter((lane) => !isEmptyPatch(addEventToLanePatch(frontmatter, lane.key, context)));
  }

  /** False when the event cannot be taken out of the lane (a scene is always in Manuscript). */
  canRemoveFrom(event: TimelineEvent, lane: string): boolean {
    const context = this.context(event);
    return context !== null && !isEmptyPatch(removeEventFromLanePatch(this.frontmatterOf(event), lane, context));
  }

  /** Open the window that asks for a new event's title and dates. */
  askNewEvent(date: StoryDate | null, lane: string | null): void {
    const content = this.current();
    if (content === null) return;
    // The Other lane only collects what names no listed lane: an event is put there by naming none.
    const listed = lane !== null && (lane !== laneKey(OTHER_LANE) || content.lanes.some((entry) => laneKey(entry.name) === lane));
    const names = lane !== null && listed ? [laneNameFor(lane, content.lanes)] : [];
    new EventModal(this.host.app, {
      heading: 'New event',
      confirm: 'Create',
      title: '',
      date: date === null ? '' : storyDateToText(date),
      end: '',
      dateNeeded: false,
      note: names[0] === undefined ? undefined : `Lane: ${names[0]}`,
      calendar: content.calendar,
      entities: { all: content.allEntities, chosen: [] },
      submit: async (answer) => {
        const frontmatter = newEventFrontmatter(answer.start, names);
        if (answer.end !== null) frontmatter['end'] = storyDateToFrontmatter(answer.end);
        // A new event names its entities only when some were chosen.
        const entities = setEntitiesPatch({}, answer.entities ?? [], content.entityIndex);
        Object.assign(frontmatter, entities);
        const result = await this.host.createEvent({ title: answer.title, frontmatter });
        return result.ok ? null : result.message;
      },
    }).open();
  }

  /** Open the window that asks for an event's dates: "Change date", or "Set date" for an undated one. */
  askDates(event: TimelineEvent): void {
    const content = this.current();
    if (content === null) return;
    new EventModal(this.host.app, {
      heading: event.start === null ? 'Set date' : 'Change date',
      confirm: 'Save',
      title: null,
      date: event.start === null ? '' : storyDateToText(event.start),
      end: event.end === null ? '' : storyDateToText(event.end),
      dateNeeded: true,
      note: event.title,
      calendar: content.calendar,
      entities: { all: content.allEntities, chosen: this.entitiesOf(event) },
      submit: async (answer) => {
        if (answer.start === null) return null;
        const dates = this.datesChange(event, answer.start, answer.end);
        const entities = answer.entities === null ? null : this.entitiesChange(event, answer.entities);
        // One note, one write: the dates and the entities go together.
        const patch = { ...(dates?.patch ?? {}), ...(entities?.patch ?? {}) };
        if (isEmptyPatch(patch)) return null;
        await this.host.applyNoteChanges([
          {
            path: event.path,
            patch,
            remake: (frontmatter) => ({ ...(dates?.patch ?? {}), ...(entities?.remake(frontmatter) ?? {}) }),
          },
        ]);
        return null;
      },
    }).open();
  }

  /** The entities an event names, as the screen shows them. */
  entitiesOf(event: TimelineEvent): readonly EventEntity[] {
    return this.current()?.entities.get(event.path) ?? [];
  }

  /** Open the list of entities for one event: tick the ones it involves. */
  askEntities(event: TimelineEvent): void {
    const content = this.current();
    if (content === null) return;
    const chosen = this.entitiesOf(event);
    new EntityPickerModal(this.host.app, {
      heading: 'Entities',
      confirm: 'Save',
      note: event.title,
      all: content.allEntities,
      chosen: chosen.map((entity) => entity.key),
      submit: async (keys) => {
        const change = this.entitiesChange(event, keys);
        if (change !== null) await this.host.applyNoteChanges([change]);
        return null;
      },
    }).open();
  }

  /** The change that makes an event name exactly the entities chosen; null when it does so already. */
  private entitiesChange(event: TimelineEvent, keys: readonly string[]): NoteChange | null {
    const content = this.current();
    if (content === null) return null;
    const index = content.entityIndex;
    const make = (frontmatter: unknown): FrontmatterPatch => setEntitiesPatch(frontmatter, keys, index);
    const patch = make(this.frontmatterOf(event));
    return isEmptyPatch(patch) ? null : { path: event.path, patch, remake: make };
  }

  /** Open the window that defines the calendar the project's story dates are counted in. */
  askCalendar(): void {
    const content = this.current();
    if (content === null) {
      new Notice('No Spellbook project is open.', REFUSAL_NOTICE_MS);
      return;
    }
    new CalendarModal(this.host.app, {
      stored: content.data.calendar,
      notes: [...content.data.events, ...content.data.scenes],
      save: (value) => this.host.saveCalendar(value),
    }).open();
  }

  /** The change that gives an event the dates the writer typed, exactly as typed. */
  private datesChange(event: TimelineEvent, start: StoryDate, end: StoryDate | null): NoteChange | null {
    const patch: Record<string, unknown> = {};
    if (event.start === null || !sameStoryDate(start, event.start)) patch['date'] = storyDateToFrontmatter(start);
    if (end === null) {
      // An end that was left empty goes, also one that could not be read.
      if (hasValue(this.frontmatterOf(event), 'end')) patch['end'] = null;
    } else if (event.end === null || !sameStoryDate(end, event.end)) {
      patch['end'] = storyDateToFrontmatter(end);
    }
    return isEmptyPatch(patch) ? null : { path: event.path, patch, remake: () => patch };
  }

  // ------------------------------------------------------------------- lanes

  /** Every lane there is to show, hidden ones included. */
  lanes(): DisplayLane[] {
    const content = this.current();
    return content === null ? [] : allLanes(content, this.mode());
  }

  isHidden(lane: DisplayLane): boolean {
    return (this.current()?.data.hiddenLanes ?? []).some((name) => laneKey(name) === lane.key);
  }

  /** Hide a lane on this device, or show it again. */
  toggleHidden(lane: DisplayLane): void {
    const hidden = this.current()?.data.hiddenLanes ?? [];
    const others = hidden.filter((name) => laneKey(name) !== lane.key);
    safely('Hide lane', () => {
      this.host.setHiddenLanes(others.length === hidden.length ? [...hidden, lane.name] : others);
    });
  }

  // ------------------------------------------------------------- world lanes

  /** True when this device shows the world lanes. */
  worldOn(): boolean {
    return this.current()?.world.on === true;
  }

  /** Every lane the world has: one per type that has an entity with a date, the hidden ones included. */
  worldLanes(): readonly WorldLane[] {
    return this.current()?.world.lanes ?? [];
  }

  /** Show the world lanes on this device, or stop showing them. Which types are hidden is kept either way. */
  setWorld(on: boolean): void {
    const choice = this.current()?.data.worldLanes ?? { on: false, hidden: [] };
    if (choice.on === on) return;
    safely('World lanes', () => {
      this.host.setWorldLanes?.({ on, hidden: choice.hidden });
    });
  }

  /** Hide the lane of one type of entity on this device, or show it again. */
  toggleWorldLane(lane: WorldLane): void {
    const choice = this.current()?.data.worldLanes ?? { on: false, hidden: [] };
    const others = choice.hidden.filter((id) => id !== lane.typeId);
    safely('World lanes', () => {
      this.host.setWorldLanes?.({ on: choice.on, hidden: others.length === choice.hidden.length ? [...choice.hidden, lane.typeId] : others });
    });
  }

  /**
   * The world's history: the world lanes on, and the lane of the scenes
   * off. Both are choices of this device, and both can be undone in the
   * window that lists the lanes.
   */
  showWorldHistory(): void {
    const content = this.current();
    if (content === null) return;
    this.setWorld(true);
    const hidden = content.data.hiddenLanes;
    if (hidden.some((name) => laneKey(name) === laneKey(MANUSCRIPT_LANE))) return;
    safely('World history', () => {
      this.host.setHiddenLanes([...hidden, MANUSCRIPT_LANE]);
    });
  }

  /** True when the lane can take the place `toIndex` in the order. */
  canMoveLane(lane: DisplayLane, toIndex: number): boolean {
    const content = this.current();
    if (content === null || toIndex < 0) return false;
    const result = moveLane(content.data.timelines, lane.name, toIndex);
    return result.ok && result.changed;
  }

  moveLane(lane: DisplayLane, toIndex: number): void {
    this.changeLanes('Move lane', (timelines) => moveLane(timelines, lane.name, toIndex));
  }

  recolourLane(lane: DisplayLane, color: LaneColor | null): void {
    this.changeLanes('Change colour', (timelines) => recolourLane(timelines, lane.name, color));
  }

  askNewLane(): void {
    new TextPromptModal(this.host.app, {
      title: 'New lane',
      label: 'Lane name',
      placeholder: 'Lane name',
      confirm: 'Add',
      submit: async (name) => {
        const result = await this.host.saveLanes((timelines) => addLane(timelines, name), []);
        return result.ok ? null : result.message;
      },
    }).open();
  }

  askRenameLane(lane: DisplayLane): void {
    new TextPromptModal(this.host.app, {
      title: 'Rename lane',
      label: 'Lane name',
      value: lane.name,
      confirm: 'Rename',
      submit: (name) => this.renameLane(lane.name, name),
    }).open();
  }

  /** Rename a lane and every event that names it. Resolves with a message when the name will not do. */
  private async renameLane(from: string, to: string): Promise<string | null> {
    const content = this.current();
    if (content === null) return 'No project is open.';
    const name = tidyDisplayName(to);
    const notes = [...content.data.events, ...content.data.scenes];
    // Worked out on what the screen shows, to know which notes name the lane.
    const preview = renameLane(content.data.timelines, from, name, notes);
    if (!preview.ok) return preview.message;
    const changes = preview.eventPatches.map(
      (entry): NoteChange => ({
        path: entry.path,
        patch: entry.patch,
        remake: (frontmatter) => renameLaneInEventPatch(frontmatter, from, name),
      }),
    );
    const result = await this.host.saveLanes((timelines) => renameLane(timelines, from, name), changes);
    return result.ok ? null : result.message;
  }

  askRemoveLane(lane: DisplayLane): void {
    new ConfirmModal(this.host.app, {
      title: `Remove the lane "${lane.name}"?`,
      message: 'Its events are kept. They still name this lane, and show in the Other lane from now on.',
      confirm: 'Remove',
      onConfirm: () => {
        this.changeLanes('Remove lane', (timelines) => removeLane(timelines, lane.name));
      },
    }).open();
  }

  // ----------------------------------------------------------------- helpers

  private frontmatterOf(event: TimelineEvent): unknown {
    return this.current()?.frontmatter.get(event.path);
  }

  private context(event: TimelineEvent): LaneContext | null {
    const content = this.current();
    return content === null ? null : { lanes: content.lanes, source: event.source };
  }

  /** Hand one note's change to the host, unless it changes nothing. A failure is told in a notice. */
  private change(what: string, event: TimelineEvent, make: PatchMaker): void {
    const patch = make(this.frontmatterOf(event));
    if (isEmptyPatch(patch)) return;
    safely(what, () => this.host.applyNoteChanges([{ path: event.path, patch, remake: make }]));
  }

  private changeLanes(what: string, make: (timelines: unknown) => LaneChange): void {
    safely(what, async () => {
      const result = await this.host.saveLanes(make, []);
      if (!result.ok) new Notice(result.message, REFUSAL_NOTICE_MS);
    });
  }
}
