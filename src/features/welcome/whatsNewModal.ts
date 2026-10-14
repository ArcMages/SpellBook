// The short "What is new" note: the changelog's notes of the versions since
// the one this device last ran. The text is bundled in the plugin.

import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { ChangelogEntry } from '../../core/welcome/index';
import { CLOSE_BUTTON, NOTHING_NEW_TEXT, WHATS_NEW_FOOT, WHATS_NEW_SEVERAL_TITLE, whatsNewTitle } from './texts';

export class WhatsNewModal extends Modal {
  private readonly entries: readonly ChangelogEntry[];
  private readonly current: string;

  constructor(app: App, entries: readonly ChangelogEntry[], current: string) {
    super(app);
    this.entries = entries;
    this.current = current;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('spellbook-whats-new');
    const only = this.entries.length === 1 ? this.entries[0] : undefined;
    this.titleEl.setText(only ? whatsNewTitle(only.version) : this.entries.length === 0 ? whatsNewTitle(this.current) : WHATS_NEW_SEVERAL_TITLE);

    if (this.entries.length === 0) contentEl.createEl('p', { cls: 'spellbook-whats-new-text', text: NOTHING_NEW_TEXT });
    for (const entry of this.entries) {
      const section = contentEl.createDiv({ cls: 'spellbook-whats-new-version' });
      if (!only) section.createEl('h3', { cls: 'spellbook-whats-new-heading', text: entry.version });
      if (entry.date !== null) section.createDiv({ cls: 'spellbook-whats-new-date', text: entry.date });
      for (const block of entry.blocks) {
        if (block.kind === 'heading') section.createEl('h4', { cls: 'spellbook-whats-new-subheading', text: block.text });
        else if (block.kind === 'paragraph') section.createEl('p', { cls: 'spellbook-whats-new-text', text: block.text });
        else {
          const list = section.createEl('ul', { cls: 'spellbook-whats-new-list' });
          for (const item of block.items) list.createEl('li', { text: item });
        }
      }
    }
    contentEl.createEl('p', { cls: 'spellbook-whats-new-foot', text: WHATS_NEW_FOOT });
    new Setting(contentEl).addButton((button) => {
      button
        .setButtonText(CLOSE_BUTTON)
        .setCta()
        .onClick(() => {
          this.close();
        });
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
