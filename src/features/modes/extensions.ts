// What the writing modes put into every editor: built anew, as a list, each
// time a mode is switched or a setting is changed. A mode that is off adds
// nothing, so switching everything off leaves the editors exactly as
// Obsidian made them.

import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { SHADE_OPACITY } from '../../core/modes/index';
import type { ModeSet, ModeSettings } from '../../core/modes/index';
import type { FeatureClock } from '../registry';
import { EditorFrame } from './editorFrame';
import type { FrameOptions } from './editorFrame';
import { hemingwayGuard } from './hemingwayGuard';
import type { BlockedReport } from './hemingwayGuard';

export interface ExtensionNeeds {
  readonly clock: FeatureClock;
  /** An iPhone or iPad. */
  readonly ios: boolean;
  /** Told when Hemingway refused something. */
  readonly blocked: BlockedReport;
}

/** Letter box and Typewriter: one frame for each editor (see editorFrame.ts). */
function frameExtension(options: FrameOptions, clock: FeatureClock): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      readonly frame: EditorFrame;

      constructor(view: EditorView) {
        this.frame = new EditorFrame(view, options, clock);
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet) return;
        const { transactions } = update;
        this.frame.changed({
          docChanged: update.docChanged,
          edit: transactions.some((transaction) => transaction.docChanged && (transaction.isUserEvent('input') || transaction.isUserEvent('delete'))),
          pointer: transactions.some((transaction) => transaction.isUserEvent('select.pointer')),
        });
      }

      destroy(): void {
        this.frame.release();
      }
    },
  );
  // When the editor brings the caret into view by itself, it keeps it clear of the covers.
  return [plugin, EditorView.scrollMargins.of((view) => view.plugin(plugin)?.frame.margins ?? null)];
}

/** The extensions for the modes that are on. Zen needs none: it changes nothing in an editor. */
export function modeExtensions(modes: ModeSet, settings: ModeSettings, needs: ExtensionNeeds): Extension[] {
  const extensions: Extension[] = [];
  if (modes.hemingway) extensions.push(hemingwayGuard(needs.blocked));
  if (modes['letter-box'] || modes.typewriter) {
    extensions.push(
      frameExtension(
        {
          letterBox: modes['letter-box'],
          typewriter: modes.typewriter,
          bandPercent: settings.bandPercent,
          anchorPercent: settings.anchorPercent,
          coverOpacity: SHADE_OPACITY[settings.bandShade],
          ios: needs.ios,
        },
        needs.clock,
      ),
    );
  }
  return extensions;
}
