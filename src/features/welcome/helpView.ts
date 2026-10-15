// The Help pane: the tutorial's steps in short, every Spellbook command with
// what it does, and the addresses of the guide and the tutorial online, as
// text to copy. The list of commands is made from the commands the plugin
// registered, so it is always complete.

import { ItemView, Platform } from 'obsidian';
import { followLayout } from '../../ui/layout';
import type { WorkspaceLeaf } from 'obsidian';
import type { CommandHelp, TutorialStep } from '../../core/welcome/index';
import { iconName } from '../../ui/icons';
import {
  ADDRESS_TEXT,
  ADDRESS_TITLE,
  COMMANDS_TEXT_INTRO,
  COMMANDS_TITLE,
  COPIED_TEXT,
  COPY_BUTTON,
  GUIDE_ADDRESS,
  GUIDE_LABEL,
  HELP_ICON,
  HELP_TITLE,
  HELP_VIEW_NAME,
  HELP_VIEW_TYPE,
  NOT_COPIED_TEXT,
  NO_COMMANDS_TEXT,
  STEPS_TEXT,
  STEPS_TITLE,
  STEP_HINTS,
  TUTORIAL_ADDRESS,
  TUTORIAL_LABEL,
  WELCOME_PAGE_BUTTON,
} from './texts';

/** What the pane needs. */
export interface HelpHost {
  /** Every command, with what it does; null while the plugin is still starting. */
  commands(): CommandHelp[] | null;
  steps(): TutorialStep[];
  openWelcome(): void;
  /** Put text on the clipboard. Resolves false when it could not. */
  copy(text: string): Promise<boolean>;
}

export class HelpView extends ItemView {
  private readonly host: HelpHost;
  private closed = true;

  constructor(leaf: WorkspaceLeaf, host: HelpHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
  }

  override getViewType(): string {
    return HELP_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return HELP_VIEW_NAME;
  }

  override getIcon(): string {
    return iconName('circle-help', HELP_ICON) ?? HELP_ICON;
  }

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-help-pane');
    const root = pane.createDiv({ cls: 'spellbook-help' });
    followLayout(this, root);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);

    root.createEl('h1', { cls: 'spellbook-help-title', text: HELP_TITLE });
    const welcome = root.createEl('button', { cls: 'spellbook-help-welcome', text: WELCOME_PAGE_BUTTON, attr: { type: 'button' } });
    welcome.addEventListener('click', () => {
      this.host.openWelcome();
    });

    root.createEl('h2', { cls: 'spellbook-help-heading', text: STEPS_TITLE });
    root.createEl('p', { cls: 'spellbook-help-note', text: STEPS_TEXT });
    const steps = root.createEl('ol', { cls: 'spellbook-help-steps' });
    for (const step of this.host.steps()) {
      const item = steps.createEl('li', { cls: 'spellbook-help-step', attr: { value: step.number } });
      item.createSpan({ cls: 'spellbook-help-step-title', text: step.title });
      const hint = STEP_HINTS[step.title];
      if (hint !== undefined) item.createSpan({ cls: 'spellbook-help-step-text', text: hint });
    }

    root.createEl('h2', { cls: 'spellbook-help-heading', text: COMMANDS_TITLE });
    root.createEl('p', { cls: 'spellbook-help-note', text: COMMANDS_TEXT_INTRO });
    const commands = this.host.commands();
    if (commands === null) {
      root.createEl('p', { cls: 'spellbook-help-note', text: NO_COMMANDS_TEXT });
    } else {
      const list = root.createEl('ul', { cls: 'spellbook-help-commands' });
      for (const command of commands) {
        const item = list.createEl('li', { cls: 'spellbook-help-command', attr: { 'data-command': command.id } });
        item.createSpan({ cls: 'spellbook-help-command-name', text: `Spellbook: ${command.name}` });
        if (command.description !== null) item.createSpan({ cls: 'spellbook-help-command-text', text: command.description });
      }
    }

    root.createEl('h2', { cls: 'spellbook-help-heading', text: ADDRESS_TITLE });
    root.createEl('p', { cls: 'spellbook-help-note', text: ADDRESS_TEXT });
    this.addressRow(root, GUIDE_LABEL, GUIDE_ADDRESS);
    this.addressRow(root, TUTORIAL_LABEL, TUTORIAL_ADDRESS);
  }

  /** An address as text the writer can select, with a button that copies it. Nothing is opened. */
  private addressRow(parent: HTMLElement, label: string, address: string): void {
    const row = parent.createDiv({ cls: 'spellbook-help-address' });
    row.createSpan({ cls: 'spellbook-help-address-label', text: label });
    const field = row.createEl('input', {
      cls: 'spellbook-help-address-text',
      attr: { type: 'text', readonly: 'true', 'aria-label': `${label} address`, dir: 'ltr', spellcheck: 'false' },
    });
    field.value = address;
    field.addEventListener('focus', () => {
      field.select();
    });
    const button = row.createEl('button', { cls: 'spellbook-help-copy', text: COPY_BUTTON, attr: { type: 'button' } });
    const status = row.createSpan({ cls: 'spellbook-help-copy-status', attr: { 'aria-live': 'polite' } });
    button.addEventListener('click', () => {
      void this.host.copy(address).then((copied) => {
        if (this.closed) return;
        status.setText(copied ? COPIED_TEXT : NOT_COPIED_TEXT);
        if (!copied) field.select();
      });
    });
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    this.contentEl.empty();
  }
}
