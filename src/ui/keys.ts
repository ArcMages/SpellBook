// Keyboard helpers shared by the plugin's windows and views.

/**
 * True when a key press belongs to an input method: the helper that turns
 * typed letters into Japanese, Chinese or Korean text. Its keys, such as the
 * Enter that accepts a suggested word, are part of typing and must not be
 * taken as a command.
 *
 * Two checks are needed. Desktop Obsidian marks such keys with `isComposing`.
 * iPhone and iPad do not for the Enter that accepts a word: there the
 * composition has already ended when the key arrives, and the only sign left
 * is the key code 229, which browsers give to keys an input method handled.
 */
export function isInputMethodKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
