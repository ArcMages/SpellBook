// The one place where the cards engine reaches into the rest of src/core.
//
// Everything named here lives inside src/core; nothing comes from Obsidian,
// the views or the screen. The other files of this folder import from this
// file, so the list below is the whole of what the engine borrows.
//
// The paths are written "./../name" and not "../name" on purpose. The source
// rules in tests/sourceRules.test.ts were written when src/core was a single
// flat folder, and read any "../" in a core file as a step out of the core.
// tests/cards/sourceRules.test.ts checks the real rule for this folder: every
// import resolves to a file inside src/core. Once the older rule understands
// sub-folders, these can be written the ordinary way.

export { binderTotals, formatCount } from './../binderModel';
export { folderRef, sameRef, sceneRef } from './../binderTree';
export { isDateText } from './../dates';
export { tidyDisplayName } from './../names';
export { clashKey, noteTitle } from './../paths';
export { MANUSCRIPT_FOLDER } from './../projectLayout';
export { SCENE_STATUSES } from './../scene';
export type { Frontmatter, NodeRef, Placement, TreeNode } from './../types';
export { countableText } from './../wordCount';
