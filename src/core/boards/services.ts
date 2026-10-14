// What the idea boards offer the other screens of the plugin, and under
// which name.
//
// The World browser's sheet has a button that draws a board around the
// entity it shows. It does not know the boards: it looks this service up by
// name at the moment it draws the sheet (see FeatureServices in
// src/features/registry.ts) and shows the button only when it is there.

/** The name the service is offered under. */
export const ENTITY_BOARD_SERVICE = 'boards.entityWeb';

/** Draws a board around one entity. */
export interface EntityBoardService {
  /**
   * Draw a new board with the entity in the middle, the entities it has to
   * do with round it, and its scenes and events beside it, and open it.
   *
   * @param entityPath the entity's note, relative to the project folder
   */
  draw(entityPath: string): void;
}
