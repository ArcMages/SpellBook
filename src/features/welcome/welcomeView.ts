// The welcome page: what Spellbook is, three ways to begin, and where the
// main screens are. It opens by itself once, the first time Spellbook runs on
// a device whose vault has no project (see index.ts), and with the command
// "Open welcome page" whenever the writer wants it.

import { ItemView, Platform } from 'obsidian';
import { followLayout } from '../../ui/layout';
import type { WorkspaceLeaf } from 'obsidian';
import { showIcon } from '../../ui/icons';
import {
  CHOICES,
  HELP_BUTTON,
  PLACES,
  PLACES_TEXT,
  PLACES_TITLE,
  TOUR_BUTTON,
  WELCOME_AGAIN_TEXT,
  WELCOME_ICON,
  WELCOME_TEXT,
  WELCOME_TITLE,
  WELCOME_VIEW_NAME,
  WELCOME_VIEW_TYPE,
} from './texts';
import type { Choice } from './texts';

/** What the page's buttons do. */
export interface WelcomeHost {
  choose(choice: Choice['id']): void;
  startTour(): void;
  openHelp(): void;
}

export class WelcomeView extends ItemView {
  private readonly host: WelcomeHost;

  constructor(leaf: WorkspaceLeaf, host: WelcomeHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
  }

  override getViewType(): string {
    return WELCOME_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return WELCOME_VIEW_NAME;
  }

  override getIcon(): string {
    return WELCOME_ICON;
  }

  protected override async onOpen(): Promise<void> {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-welcome-pane');
    const root = pane.createDiv({ cls: 'spellbook-welcome' });
    followLayout(this, root);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);

    root.createEl('h1', { cls: 'spellbook-welcome-title', text: WELCOME_TITLE });
    root.createEl('p', { cls: 'spellbook-welcome-text', text: WELCOME_TEXT });

    const choices = root.createDiv({ cls: 'spellbook-welcome-choices' });
    for (const choice of CHOICES) {
      const button = choices.createEl('button', {
        cls: 'spellbook-welcome-choice',
        attr: { type: 'button', 'data-choice': choice.id },
      });
      const icon = button.createSpan({ cls: 'spellbook-welcome-choice-icon', attr: { 'aria-hidden': 'true' } });
      showIcon(icon, choice.icon, 'book');
      button.createSpan({ cls: 'spellbook-welcome-choice-title', text: choice.title });
      button.createSpan({ cls: 'spellbook-welcome-choice-text', text: choice.text });
      button.addEventListener('click', () => {
        this.host.choose(choice.id);
      });
    }

    const actions = root.createDiv({ cls: 'spellbook-welcome-actions' });
    const tour = actions.createEl('button', { cls: 'spellbook-welcome-action', text: TOUR_BUTTON, attr: { type: 'button', 'data-action': 'tour' } });
    tour.addEventListener('click', () => {
      this.host.startTour();
    });
    const help = actions.createEl('button', { cls: 'spellbook-welcome-action', text: HELP_BUTTON, attr: { type: 'button', 'data-action': 'help' } });
    help.addEventListener('click', () => {
      this.host.openHelp();
    });

    root.createEl('h2', { cls: 'spellbook-welcome-heading', text: PLACES_TITLE });
    root.createEl('p', { cls: 'spellbook-welcome-note', text: PLACES_TEXT });
    const list = root.createEl('ul', { cls: 'spellbook-welcome-places' });
    for (const place of PLACES) {
      const item = list.createEl('li', { cls: 'spellbook-welcome-place' });
      item.createSpan({ cls: 'spellbook-welcome-place-name', text: place.name });
      item.createSpan({ cls: 'spellbook-welcome-place-text', text: place.text });
      item.createSpan({ cls: 'spellbook-welcome-place-command', text: `Spellbook: ${place.commandName}` });
    }
    root.createEl('p', { cls: 'spellbook-welcome-note', text: WELCOME_AGAIN_TEXT });
  }

  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
