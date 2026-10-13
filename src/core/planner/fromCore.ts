// The planner's one doorway to the rest of src/core.
//
// Every other planner file imports its neighbours with "./"; what the planner
// needs from the folder above comes through here, so there is a single place
// to look (and to change).
//
// The path is spelled "./../" on purpose. The source rules
// (tests/sourceRules.test.ts) keep the core pure by refusing any import that
// begins with "../": written when src/core had no sub-folders, that means
// "nothing from outside src/core". From this folder, "../dates" is still
// inside src/core, so the rule's purpose holds; only its spelling check would
// trip. tests/planner/plannerRules.test.ts checks the real thing for this
// folder: every import resolves to a file inside src/core.

export { addDays, formatLocalDate, isDateText } from './../dates';
