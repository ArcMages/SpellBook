// A row of a world lane, on the page: one entity of the world in time.
//
// Across a wide pane the row is drawn to scale. An entity with a "date" and
// an "end" is a bar from one to the other; one with only a "date" is a point
// (and so is one with only an "end"); its moments are small points on the
// same row; and its name stands on the bar, or beside the point. Down a
// narrow pane a card cannot be drawn to scale (the cards follow each other),
// so the entity is a card like an event's: its name, and under it its dates
// and how many moments it has.
//
// The view (timelineView.ts) decides where the card is and how big; this
// file fills it and, on a wide pane, puts the bar and the points where their
// days are. Nothing here reads or changes anything.
//
// Names and labels are the writer's own text, in any language, and so are
// the names of an invented calendar's months: each takes the direction of
// its own text. Sides are named "start" and "end": the row mirrors with the app.

import { formatStoryDate } from '../../core/timeline';
import { dateWords, spanText } from '../../core/world';
import type { WorldTimeRow } from '../../core/world';
import { showIcon } from '../../ui/icons';
import { MORE_LABEL, TIMELINE_ICONS } from './timelineMenus';

/** How far past the card a bar may be drawn, so that its cut end is never seen. */
const BAR_OVERSHOOT = 8;
/** A point further than this outside the card is not drawn at all. */
const POINT_SLACK = 12;

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/** What a filled world card is made of. */
interface WorldCardParts {
  /** The bar from the "date" to the "end"; null for an entity without both. */
  readonly bar: HTMLElement | null;
  /** The point of an entity with only one of its two dates; null otherwise. */
  readonly mark: HTMLElement | null;
  /** The day the point stands on. */
  readonly markDay: number | null;
  /** The moments, as small points, with the day each stands on. */
  readonly dots: ReadonlyArray<{ readonly el: HTMLElement; readonly day: number }>;
}

const PARTS = new WeakMap<HTMLElement, WorldCardParts>();

/** What a moment says when it is read out or pointed at: "1911: qualifies as a chart maker". */
function momentTitle(point: WorldTimeRow['points'][number]): string {
  const date = formatStoryDate(point.date);
  return point.label === '' ? date : `${date}: ${point.label}`;
}

/** An entity's dates in words: "Born 17 Apr 1889, Died Mar 1923"; "" when it has neither. */
export function worldDatesText(row: WorldTimeRow): string {
  const words = dateWords(row.type);
  const parts: string[] = [];
  if (row.time.start !== null) parts.push(`${words.from} ${formatStoryDate(row.time.start)}`);
  if (row.time.end !== null) parts.push(`${words.until} ${formatStoryDate(row.time.end)}`);
  return parts.join(', ');
}

/** Everything a world card shows, as one text: the card is filled again only when this changes. */
export function worldCardDrawn(row: WorldTimeRow, color: string | null, vertical: boolean): string {
  return [
    'world',
    row.entity.name,
    row.type?.name ?? '',
    color ?? '',
    vertical,
    worldDatesText(row),
    row.startDay,
    row.endDay,
    row.points.map((point) => `${point.day}:${point.label}`).join(';'),
  ].join('|');
}

/**
 * Fill a card with an entity. The card is emptied first.
 *
 * @param vertical true when time runs down (the phone layout)
 * @returns the element that holds the name (the view keeps the name of a long bar in sight), and the "more" button when the card has one
 */
export function fillWorldCard(el: HTMLElement, row: WorldTimeRow, vertical: boolean): { readonly text: HTMLElement; readonly more: HTMLElement | null } {
  el.empty();
  el.addClass('spellbook-timeline-world');
  el.removeClass('spellbook-timeline-cluster', 'spellbook-is-scene', 'spellbook-has-problem');
  const dates = worldDatesText(row);
  const moments = row.points.length === 0 ? '' : row.points.length === 1 ? '1 moment' : `${row.points.length} moments`;
  // Read out, and shown when the card is pointed at: who it is, what it is, and when.
  const said = [row.entity.name, row.type?.name ?? '', dates, moments].filter((part) => part !== '').join(', ');
  el.setAttr('aria-label', said);
  el.setAttr('title', said);
  const whole = row.startDay !== null && row.endDay !== null;
  el.toggleClass('spellbook-is-span', !vertical && whole);
  el.toggleClass('spellbook-is-point', !vertical && !whole);
  el.toggleClass('spellbook-has-meta', vertical);

  if (vertical) {
    PARTS.delete(el);
    const text = el.createDiv({ cls: 'spellbook-timeline-card-text' });
    // The name is the writer's own text: it alone takes the direction of what it says.
    text.createDiv({ cls: 'spellbook-timeline-card-title', text: row.entity.name, attr: { dir: 'auto' } });
    const line = text.createDiv({ cls: 'spellbook-timeline-card-meta' });
    const span = spanText(row.time);
    if (span !== '') {
      const date = line.createSpan({ cls: 'spellbook-timeline-card-date', text: span });
      // The names of an invented calendar's months and eras are the writer's own text.
      if ((row.time.start ?? row.time.end)?.calendar !== undefined) date.setAttr('dir', 'auto');
    }
    if (moments !== '') line.createSpan({ cls: 'spellbook-timeline-world-moments', text: moments });
    const more = el.createSpan({ cls: 'spellbook-timeline-card-more', attr: { role: 'button', 'aria-label': MORE_LABEL, 'aria-haspopup': 'menu' } });
    showIcon(more, ...TIMELINE_ICONS.more);
    return { text, more };
  }

  const bar = whole ? el.createSpan({ cls: 'spellbook-timeline-world-bar', attr: { 'aria-hidden': 'true' } }) : null;
  const markDay = whole ? null : (row.startDay ?? row.endDay);
  const mark = markDay === null ? null : el.createSpan({ cls: 'spellbook-timeline-world-mark', attr: { 'aria-hidden': 'true' } });
  mark?.toggleClass('spellbook-is-end', row.startDay === null);
  const dots = row.points.map((point) => ({
    // A moment says what it is when it is pointed at; the card's own label counts them for a screen reader.
    el: el.createSpan({ cls: 'spellbook-timeline-world-dot', attr: { title: momentTitle(point), 'aria-hidden': 'true' } }),
    day: point.day,
  }));
  PARTS.set(el, { bar, mark, markDay, dots });
  const text = el.createDiv({ cls: 'spellbook-timeline-card-text spellbook-timeline-world-text' });
  text.createDiv({ cls: 'spellbook-timeline-card-title', text: row.entity.name, attr: { dir: 'auto' } });
  return { text, more: null };
}

/** Where a filled card stands, for putting its bar and its points in place. */
export interface WorldCardPlace {
  /** The size of a day, in pixels. */
  readonly pxPerDay: number;
  /** How far the card's own start is past the day the row begins on (a long bar is cut to what is near the view). */
  readonly cut: number;
  /** How long the card is along the time axis. */
  readonly size: number;
}

/**
 * Put the bar and the points of a card where their days are. Does nothing
 * for a card of the phone layout, which is not drawn to scale.
 */
export function placeWorldCard(el: HTMLElement, row: WorldTimeRow, place: WorldCardPlace): void {
  const parts = PARTS.get(el);
  if (parts === undefined) return;
  const at = (day: number): number => (day - row.firstDay) * place.pxPerDay - place.cut;
  if (parts.bar !== null && row.startDay !== null && row.endDay !== null) {
    const from = Math.max(-BAR_OVERSHOOT, Math.min(place.size, at(row.startDay)));
    const to = Math.max(from, Math.min(place.size + BAR_OVERSHOOT, at(row.endDay)));
    parts.bar.style.insetInlineStart = px(from);
    parts.bar.style.inlineSize = px(to - from);
  }
  const point = (dot: HTMLElement, day: number): void => {
    const where = at(day);
    const seen = where >= -POINT_SLACK && where <= place.size + POINT_SLACK;
    dot.toggleClass('spellbook-is-hidden', !seen);
    if (seen) dot.style.insetInlineStart = px(where);
  };
  if (parts.mark !== null && parts.markDay !== null) point(parts.mark, parts.markDay);
  for (const dot of parts.dots) point(dot.el, dot.day);
}
