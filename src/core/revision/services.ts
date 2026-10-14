// What the revision tools offer the other screens of the plugin, and under
// which name.
//
// The World browser has "Rename everywhere" in the menu of an entity. It does
// not know the revision tools: it looks this service up by name at the
// moment the menu is opened (see FeatureServices in src/features/registry.ts)
// and shows the item only when it is there.

/** The name the service is offered under. */
export const RENAME_EVERYWHERE_SERVICE = 'revision.renameEverywhere';

/** Opens the "Rename everywhere" window for an entity. */
export interface RenameEverywhereService {
  /**
   * Open the window that renames an entity and its name in the manuscript.
   *
   * @param entityPath the entity's note, relative to the project folder
   */
  open(entityPath: string): void;
}
