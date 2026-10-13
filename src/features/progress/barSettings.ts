// The "Bottom bar" part of the settings: the writer chooses which figures the
// bar shows, adds shortcut buttons that run a command, and puts them in
// order. Everything is done with buttons (move up, move down, remove), so it
// works the same with a finger as with a mouse.
//
// Every change is stored at once, on this device, and the bar follows at once.

import { Menu, Setting } from 'obsidian';
import type { App } from 'obsidian';
import {
  BAR_BUTTON_ICONS,
  BAR_ITEMS,
  BAR_PRESETS,
  DEFAULT_BAR_LAYOUT,
  MAX_BAR_ENTRIES,
  addBarButton,
  addBarItem,
  barItemName,
  editBarButton,
  missingBarItems,
  moveBarEntry,
  removeBarEntry,
} from '../../core/progress/index';
import type { BarButtonEntry, BarEntry, BarLayout, BarPreset } from '../../core/progress/index';
import type { BarPrefs } from './barPrefs';
import { CommandPicker } from './commandPicker';
import { findCommand } from './commands';

export interface BarSettingsDeps {
  readonly prefs: BarPrefs;
  readonly app: App;
}

/** A preset's figures, followed by the shortcut buttons the writer already has: those are kept. */
export function applyPreset(layout: BarLayout, preset: BarPreset): BarLayout {
  return { entries: [...preset.layout.entries, ...layout.entries.filter((entry) => entry.kind === 'button')] };
}

/** Show a menu where the writer clicked (or, without a place to show it at, at the corner of the window). */
function showMenu(menu: Menu, event: unknown): void {
  const mouse = event as Partial<MouseEvent> | null | undefined;
  if (mouse !== null && mouse !== undefined && typeof mouse.clientX === 'number' && typeof mouse.clientY === 'number') {
    menu.showAtMouseEvent(mouse as MouseEvent);
  } else {
    menu.showAtPosition({ x: 0, y: 0 });
  }
}

/**
 * Draw the rows of the bar's settings into `containerEl`, and draw them again
 * whenever the layout changes.
 *
 * @returns the function to call when the rows are taken away
 */
export function renderBarSettings(containerEl: HTMLElement, deps: BarSettingsDeps): () => void {
  const { prefs, app } = deps;
  const host = containerEl.createDiv({ cls: 'spellbook-bar-settings' });
  let picker: CommandPicker | null = null;
  let gone = false;

  const change = (layout: BarLayout, redraw = true): void => {
    prefs.set(layout);
    if (redraw) draw();
  };

  const commandName = (entry: BarButtonEntry): string => findCommand(app, entry.command)?.name ?? entry.command;

  const orderButtons = (row: Setting, index: number, count: number): void => {
    row.addButton((button) => {
      button
        .setButtonText('Move up')
        .setDisabled(index === 0)
        .onClick(() => change(moveBarEntry(prefs.layout, index, -1)));
    });
    row.addButton((button) => {
      button
        .setButtonText('Move down')
        .setDisabled(index === count - 1)
        .onClick(() => change(moveBarEntry(prefs.layout, index, 1)));
    });
    row.addButton((button) => {
      button.setButtonText('Remove').onClick(() => change(removeBarEntry(prefs.layout, index)));
    });
  };

  const entryRow = (list: HTMLElement, entry: BarEntry, index: number, count: number): void => {
    const row = new Setting(list);
    row.settingEl.addClass('spellbook-bar-settings-entry');
    if (entry.kind === 'item') {
      row.setName(`${index + 1}. ${barItemName(entry.id)}`);
      row.setDesc(BAR_ITEMS.find((item) => item.id === entry.id)?.description ?? '');
    } else {
      const there = findCommand(app, entry.command) !== null;
      row.setName(`${index + 1}. Button: ${commandName(entry)}`);
      // The name of a command may be in any language.
      row.nameEl.setAttr('dir', 'auto');
      row.setDesc(
        there
          ? 'Runs this command. Give it a short label, an icon, or both.'
          : 'This command is not available right now (its plugin may be switched off). The button stays in the bar, dimmed, and does nothing.',
      );
      row.addText((text) => {
        text
          .setPlaceholder('Label')
          .setValue(entry.label)
          // Typing must not draw the rows again: the field would lose the keyboard.
          .onChange((value) => change(editBarButton(prefs.layout, index, { label: value }), false));
        text.inputEl.setAttr('dir', 'auto');
        text.inputEl.setAttr('aria-label', 'Label of the button');
      });
      row.addButton((button) => {
        button.setButtonText(entry.icon === null ? 'Icon: none' : `Icon: ${entry.icon}`).onClick((event) => {
          const menu = new Menu();
          menu.addItem((item) => {
            item
              .setTitle('No icon')
              .setChecked(entry.icon === null)
              .onClick(() => change(editBarButton(prefs.layout, index, { icon: null })));
          });
          menu.addSeparator();
          for (const icon of BAR_BUTTON_ICONS) {
            menu.addItem((item) => {
              item
                .setTitle(icon)
                .setIcon(icon)
                .setChecked(entry.icon === icon)
                .onClick(() => change(editBarButton(prefs.layout, index, { icon })));
            });
          }
          showMenu(menu, event);
        });
      });
    }
    orderButtons(row, index, count);
  };

  function draw(): void {
    if (gone) return;
    host.empty();
    const body = host.createDiv({ cls: 'spellbook-bar-settings-body' });
    const layout = prefs.layout;
    const count = layout.entries.length;

    new Setting(body)
      .setName('Bottom bar')
      .setDesc(
        'Choose what the bar at the bottom of the window shows for the open scene, and in what order. ' +
          'On a phone, which has no bottom bar, the same figures stand at the top of the inspector. ' +
          'This layout is kept on this device only.',
      )
      .setHeading();

    const presets = new Setting(body)
      .setName('Ready-made bars')
      .setDesc(`${BAR_PRESETS.map((preset) => `${preset.name}: ${preset.description}`).join(' ')} Your shortcut buttons are kept.`);
    for (const preset of BAR_PRESETS) {
      presets.addButton((button) => {
        button.setButtonText(preset.name).onClick(() => change(applyPreset(prefs.layout, preset)));
      });
    }

    new Setting(body)
      .setName('Reset to default')
      .setDesc('Put the bar back as it was at the start: scene words, date started, date last edited, session, project and today. Shortcut buttons are removed.')
      .addButton((button) => {
        button
          .setButtonText('Reset')
          .setDisabled(prefs.isDefault)
          .onClick(() => change(DEFAULT_BAR_LAYOUT));
      });

    const list = body.createDiv({ cls: 'spellbook-bar-settings-list' });
    if (count === 0) {
      new Setting(list).setName('The bar is empty').setDesc('Add a figure or a button below, or choose a ready-made bar above.');
    }
    layout.entries.forEach((entry, index) => entryRow(list, entry, index, count));

    const missing = missingBarItems(layout);
    const full = count >= MAX_BAR_ENTRIES;
    new Setting(body)
      .setName('Add to the bar')
      .setDesc('A figure shows something about the open scene or the project. A button runs a command of your choice, for example one that switches a writing mode on and off.')
      .addButton((button) => {
        button
          .setButtonText('Add figure')
          .setDisabled(missing.length === 0 || full)
          .onClick((event) => {
            const menu = new Menu();
            for (const item of missingBarItems(prefs.layout)) {
              menu.addItem((entry) => {
                entry.setTitle(item.name).onClick(() => change(addBarItem(prefs.layout, item.id)));
              });
            }
            showMenu(menu, event);
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Add button')
          .setDisabled(full)
          .onClick(() => {
            picker?.close();
            picker = new CommandPicker(app, (command) => change(addBarButton(prefs.layout, command.id)));
            picker.open();
          });
      });
  }

  draw();
  return () => {
    gone = true;
    picker?.close();
    picker = null;
    host.empty();
  };
}
