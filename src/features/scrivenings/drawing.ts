// The three things the continuous manuscript asks of Obsidian itself, each
// through the public API only:
//   - drawing a scene's text as formatted text (MarkdownRenderer), the way
//     Obsidian's own reading view draws it;
//   - putting the cursor on a line of the note that was just opened;
//   - following a link to another note.
//
// When the formatted drawing is not to be had, or fails on a scene, the text
// is shown as plain paragraphs instead: the scene can always be read.

import { Component, MarkdownRenderer, MarkdownView } from 'obsidian';
import type { App, PaneType } from 'obsidian';
import { pathKey } from '../../core/paths';
import { plainParagraphs } from '../../core/scrivenings';

/** Takes away whatever drawing a scene set up (embedded notes, pictures that were loading). */
export type Undraw = () => void;

export interface SceneDrawer {
  /**
   * Draw a scene's text into an empty element.
   *
   * @param body       the scene's text, without its properties block
   * @param sourcePath the scene's vault path, so that links and pictures in it are found
   */
  draw(body: string, el: HTMLElement, sourcePath: string): Promise<Undraw>;
}

/** Class of a paragraph drawn as plain text. */
export const PLAIN_CLASS = 'spellbook-scrivenings-plain';

/** Show a text as plain paragraphs, each taking the direction of its own words. */
export function drawPlain(body: string, el: HTMLElement): void {
  for (const paragraph of plainParagraphs(body)) {
    el.createEl('p', { cls: PLAIN_CLASS, text: paragraph, attr: { dir: 'auto' } });
  }
}

/**
 * Let every paragraph, heading and list choose its own direction, so that a
 * Hebrew paragraph reads right to left next to an English one. Code keeps the
 * direction it has.
 */
function markDirections(el: HTMLElement): void {
  for (const child of Array.from(el.children) as HTMLElement[]) {
    if (child.tagName === 'PRE' || child.getAttr('dir') !== null) continue;
    child.setAttr('dir', 'auto');
  }
}

/** Whether this Obsidian can draw formatted text for a plugin. */
function canDraw(): boolean {
  return typeof MarkdownRenderer === 'function' && typeof MarkdownRenderer.render === 'function' && typeof Component === 'function';
}

/** Draws scenes with Obsidian's own renderer. */
export function obsidianDrawer(app: App): SceneDrawer {
  return {
    async draw(body, el, sourcePath) {
      if (canDraw()) {
        const component = new Component();
        component.load();
        try {
          await MarkdownRenderer.render(app, body, el, sourcePath, component);
          markDirections(el);
          return () => {
            component.unload();
          };
        } catch (error) {
          console.error('Spellbook: a scene could not be drawn as formatted text; it is shown as plain text', error);
          component.unload();
          el.empty();
        }
      }
      drawPlain(body, el);
      return () => undefined;
    },
  };
}

/**
 * Put the cursor on a line of the note that is in front, if that note is the
 * one meant, and bring the line into view.
 *
 * @param line the line of the note, counted from 0
 */
export function showLine(app: App, vaultPath: string, line: number): void {
  if (typeof MarkdownView !== 'function') return;
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!view || !file || pathKey(file.path) !== pathKey(vaultPath)) return;
  try {
    view.editor.setCursor({ line, ch: 0 });
    // Obsidian's own way of arriving at a line: it scrolls there, in the editor and in the reading view alike.
    view.setEphemeralState({ line });
  } catch (error) {
    // The note is open all the same, at its top.
    console.error('Spellbook: the cursor could not be put where the scene was tapped', error);
  }
}

/** Open what a link in a scene points at, as Obsidian itself would. */
export async function followLink(app: App, link: string, sourcePath: string, where: PaneType | boolean): Promise<void> {
  await app.workspace.openLinkText(link, sourcePath, where);
}
