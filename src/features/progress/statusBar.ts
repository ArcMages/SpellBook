// The bottom bar: the writer's choice of figures for the open note and of
// shortcut buttons, drawn in an item of Obsidian's status bar (a desktop and
// a tablet have one; a phone does not). A click on a figure opens the targets
// window; a click on a button runs its command.
//
// The bar keeps what it has drawn. When it is shown the same pieces again,
// only the piece whose figure changed is touched: nothing else is redrawn, so
// a button keeps the keyboard's focus and typing never rebuilds the bar.

import { Platform, getIcon, setIcon } from 'obsidian';
import type { StatusSegment } from '../../core/progress/index';

export const STATUS_CLASS = 'spellbook-status';

/** A shortcut button, ready to be drawn. */
export interface BarButton {
  readonly kind: 'button';
  /** A name for this button that no other piece of the bar has. */
  readonly key: string;
  /** The id of the command it runs. */
  readonly command: string;
  /** What it says; "" for none (it then shows its icon, or else the command's name). */
  readonly label: string;
  /** The name of its icon, or null. */
  readonly icon: string | null;
  /** What the command is called, for whoever points at the button or hears it read out. */
  readonly name: string;
  /** Whether there is such a command right now. */
  readonly available: boolean;
}

/** A figure, ready to be drawn. */
export interface BarFigure {
  readonly kind: 'figure';
  readonly segment: StatusSegment;
}

export type BarPiece = BarFigure | BarButton;

/** A piece as it stands in the bar. */
interface Drawn {
  readonly key: string;
  /** Everything that decides which elements the piece is made of. */
  readonly shape: string;
  /** Everything the piece shows. */
  state: string;
  readonly root: HTMLElement;
  readonly value: HTMLElement | null;
  readonly fill: HTMLElement | null;
}

const keyOf = (piece: BarPiece): string => (piece.kind === 'figure' ? `figure:${piece.segment.id}` : piece.key);

/** Whether Obsidian knows an icon by this name. An icon it does not know is never drawn. */
function hasIcon(icon: string | null): icon is string {
  if (icon === null) return false;
  try {
    return getIcon(icon) !== null;
  } catch {
    return false;
  }
}

function shapeOf(piece: BarPiece): string {
  if (piece.kind === 'button') {
    return JSON.stringify(['button', piece.command, piece.label, piece.icon, piece.name, hasIcon(piece.icon)]);
  }
  const { segment } = piece;
  return JSON.stringify(['figure', segment.label, segment.fraction !== undefined, segment.ownText === true, segment.color ?? null]);
}

const stateOf = (piece: BarPiece): string =>
  piece.kind === 'button' ? String(piece.available) : JSON.stringify([piece.segment.value, piece.segment.met, piece.segment.fraction, piece.segment.late]);

/** A fraction as the width of the filled part of the small progress bar. */
const widthOf = (fraction: number | undefined): string => `${Math.round(Math.max(0, Math.min(1, fraction ?? 0)) * 100)}%`;

export class StatusBar {
  private readonly element: HTMLElement;
  private readonly onOpen: () => void;
  private readonly onRun: (command: string) => void;
  private drawn: Drawn[] = [];
  /** What to call to take the listeners off the buttons that are drawn. */
  private buttonStops: Array<() => void> = [];
  /** How many pieces were drawn or changed since the bar was made (for whoever wants to know how much work it did). */
  touched = 0;

  private readonly click = (): void => {
    this.onOpen();
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    // (A key pressed on a button inside the bar never gets here: the button keeps it.)
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.onOpen();
  };

  /**
   * @param element the status bar item Obsidian made for the plugin
   * @param onOpen  called when a figure is clicked (or Enter is pressed on the bar)
   * @param onRun   called with a command's id when its button is pressed
   */
  constructor(element: HTMLElement, onOpen: () => void, onRun: (command: string) => void = () => undefined) {
    this.element = element;
    this.onOpen = onOpen;
    this.onRun = onRun;
    element.addClass(STATUS_CLASS, 'mod-clickable');
    if (Platform.isMobile) element.addClass('spellbook-is-mobile');
    element.setAttr('role', 'button');
    element.setAttr('tabindex', 0);
    element.setAttr('aria-label', 'Writing progress. Click to set writing targets.');
    element.addEventListener('click', this.click);
    element.addEventListener('keydown', this.keydown);
    this.show([]);
  }

  /**
   * Draw the pieces of the bar; with none, the item takes no room. Shown the
   * same pieces as last time, only those whose figure changed are touched.
   *
   * Accepts the bare pieces of the line as well, for a bar without buttons.
   */
  show(pieces: readonly (BarPiece | StatusSegment)[]): void {
    const wanted = pieces.map((piece): BarPiece => ('kind' in piece ? piece : { kind: 'figure', segment: piece }));
    const same =
      wanted.length === this.drawn.length &&
      wanted.every((piece, at) => {
        const before = this.drawn[at];
        return before !== undefined && before.key === keyOf(piece) && before.shape === shapeOf(piece);
      });
    if (same) {
      wanted.forEach((piece, at) => this.update(this.drawn[at] as Drawn, piece));
      return;
    }
    this.rebuild(wanted);
  }

  /** Take the bar away again. */
  remove(): void {
    this.clearButtons();
    this.drawn = [];
    this.element.removeEventListener('click', this.click);
    this.element.removeEventListener('keydown', this.keydown);
    this.element.remove();
  }

  private clearButtons(): void {
    for (const stop of this.buttonStops.splice(0)) stop();
  }

  private rebuild(pieces: readonly BarPiece[]): void {
    const { element } = this;
    this.clearButtons();
    element.empty();
    element.toggleClass('spellbook-is-empty', pieces.length === 0);
    // With buttons of its own inside, the bar is a group of things, not one button.
    element.setAttr('role', pieces.some((piece) => piece.kind === 'button') ? 'group' : 'button');
    this.drawn = pieces.map((piece) => (piece.kind === 'button' ? this.drawButton(piece) : this.drawFigure(piece.segment)));
    this.touched += pieces.length;
  }

  private drawFigure(segment: StatusSegment): Drawn {
    const root = this.element.createSpan({
      cls: ['spellbook-status-segment', `spellbook-status-${segment.id}`],
    });
    if (segment.color !== undefined) root.addClass('spellbook-has-color', `spellbook-status-color-${segment.color}`);
    root.createSpan({ cls: 'spellbook-status-label', text: segment.label });
    let fill: HTMLElement | null = null;
    if (segment.fraction !== undefined) {
      const meter = root.createSpan({ cls: 'spellbook-status-meter', attr: { 'aria-hidden': 'true' } });
      fill = meter.createSpan({ cls: 'spellbook-status-meter-fill' });
      fill.style.width = widthOf(segment.fraction);
    }
    // Figures and dates read left to right, also when Obsidian itself runs
    // right to left. The writer's own text chooses its own direction.
    const value = root.createSpan({
      cls: 'spellbook-status-value',
      text: segment.value,
      attr: { dir: segment.ownText === true ? 'auto' : 'ltr' },
    });
    const piece: BarPiece = { kind: 'figure', segment };
    this.mark(root, segment);
    return { key: keyOf(piece), shape: shapeOf(piece), state: stateOf(piece), root, value, fill };
  }

  private mark(root: HTMLElement, segment: StatusSegment): void {
    root.toggleClass('spellbook-is-met', segment.met === true);
    root.toggleClass('spellbook-is-late', segment.late === true);
  }

  private drawButton(piece: BarButton): Drawn {
    const root = this.element.createSpan({
      cls: 'spellbook-status-button',
      attr: { role: 'button', tabindex: 0 },
    });
    const withIcon = hasIcon(piece.icon);
    if (withIcon) {
      const icon = root.createSpan({ cls: 'spellbook-status-button-icon', attr: { 'aria-hidden': 'true' } });
      setIcon(icon, piece.icon as string);
    }
    // Without an icon the button must say something: its label, or else what the command is called.
    const text = piece.label !== '' ? piece.label : withIcon ? '' : piece.name;
    if (text !== '') root.createSpan({ cls: 'spellbook-status-button-label', text, attr: { dir: 'auto' } });

    const run = (): void => {
      this.onRun(piece.command);
    };
    // Pressing the button must not take the keyboard away from the note.
    const mousedown = (event: MouseEvent): void => {
      event.preventDefault?.();
    };
    const click = (event: MouseEvent): void => {
      // The click is the button's, not the bar's: the targets window stays shut.
      event.stopPropagation?.();
      run();
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault?.();
      event.stopPropagation?.();
      run();
    };
    root.addEventListener('mousedown', mousedown);
    root.addEventListener('click', click);
    root.addEventListener('keydown', keydown);
    this.buttonStops.push(() => {
      root.removeEventListener('mousedown', mousedown);
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', keydown);
    });

    const drawn: Drawn = { key: piece.key, shape: shapeOf(piece), state: '', root, value: null, fill: null };
    this.update(drawn, piece);
    return drawn;
  }

  /** Bring one piece up to date. A piece that shows what it showed is left alone. */
  private update(drawn: Drawn, piece: BarPiece): void {
    const state = stateOf(piece);
    if (drawn.state === state) return;
    drawn.state = state;
    this.touched++;
    if (piece.kind === 'button') {
      const title = piece.label !== '' && piece.label !== piece.name ? `${piece.label}: ${piece.name}` : piece.name;
      drawn.root.toggleClass('spellbook-is-unavailable', !piece.available);
      drawn.root.setAttr('aria-disabled', piece.available ? null : 'true');
      drawn.root.setAttr('aria-label', piece.available ? title : `${title} (this command is not available)`);
      return;
    }
    const { segment } = piece;
    drawn.value?.setText(segment.value);
    if (drawn.fill !== null) drawn.fill.style.width = widthOf(segment.fraction);
    this.mark(drawn.root, segment);
  }
}
