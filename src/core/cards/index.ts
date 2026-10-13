// The cards engine: everything the corkboard and the inspector are built on.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out. Whoever owns
// the files stores what these functions hand back.
//
//   statuses and labels   readTagLists, addTag, renameTag, recolourTag, moveTag, removeTag
//   one index card        buildSceneCard, derivePreview
//   the corkboard         buildBoard, moveEarlier, moveLater, dropAt, gridLayout
//   the inspector         buildInspector, inspectorPatch
//
// All paths are relative to the project folder, as in the project snapshot.

// ------------------------------------------------------------------- colours

/** The eight colour names a status or label can have, in the order a colour picker shows them. */
export { CARD_COLORS } from './colors';
/** One of the eight colour names: red, orange, yellow, green, cyan, blue, purple, pink. */
export type { CardColor } from './colors';
/** True when a value is exactly one of the eight colour names. */
export { isCardColor } from './colors';
/** The name of Obsidian's CSS variable for a colour ("--color-red", or "--color-red-rgb" for a tint). */
export { colorVariable } from './colors';

// ---------------------------------------------------------- property patches

/** A change to a note's properties: keys to set and keys to remove. Other keys are never touched. */
export type { FrontmatterPatch } from './patch';
/** One scene (by path) together with the patch its properties need. */
export type { ScenePatch } from './patch';
/** A scene's path and its current properties: what the helpers that look across scenes take. */
export type { SceneProperties } from './patch';
/** True when a patch changes nothing, so no write is needed. */
export { isEmptyPatch } from './patch';
/** Apply a patch to a properties object in place; returns true when something really changed. */
export { applyFrontmatterPatch } from './patch';

// ------------------------------------------------------- statuses and labels

/** Which list is meant: 'status' or 'label'. */
export type { TagKind } from './tags';
/** One status or label: a name and a colour (or null for no colour). */
export type { Tag } from './tags';
/** One stored entry of a list, kept so that it can be written back exactly. Screens do not need it. */
export type { TagEntry } from './tags';
/** A project's statuses or labels as read from the index; `tags` is the list to show. */
export type { TagList } from './tags';
/** The result of changing a list: the new value to store in the index, or why it was refused. */
export type { TagEditResult } from './tags';
/** Why a change to a list was refused (empty name, duplicate, not found, unchanged, invalid colour, invalid position, unreadable). */
export type { TagRefusal } from './tags';
/** A status or label that scenes use but the list does not have, with the scenes that use it. */
export type { UnlistedTag } from './tags';
/** The index key each list is stored under: "statuses" and "labels". */
export { TAG_INDEX_KEYS } from './tags';
/** The four built-in statuses with their colours, used when the index has no "statuses" key. */
export { DEFAULT_STATUSES } from './tags';
/** Read one list from the value stored in the index. Never throws; reports what it could not read. */
export { parseTagList } from './tags';
/** Read both lists from the project index's properties (or from its extra keys). */
export { readTagLists } from './tags';
/** Find a status or label by name, without regard to capitals; null when the list has none. */
export { findTag } from './tags';
/** True when two names are the same status or label (capitals and extra spaces do not count). */
export { sameTagName } from './tags';
/** The status a new scene should start with: the first in the list. */
export { defaultStatusName } from './tags';
/** Add a status or label at the end of its list. */
export { addTag } from './tags';
/** Rename a status or label; also returns the patch for every scene that uses the old name. */
export { renameTag } from './tags';
/** The patch one scene needs for a rename, worked out from its properties as they are now. */
export { renameTagInScene } from './tags';
/** Give a status or label another colour, or none. */
export { recolourTag } from './tags';
/** Move a status or label to another place in its list. */
export { moveTag } from './tags';
/** Take a status or label off its list. Scenes that use it keep the name, without a colour. */
export { removeTag } from './tags';
/** The names scenes use that are not in the list, so the screen can offer to add them. */
export { unlistedTags } from './tags';
/** The scenes that use a given status or label. */
export { scenesUsingTag } from './tags';

// ---------------------------------------------------------- scene properties

/** What the engine reads from a scene's properties, with odd values replaced by sensible ones. */
export type { SceneFields } from './sceneFields';
/** Read a scene's properties. Never throws; reports what it could not understand. */
export { readSceneFields } from './sceneFields';
/** True when a scene has its own synopsis, so its text is not needed to make a card. */
export { hasSynopsis } from './sceneFields';
/** A YYYY-MM-DD date as the inspector shows it: "13 Oct 2026". */
export { formatDisplayDate } from './sceneFields';
/** The largest word target a scene can be given. */
export { MAX_TARGET } from './sceneFields';

// ------------------------------------------------------------------ the card

/** About how many characters of a scene's text make up a derived synopsis (200). */
export { PREVIEW_LENGTH } from './preview';
/** Make a synopsis from the opening prose of a note, cut at a word boundary with an ellipsis. */
export { derivePreview } from './preview';
/** A scene's status or label as a card shows it: name, colour, and whether the list has it. */
export type { CardTag } from './card';
/** How far a scene is toward its word target. */
export type { TargetProgress } from './card';
/** What is known about a scene when its card is made: path, properties, text, words, missing. */
export type { SceneCardInput } from './card';
/** The project's statuses and labels, as handed to the card, board and inspector builders. */
export type { CardLists } from './card';
/** One scene as an index card. */
export type { SceneCard } from './card';
/** Build the index card for one scene. */
export { buildSceneCard } from './card';
/** Progress toward a word target; null when there is no target or the words are not known. */
export { targetProgress } from './card';

// ----------------------------------------------------------------- the board

/** Which part of the binder a board shows: the whole manuscript, or one folder by id. */
export type { BoardScope } from './board';
/** What is known about one scene when a board is built: properties, text, words. */
export type { SceneData } from './board';
/** Looks up a scene's data by its path relative to the project folder. */
export type { SceneLookup } from './board';
/** A binder folder as one card: name, number of scenes inside, their words, and the scope it opens. */
export type { FolderCard } from './board';
/** One card on the board: a scene card or a folder card. */
export type { BoardCard } from './board';
/** One step of the trail from the manuscript to the board being shown. */
export type { Crumb } from './board';
/** Everything a corkboard shows: the cards in order, the breadcrumb, and the totals. */
export type { Board } from './board';
/** What a board is built from: the tree, the scope, the scene lookup and the lists. */
export type { BoardInput } from './board';
/** The scope of the top-level board: the whole manuscript. */
export { MANUSCRIPT_SCOPE } from './board';
/** The scope that shows one binder folder. */
export { folderScope } from './board';
/** True when two scopes show the same board. */
export { sameScope } from './board';
/** Build the ordered cards and the breadcrumb for a scope. */
export { buildBoard } from './board';

// -------------------------------------------------------------- moving cards

/** A move for the project store: the node and the placement to pass to `moveNode`. */
export type { CardMove } from './moves';
/** The binder node a card stands for: a scene by path, a folder by id. */
export { cardRef } from './moves';
/** Where a card is on the board, counting from 0; -1 when it is not on it. */
export { cardIndex } from './moves';
/** The move that puts a card one place earlier; null when it is already first. */
export { moveEarlier } from './moves';
/** The move that puts a card one place later; null when it is already last. */
export { moveLater } from './moves';
/** The move for a card dropped into a gap between cards; null when that changes nothing or the gap is not a number. */
export { dropAt } from './moves';
/** The move for a scene's card dropped onto a folder's card: into that folder, at its end; null for anything else. */
export { dropInto } from './moves';

// ------------------------------------------------------------------ the grid

/** A card size: 'small', 'medium' or 'large'. */
export type { CardSize } from './grid';
/** The columns, card width and gap for one board width. */
export type { GridLayout } from './grid';
/** The three card sizes, smallest first. */
export { CARD_SIZES } from './grid';
/** The size cards have until the writer chooses another: medium. */
export { DEFAULT_CARD_SIZE } from './grid';
/** The narrowest a card of each size may be, in CSS pixels (160, 220, 300). */
export { CARD_MIN_WIDTH } from './grid';
/** The space between cards, in CSS pixels. */
export { CARD_GAP } from './grid';
/** Read a stored card size; anything unknown gives the default. */
export { readCardSize } from './grid';
/** The number of columns and the card width for a board of a given width. */
export { gridLayout } from './grid';

// ------------------------------------------------------------- the inspector

/** The fields of the inspector that can be edited: synopsis, status, label, target, compile. */
export type { InspectorField } from './inspector';
/** One choice in the inspector's status or label picker. */
export type { TagOption } from './inspector';
/** What the inspector shows for the open scene. */
export type { InspectorModel } from './inspector';
/** Edits made in the inspector; name only the fields the writer changed. */
export type { InspectorEdits } from './inspector';
/** Why one edit was not accepted, with a sentence to show beside the field. */
export type { InspectorError } from './inspector';
/** The outcome of checking edits: the smallest patch, or the list of errors. */
export type { InspectorResult } from './inspector';
/** Build what the inspector shows for a scene. */
export { buildInspector } from './inspector';
/** Check edits and work out the smallest patch to the scene's properties. */
export { inspectorPatch } from './inspector';
/** Read a word target typed into a box: a whole number, or nothing for no target. */
export { parseTargetInput } from './inspector';
