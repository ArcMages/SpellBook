// The idea boards engine: free-form boards for loose ideas, kept as Obsidian
// Canvas files in a project's Boards folder.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   canvas.ts   a board's file: reading it, writing a new one, turning text
//               cards into file cards, ids
//   layout.ts   circles, a force layout, a packed web, rows
//   drawn.ts    the boards drawn for the writer: relationship map, chapter
//               as cards, around one entity
//   cards.ts    what a text card becomes: its title and the rest
//   services.ts what the World browser is offered, and under which name

/**
 * The folder a project's boards live in. It is not part of a new project: it
 * is made when the first board is.
 */
export const BOARDS_FOLDER = 'Boards';

export {
  BOARD_EXTENSION,
  EMPTY_BOARD_TEXT,
  boardId,
  boardProblems,
  countCards,
  readBoard,
  swapCards,
  textCards,
  writeBoard,
} from './canvas';
export type { BoardColor, BoardReading, BoardSide, CardPlace, CardSwap, NewBoard, NewCard, NewEdge, ReadCard, ReadEdge, SwapResult } from './canvas';

export { LABEL_HEIGHT, circle, force, labelWidth, ringRadius, roomForLabels, rows, spread, toCorner, web } from './layout';
export type { ForceOptions, LabelledEdge, Point, Size } from './layout';

export { CARDS_PER_ROW, CARD_GAP, ENTITY_CARD, GROUP_PADDING, MAP_GAP, SCENE_CARD, boardColor, chapterCards, entityWeb, relationMap } from './drawn';
export type { EntityWeb, MapEntity, MapRelation, SceneGroup, WebEntity } from './drawn';

export { TITLE_MAX, cardNoteName, choiceKey, choiceOf, oneLine, splitCardText } from './cards';
export type { CardChoice, CardText } from './cards';

export { ENTITY_BOARD_SERVICE } from './services';
export type { EntityBoardService } from './services';
