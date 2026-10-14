// The revision tools' engine: notes pinned to passages, finding words in the
// manuscript, changing a scene's text in exact places, and finding a name for
// "Rename everywhere". No screen and no vault.

export { addNoteTo, changeNoteIn, entryOf, findNote, locatePassage, MAX_PASSAGE_LENGTH, passageMarks, propertiesOf, readNote, readNotes, removeNoteFrom, REVISION_NOTES_KEY, sameNote, tidyPassage } from './notes';
export type { PassageMark, PlacedNote, RevisionNote } from './notes';
export { CONTEXT_REACH, contextOf, DEFAULT_SEARCH, findInText, isWholeWord, isWordChar, MAX_MATCHES_PER_TEXT, patternOf } from './search';
export type { MatchContext, SearchOptions, TextMatch } from './search';
export { applyBodyEdits, applyToNote, editsFit, splitBody, withCaseOf } from './edits';
export type { BodyEdit } from './edits';
export { findWithJoined, linkTargets, nameOccurrences, newNameProblem } from './rename';
export type { NameOccurrence } from './rename';
export { RENAME_EVERYWHERE_SERVICE } from './services';
export type { RenameEverywhereService } from './services';
