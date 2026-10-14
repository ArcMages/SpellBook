// The timeline's menus: a card's "more" menu, the lists of lanes it leads to,
// and the menus of the window that lists the lanes.
//
// Obsidian's menus have no sub-lists in every version the plugin supports,
// so "Move to lane" opens a second menu in the same place: the lanes to
// choose from. It opens a moment after the first one has closed.

import { Menu } from 'obsidian';
import { LANE_COLORS } from '../../core/timeline';
import type { DisplayLane, LaneColor, TimelineEvent } from '../../core/timeline';
import type { DragClock } from '../../ui/dragDrop';
import { iconName } from '../../ui/icons';
import { ownTextTitle } from '../../ui/ownText';
import type { TimelineActions } from './timelineActions';

/** What the timeline's buttons and menu items show: every name an icon has had, the preferred one first. */
export const TIMELINE_ICONS = {
  view: ['calendar-range', 'calendar-clock', 'calendar'],
  zoomIn: ['zoom-in', 'plus'],
  zoomOut: ['zoom-out', 'minus'],
  lanes: ['rows-3', 'layers', 'list'],
  newEvent: ['plus'],
  more: ['ellipsis', 'more-horizontal'],
  fold: ['chevron-down'],
  open: ['file-text', 'file'],
  openInNewTab: ['file-plus', 'file'],
  date: ['calendar'],
  calendar: ['calendar-cog', 'calendar-days', 'calendar'],
  entities: ['users', 'user'],
  filter: ['filter', 'list-filter'],
  moveToLane: ['arrow-right-left', 'move'],
  addToLane: ['copy-plus', 'plus'],
  removeFromLane: ['x'],
  rename: ['pencil', 'edit-3'],
  colour: ['palette'],
  moveUp: ['arrow-up'],
  moveDown: ['arrow-down'],
  remove: ['trash-2', 'trash'],
} as const satisfies Record<string, readonly string[]>;

/** What the "more" button of a card and of a lane is called. */
export const MORE_LABEL = 'More options';

export const NO_COLOUR_LABEL = 'No colour';

/** A colour's name as a menu shows it: "Red". */
export function colourLabel(color: LaneColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/** Where a menu opens: a place in the window. */
export interface MenuPlace {
  readonly x: number;
  readonly y: number;
}

/** A lane's name as a menu item's title. The writer's own lanes take the direction of their text. */
function laneTitle(lane: DisplayLane): string | DocumentFragment {
  return lane.kind === 'lane' ? ownTextTitle(lane.name) : lane.name;
}

/** A menu that lists lanes; picking one calls `pick` with it. */
export function laneListMenu(lanes: readonly DisplayLane[], pick: (lane: DisplayLane) => void): Menu {
  const menu = new Menu();
  for (const lane of lanes) {
    menu.addItem((item) => {
      item.setTitle(laneTitle(lane)).onClick(() => {
        pick(lane);
      });
    });
  }
  return menu;
}

/**
 * The "more" menu of an event card.
 *
 * @param laneKey the lane the card is shown in
 * @param place   where the menu opens, and the lists of lanes after it
 */
export function eventMenu(
  actions: TimelineActions,
  clock: DragClock,
  event: TimelineEvent,
  laneKey: string,
  place: MenuPlace,
): Menu {
  const menu = new Menu();
  const later = (lanes: readonly DisplayLane[], pick: (lane: DisplayLane) => void): void => {
    clock.setTimer(() => {
      laneListMenu(lanes, pick).showAtPosition(place);
    }, 0);
  };
  menu.addItem((item) => {
    item
      .setTitle('Open')
      .setIcon(iconName(...TIMELINE_ICONS.open))
      .onClick(() => {
        actions.open(event, false);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Open in new tab')
      .setIcon(iconName(...TIMELINE_ICONS.openInNewTab))
      .onClick(() => {
        actions.open(event, 'tab');
      });
  });
  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle(event.start === null ? 'Set date' : 'Change date')
      .setIcon(iconName(...TIMELINE_ICONS.date))
      .onClick(() => {
        actions.askDates(event);
      });
  });
  // The ways to move a card without dragging it.
  menu.addItem((item) => {
    item
      .setTitle('Move earlier')
      .setDisabled(event.start === null)
      .onClick(() => {
        actions.shift(event, -1);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Move later')
      .setDisabled(event.start === null)
      .onClick(() => {
        actions.shift(event, 1);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Entities')
      .setIcon(iconName(...TIMELINE_ICONS.entities))
      .onClick(() => {
        actions.askEntities(event);
      });
  });
  menu.addSeparator();
  const moveTo = actions.lanesToMoveTo(event, laneKey);
  menu.addItem((item) => {
    item
      .setTitle('Move to lane')
      .setIcon(iconName(...TIMELINE_ICONS.moveToLane))
      .setDisabled(moveTo.length === 0)
      .onClick(() => {
        later(moveTo, (lane) => {
          actions.moveToLane(event, laneKey, lane.key);
        });
      });
  });
  const addTo = actions.lanesToAddTo(event);
  menu.addItem((item) => {
    item
      .setTitle('Also show in lane')
      .setIcon(iconName(...TIMELINE_ICONS.addToLane))
      .setDisabled(addTo.length === 0)
      .onClick(() => {
        later(addTo, (lane) => {
          actions.addToLane(event, lane.key);
        });
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Remove from this lane')
      .setIcon(iconName(...TIMELINE_ICONS.removeFromLane))
      .setDisabled(!actions.canRemoveFrom(event, laneKey))
      .onClick(() => {
        actions.removeFromLane(event, laneKey);
      });
  });
  return menu;
}

/**
 * The menu of an entity of a world lane: its sheet, its note, and the ways
 * to move it in time without dragging it.
 *
 * @param event     the entity as the timeline moves an event: its own "date" and "end"
 * @param showSheet shows the entity's sheet (its note, when no sheet is on offer)
 */
export function worldMenu(actions: TimelineActions, event: TimelineEvent, showSheet: () => void): Menu {
  const menu = new Menu();
  menu.addItem((item) => {
    item
      .setTitle('Open sheet')
      .setIcon(iconName(...TIMELINE_ICONS.entities))
      .onClick(showSheet);
  });
  menu.addItem((item) => {
    item
      .setTitle('Open note')
      .setIcon(iconName(...TIMELINE_ICONS.open))
      .onClick(() => {
        actions.open(event, false);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Open note in new tab')
      .setIcon(iconName(...TIMELINE_ICONS.openInNewTab))
      .onClick(() => {
        actions.open(event, 'tab');
      });
  });
  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle('Move earlier')
      .setDisabled(event.start === null)
      .onClick(() => {
        actions.shift(event, -1);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Move later')
      .setDisabled(event.start === null)
      .onClick(() => {
        actions.shift(event, 1);
      });
  });
  return menu;
}

/** The colours a lane can have, with the one it has ticked. */
export function colourMenu(current: LaneColor | null, pick: (color: LaneColor | null) => void): Menu {
  const menu = new Menu();
  menu.addItem((item) => {
    item
      .setTitle(NO_COLOUR_LABEL)
      .setChecked(current === null)
      .onClick(() => {
        pick(null);
      });
  });
  for (const color of LANE_COLORS) {
    menu.addItem((item) => {
      item
        .setTitle(colourLabel(color))
        .setChecked(current === color)
        .onClick(() => {
          pick(color);
        });
    });
  }
  return menu;
}

/**
 * The "more" menu of a lane, in the window that lists the lanes.
 *
 * @param index the lane's place in the list, from 0
 */
export function laneMenu(
  actions: TimelineActions,
  clock: DragClock,
  lane: DisplayLane,
  index: number,
  place: MenuPlace,
): Menu {
  const menu = new Menu();
  const own = lane.kind === 'lane';
  menu.addItem((item) => {
    item
      .setTitle('Rename')
      .setIcon(iconName(...TIMELINE_ICONS.rename))
      .setDisabled(!own)
      .onClick(() => {
        actions.askRenameLane(lane);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Colour')
      .setIcon(iconName(...TIMELINE_ICONS.colour))
      .onClick(() => {
        clock.setTimer(() => {
          colourMenu(lane.color, (color) => {
            actions.recolourLane(lane, color);
          }).showAtPosition(place);
        }, 0);
      });
  });
  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle('Move up')
      .setIcon(iconName(...TIMELINE_ICONS.moveUp))
      .setDisabled(!actions.canMoveLane(lane, index - 1))
      .onClick(() => {
        actions.moveLane(lane, index - 1);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Move down')
      .setIcon(iconName(...TIMELINE_ICONS.moveDown))
      .setDisabled(!actions.canMoveLane(lane, index + 1))
      .onClick(() => {
        actions.moveLane(lane, index + 1);
      });
  });
  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle('Remove')
      .setIcon(iconName(...TIMELINE_ICONS.remove))
      .setDisabled(!own)
      .onClick(() => {
        actions.askRemoveLane(lane);
      });
  });
  return menu;
}
