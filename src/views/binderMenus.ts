// The menus of the binder's rows: what the "more" button of a row (or a
// right-click on it) offers. Each menu is made for one row of one project, at
// the moment it is asked for, and hands its choices to the binder's actions.

import { Menu } from 'obsidian';
import { canStep } from '../core/binderModel';
import { folderRef, sceneRef } from '../core/binderTree';
import type { NodeRef, ProjectSnapshot } from '../core/types';
import { ACTION_ICONS, iconName } from '../ui/icons';
import { safely } from '../ui/safely';
import type { BinderActions } from './binderActions';

/** What a row's menu is made from. */
export interface MenuContext {
  readonly actions: BinderActions;
  /** The open project, as it was when the menu was asked for. */
  readonly project: ProjectSnapshot;
}

interface ItemOptions {
  readonly disabled?: boolean;
  /** For something that takes a note away: shown in the theme's warning colour. */
  readonly warning?: boolean;
}

function add(
  menu: Menu,
  title: string,
  icons: readonly string[],
  run: () => unknown,
  options: ItemOptions = {},
): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon(iconName(...icons));
    if (options.disabled === true) item.setDisabled(true);
    if (options.warning === true) item.setWarning(true);
    item.onClick(() => {
      safely(title, run);
    });
  });
}

/** "Rename", "Move up", "Move down" and "Move to folder", for a scene or a folder of the binder. */
function addArranging(menu: Menu, { actions, project }: MenuContext, ref: NodeRef): void {
  const at = project.indexPath;
  add(menu, 'Rename', ACTION_ICONS.rename, () => {
    if (ref.kind === 'scene') actions.renameScene(at, ref.path);
    else actions.renameFolder(at, ref.id);
  });
  add(menu, 'Move up', ACTION_ICONS.moveUp, () => actions.step(at, ref, 'up'), {
    disabled: !canStep(project.tree, ref, 'up'),
  });
  add(menu, 'Move down', ACTION_ICONS.moveDown, () => actions.step(at, ref, 'down'), {
    disabled: !canStep(project.tree, ref, 'down'),
  });
  add(menu, 'Move to folder', ACTION_ICONS.moveToFolder, () => {
    actions.moveToFolder(at, ref);
  });
}

/** The menu of a scene whose note exists. `path` is relative to the project folder. */
export function sceneMenu(context: MenuContext, path: string): Menu {
  const { actions, project } = context;
  const at = project.indexPath;
  const ref = sceneRef(path);
  const menu = new Menu();
  add(menu, 'Open in new tab', ACTION_ICONS.openInNewTab, () => actions.openNote(at, path, 'tab'));
  add(menu, 'New scene below', ACTION_ICONS.newScene, () => {
    actions.newScene(at, { at: 'after', sibling: ref });
  });
  menu.addSeparator();
  addArranging(menu, context, ref);
  // Offered when the snapshots are there to take and show them.
  const snapshots = actions.snapshots;
  if (snapshots) {
    menu.addSeparator();
    add(menu, 'Take snapshot', ['camera'], () => {
      snapshots.take(path);
    });
    add(menu, 'Snapshots', ['history'], () => {
      snapshots.show(path);
    });
  }
  menu.addSeparator();
  add(
    menu,
    'Delete scene',
    ACTION_ICONS.deleteScene,
    () => {
      actions.deleteScene(at, path);
    },
    { warning: true },
  );
  return menu;
}

/** The menu of a binder folder. */
export function folderMenu(context: MenuContext, id: string): Menu {
  const { actions, project } = context;
  const at = project.indexPath;
  const menu = new Menu();
  // Offered when the corkboard is there to show the folder on.
  const show = actions.showOnCorkboard;
  if (show) add(menu, 'Show on corkboard', ['layout-grid'], () => show(at, id));
  add(menu, 'New scene inside', ACTION_ICONS.newScene, () => {
    actions.newScene(at, { at: 'end', parentId: id });
  });
  add(menu, 'New folder inside', ACTION_ICONS.newFolder, () => {
    actions.newFolder(at, { at: 'end', parentId: id });
  });
  menu.addSeparator();
  addArranging(menu, context, folderRef(id));
  menu.addSeparator();
  add(menu, 'Remove folder (keeps scenes)', ACTION_ICONS.removeFolder, () => actions.removeFolder(at, id));
  return menu;
}

/** The menu of a binder entry whose note is not in the vault. */
export function missingMenu({ actions, project }: MenuContext, path: string): Menu {
  const menu = new Menu();
  add(menu, 'Remove from binder', ACTION_ICONS.removeEntry, () => actions.removeMissing(project.indexPath, path));
  return menu;
}

/** The menu of a manuscript note that the binder does not list. */
export function unfiledMenu({ actions, project }: MenuContext, path: string): Menu {
  const at = project.indexPath;
  const menu = new Menu();
  // Filing a note changes the index, which a read-only project does not allow.
  if (!project.readOnly) {
    add(menu, 'Add to manuscript', ACTION_ICONS.addToManuscript, () => actions.addUnfiled(at, path));
  }
  add(menu, 'Open', ACTION_ICONS.open, () => actions.openNote(at, path, false));
  add(menu, 'Open in new tab', ACTION_ICONS.openInNewTab, () => actions.openNote(at, path, 'tab'));
  return menu;
}

/** The menu of a research note. */
export function researchMenu({ actions, project }: MenuContext, path: string): Menu {
  const at = project.indexPath;
  const menu = new Menu();
  add(menu, 'Open', ACTION_ICONS.open, () => actions.openNote(at, path, false));
  add(menu, 'Open in new tab', ACTION_ICONS.openInNewTab, () => actions.openNote(at, path, 'tab'));
  return menu;
}
