// The timeline engine: story dates, events, lanes, the time scale, layout,
// narrative order and drag maths. Pure logic: plain values in, plain values
// out. No file is read or written here, no clock is looked at and nothing is
// drawn; the screen and the project store do that with what this file exports.
//
// How the pieces fit, for a screen:
//
//   const lanes = readLanes(index.timelines).lanes;
//   const { dated, undated } = readTimeline(eventNotes, sceneNotes);
//   const scale = fitAll(timelineExtent(dated), viewportWidth);
//   const layout = layoutTimeline(dated, lanes, { scale, measure, hidden });
//   const axis = ticksFor(scale, viewportWidth);
//
// and to change a note, at the moment of writing and on its fresh properties:
//
//   applyFrontmatterPatch(properties, redateEventPatch(properties, newStart));

// ------------------------------------------------------------- story dates

/** How exactly a story date is known: to the year, the month or the day. */
export type { DatePrecision } from './storyDate';
/** A date in the story: a year from 1 to 9999, with a month and a day when they are known. */
export type { StoryDate } from './storyDate';
/** A start date, and an end date when something lasts. */
export type { DateRange } from './storyDate';
/** The first year a story date can have: 1. */
export { MIN_YEAR } from './storyDate';
/** The last year a story date can have: 9999. */
export { MAX_YEAR } from './storyDate';
/** The day number of 1 January of year 1. */
export { MIN_DAY_NUMBER } from './storyDate';
/** The day number of 31 December 9999. */
export { MAX_DAY_NUMBER } from './storyDate';
/** True for a leap year (2000 is one, 1900 is not). */
export { isLeapYear } from './storyDate';
/** The number of days in a month of a year. */
export { daysInMonth } from './storyDate';
/** Make a story date from a year, a year and month, or all three; null when it does not exist. */
export { storyDate } from './storyDate';
/** Read a story date from a property value (a number, text, or a date and time); null means undated. */
export { readStoryDate } from './storyDate';
/** A story date as "1923", "1923-04" or "1923-04-12". */
export { storyDateToText } from './storyDate';
/** A story date as the value to store in a note: 1923, "1923-04" or "1923-04-12". */
export { storyDateToFrontmatter } from './storyDate';
/** A story date in English: "12 Apr 1923", "Apr 1923" or "1923". */
export { formatStoryDate } from './storyDate';
/** A start and an end in English, joined by an en dash. */
export { formatStoryDateRange } from './storyDate';
/** The whole day number of a story date (days since 1 January 1970; a year or month counts as its first day). */
export { storyDateToDayNumber } from './storyDate';
/** The story date holding a day number, as a day or as the month or year it falls in. */
export { dayNumberToStoryDate } from './storyDate';
/** True when two story dates are the same day at the same precision. */
export { sameStoryDate } from './storyDate';
/** Sort order for story dates: earlier first. */
export { compareStoryDates } from './storyDate';
/** A story date moved by whole steps of its own precision (years, months or days); for "one earlier, one later" buttons. */
export { shiftStoryDate } from './storyDate';
/** Move a start date and bring its end along, so a span keeps its length. */
export { moveDates } from './storyDate';

// ------------------------------------------------------------------ events

/** The folder of a project that holds the event notes: "Timeline". */
export { TIMELINE_FOLDER } from './events';
/** The property that marks an event note: "spellbook". */
export { EVENT_MARKER_KEY } from './events';
/** The value of that property: "event". */
export { EVENT_MARKER_VALUE } from './events';
/** Where an event comes from: a note in Timeline/ ('event') or a dated scene ('scene'). */
export type { EventSource } from './events';
/** Something in an event's properties that could not be used. */
export type { EventProblem } from './events';
/** One event: its path, title, dates, timelines, linked scenes, tags and problems. */
export type { TimelineEvent } from './events';
/** A note handed to the readers: its path and its properties. */
export type { TimelineNote } from './events';
/** Every event of a project: the dated ones in order, and the undated ones. */
export type { TimelineModel } from './events';
/** True for the project-relative path of a note inside Timeline/. */
export { isEventPath } from './events';
/** An event problem in plain English. */
export { describeEventProblem } from './events';
/** What a link points at: "[[Opening|x]]" gives "Opening". */
export { linkTarget } from './events';
/** Read a note in Timeline/ as an event; never throws. */
export { readEvent } from './events';
/** Read a scene as an event; null when the scene has no date. */
export { readSceneEvent } from './events';
/** Read all events of a project from its event notes and its scenes. */
export { readTimeline } from './events';
/** Make a function that finds which scene of the manuscript a link points at. */
export { createSceneResolver } from './events';
/** The properties of a new event note: the "spellbook: event" mark, the date and the timelines. */
export { newEventFrontmatter } from './events';
/** The change that moves an event to a new date, keeping its precision and a span's length. */
export { redateEventPatch } from './events';

// ----------------------------------------------------- changes to a note

/** A change to a note's properties: the ones to set. Everything else stays as it is. */
export type { FrontmatterPatch } from './common';
/** True when a patch changes nothing. */
export { isEmptyPatch } from './common';
/** Apply a patch to a note's properties, in place. */
export { applyFrontmatterPatch } from './common';

// ------------------------------------------------------------------- lanes

/** The eight colour names a lane can have. */
export { LANE_COLORS } from './common';
/** One of the eight colour names. */
export type { LaneColor } from './common';
/** A stored colour as one of the eight names, or null for anything else. */
export { readLaneColor } from './common';
/** A lane as the project index lists it: a name and a colour. */
export type { Lane } from './common';
/** The name of the built-in lane that holds every dated scene: "Manuscript". */
export { MANUSCRIPT_LANE } from './common';
/** The name of the lane for events whose timeline the project does not list: "Other". */
export { OTHER_LANE } from './common';
/** What lane names are compared by: capitals and spaces around the name do not count. */
export { laneKey } from './common';
/** The lanes read from the project index, with what was skipped. */
export type { LaneList } from './lanes';
/** Whether a lane is Manuscript, Other, or one of the writer's own. */
export type { LaneKind } from './lanes';
/** A lane as the screen shows it, with its key and kind. */
export type { DisplayLane } from './lanes';
/** Why a change to the lanes was refused. */
export type { LaneRefusal } from './lanes';
/** What a change to the lanes came to: the value to store, or a refusal. */
export type { LaneChange } from './lanes';
/** The change one event note needs: its path and the patch. */
export type { EventPatch } from './lanes';
/** What renaming a lane came to, with the change for every event that names it. */
export type { LaneRename } from './lanes';
/** Read the "timelines" key of the project index; never throws. */
export { readLanes } from './lanes';
/** Add a lane; names are unique, whatever their capitals. */
export { addLane } from './lanes';
/** Rename a lane, and work out the change for every event that names it. */
export { renameLane } from './lanes';
/** Give a lane one of the eight colours, or none. */
export { recolourLane } from './lanes';
/** Move a lane to another place in the order. */
export { moveLane } from './lanes';
/** Remove a lane from the list; its events then show in Other. */
export { removeLane } from './lanes';
/** The lanes to show, in order, with Manuscript and (when needed) Other. */
export { displayLanes } from './lanes';
/** Leave out the lanes this device has hidden. */
export { visibleLanes } from './lanes';
/** What a lane change on an event needs to know: the project's lanes, and whether the note is a scene. */
export type { LaneContext } from './eventLanes';
/** The keys of the lanes an event shows in. */
export { eventLaneKeys } from './eventLanes';
/** The name to write in a note for a lane, from its key or any spelling of its name. */
export { laneNameFor } from './eventLanes';
/** The change that adds an event to a lane, given the lane's key or name. */
export { addEventToLanePatch } from './eventLanes';
/** The change that takes an event out of a lane, given the lane's key or name. */
export { removeEventFromLanePatch } from './eventLanes';
/** The change that moves an event from one lane to another, given their keys or names. */
export { moveEventToLanePatch } from './eventLanes';
/** The change one event needs when a lane is renamed. */
export { renameLaneInEventPatch } from './eventLanes';

// -------------------------------------------------------------- time scale

/** A zoom (pixels per day) and the day shown at position 0. */
export type { TimeScale } from './scale';
/** The furthest zoom out, in pixels per day. */
export { MIN_PX_PER_DAY } from './scale';
/** The closest zoom in, in pixels per day. */
export { MAX_PX_PER_DAY } from './scale';
/** The zoom used when there is nothing to fit. */
export { DEFAULT_PX_PER_DAY } from './scale';
/** The least distance between two labels on the axis: 80 pixels. */
export { MIN_LABEL_GAP } from './scale';
/** A zoom brought within the limits. */
export { clampZoom } from './scale';
/** Make a time scale from a zoom and the day at position 0. */
export { makeScale } from './scale';
/** The position, in pixels, of a day number. */
export { dayToPosition } from './scale';
/** The day number at a position; it can have a fraction. */
export { positionToDay } from './scale';
/** Zoom about a point, so the date under the finger stays put. */
export { zoomAbout } from './scale';
/** Slide the view by a distance in pixels. */
export { panBy } from './scale';
/** The first and last day a set of events covers. */
export type { TimelineExtent } from './scale';
/** The days the dated events cover; null when none has a date. */
export { timelineExtent } from './scale';
/** Room to leave around the events when fitting them all. */
export type { FitOptions } from './scale';
/** "Fit all": the scale that shows every event, with padding. */
export { fitAll } from './scale';
/** The step between two labels on the axis: day, month, year, 5 years, decade, century, or more. */
export type { TickUnit } from './scale';
/** One labelled mark on the axis. */
export type { Tick } from './scale';
/** The marks to draw on the axis, and the step between them. */
export type { TickPlan } from './scale';
/** The labelled marks for the visible part of the axis, at least 80 pixels apart. */
export { ticksFor } from './scale';

// ------------------------------------------------------------------ layout

/** The room kept between two cards in a row, unless another is asked for. */
export { DEFAULT_CARD_GAP } from './layout';
/** The smallest card, unless another is asked for. */
export { DEFAULT_MIN_CARD_LENGTH } from './layout';
/** How close single-date events must be to merge, unless another distance is asked for. */
export { DEFAULT_CLUSTER_DISTANCE } from './layout';
/** The zoom below which clusters form, unless another is asked for. */
export { DEFAULT_CLUSTER_BELOW_PX_PER_DAY } from './layout';
/** The function that tells how much room a card needs along the time axis. */
export type { MeasureCard } from './layout';
/** What a layout needs: the scale, the measuring function, hidden lanes and spacing. */
export type { LayoutOptions } from './layout';
/** An event card with its row, position and width. */
export type { PlacedEvent } from './layout';
/** A cluster of crowded events with its count, date range, row, position and width. */
export type { PlacedCluster } from './layout';
/** A placed card: an event or a cluster. */
export type { PlacedItem } from './layout';
/** One lane laid out: its cards and its number of rows. */
export type { LaneLayout } from './layout';
/** The whole timeline laid out, lane by lane. */
export type { TimelineLayout } from './layout';
/** An event card for a time axis that runs down: its column, position and height. */
export type { StackedEvent } from './layout';
/** A cluster for a time axis that runs down. */
export type { StackedCluster } from './layout';
/** A card for a time axis that runs down: an event or a cluster. */
export type { StackedItem } from './layout';
/** One lane laid out for a phone: its cards and its number of columns. */
export type { VerticalLaneLayout } from './layout';
/** Lay out every visible lane for a time axis that runs across the screen. */
export { layoutTimeline } from './layout';
/** Lay out one lane for a phone, with time running from top to bottom. */
export { layoutLaneVertical } from './layout';

// --------------------------------------------------------- narrative order

/** How to space the events of the narrative view, and how to follow links. */
export type { NarrativeOptions } from './narrative';
/** One event in the narrative view: its scene, that scene's place, and its position. */
export type { NarrativeItem } from './narrative';
/** The distance between two events of the narrative view, unless another is asked for. */
export { DEFAULT_NARRATIVE_SPACING } from './narrative';
/** Put the events in the order the manuscript tells them, evenly spaced. */
export { narrativeOrder } from './narrative';

// --------------------------------------------------------------- drag maths

/** A press that moves less than this many pixels is a tap. */
export { TAP_THRESHOLD } from './drag';
/** True when a press moved so little that it is a tap, not a drag. */
export { isTap } from './drag';
/** The date at a position on the axis, snapped to a precision. */
export { dateAtPosition } from './drag';
/** A precision that suits the zoom, for dating a new event. */
export { precisionForScale } from './drag';
/** The dates of an event after a drag along the time axis, snapped to its own precision. */
export { dragDates } from './drag';
/** The strip a lane takes up across the time axis. */
export type { LaneBand } from './drag';
/** The sizes the lanes are drawn with. */
export type { LaneMetrics } from './drag';
/** The strips of the lanes, worked out from their row counts. */
export { laneBands } from './drag';
/** The lane under the pointer. */
export { laneAt } from './drag';
/** A press on an event card and how far it has moved. */
export type { DragInput } from './drag';
/** What a press came to: a tap, or a drag to a new date, a new lane or both. */
export type { DragOutcome } from './drag';
/** Work out what a press on an event card means: a tap, a new date, a new lane. */
export { resolveDrag } from './drag';
