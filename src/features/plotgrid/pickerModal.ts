// The window that picks the entities of the World the plot grid follows, one
// column each. Every entity is a row that a tap ticks or unticks, grouped
// under its type; the choice is kept on this device, for this project, as
// soon as it is made. A new pick becomes the last column.

import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import { CARD_COLORS } from '../../core/cards';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { PickableEntity, PlotGridHost } from './host';

export const PICKER_TITLE = 'Choose entities';
export const PICKER_HINT = 'Each entity you tick becomes a column of the plot grid.';
export const NO_ENTITIES_TEXT = 'The World has no entities yet. Add characters, places and more in the World browser.';
export const DONE_TEXT = 'Done';

export class EntityPickerModal extends Modal {
  private readonly host: PlotGridHost;

  constructor(app: App, host: PlotGridHost) {
    super(app);
    this.host = host;
  }

  override onOpen(): void {
    this.titleEl.setText(PICKER_TITLE);
    this.modalEl.addClass('spellbook-plotgrid-picker');
    this.draw();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private draw(): void {
    const content = this.contentEl;
    content.empty();
    const entities = this.host.pickableEntities();
    if (entities.length === 0) {
      content.createDiv({ cls: 'spellbook-plotgrid-picker-empty', text: NO_ENTITIES_TEXT });
    } else {
      content.createDiv({ cls: 'spellbook-plotgrid-picker-hint', text: PICKER_HINT });
      const list = content.createDiv({ cls: 'spellbook-plotgrid-picker-list' });
      let group = '';
      for (const entity of entities) {
        if (entity.typeName !== group) {
          group = entity.typeName;
          list.createDiv({ cls: 'spellbook-plotgrid-picker-group', text: group, attr: { dir: 'auto' } });
        }
        this.drawRow(list, entity);
      }
    }
    const buttons = content.createDiv({ cls: 'spellbook-plotgrid-picker-buttons' });
    const done = buttons.createEl('button', { cls: 'mod-cta', text: DONE_TEXT, attr: { type: 'button' } });
    done.addEventListener('click', () => {
      this.close();
    });
  }

  private drawRow(list: HTMLElement, entity: PickableEntity): void {
    const chosen = this.host.chosen.includes(entity.path);
    const row = list.createDiv({
      cls: 'spellbook-plotgrid-pick',
      attr: { role: 'checkbox', tabindex: 0, 'aria-checked': chosen ? 'true' : 'false' },
    });
    row.toggleClass('is-chosen', chosen);
    const box = row.createSpan({ cls: 'spellbook-plotgrid-pick-box' });
    if (chosen) showIcon(box, 'check');
    const dot = row.createSpan({ cls: 'spellbook-plotgrid-head-dot' });
    for (const color of CARD_COLORS) dot.toggleClass(`spellbook-plotgrid-color-${color}`, color === entity.color);
    dot.toggleClass('spellbook-plotgrid-no-color', entity.color === null);
    if (entity.icon !== null) showIcon(dot, entity.icon);
    row.createSpan({ cls: 'spellbook-plotgrid-pick-name', text: entity.name, attr: { dir: 'auto' } });
    const flip = (): void => {
      safely(entity.name, () => {
        const now = this.host.chosen;
        this.host.setChosen(now.includes(entity.path) ? now.filter((path) => path !== entity.path) : [...now, entity.path]);
        this.draw();
      });
    };
    row.addEventListener('click', flip);
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      flip();
    });
  }
}

export function openEntityPicker(app: App, host: PlotGridHost): EntityPickerModal {
  const modal = new EntityPickerModal(app, host);
  modal.open();
  return modal;
}
