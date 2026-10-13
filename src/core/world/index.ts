// The world-building engine: everything the World browser, the windows
// around it and the inspector's "In this scene" part are built on.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   types.ts     the types an entity can have, and the changes to that list
//   entity.ts    an entity note: its properties, its template, reading them
//   links.ts     which entities a scene or an event lists, both ways round
//   browse.ts    the browser's search, filter and groups
//   mentions.ts  "Find mentions": a name standing in a scene's text
//   services.ts  what the inspector is offered, and under which name
//
// All paths are relative to the project folder, unless they are called vault paths.

export {
  ALIASES_KEY,
  BUILT_IN_TYPES,
  ENTITIES_KEY,
  ENTITY_ICONS,
  ENTITY_TYPES_KEY,
  SUMMARY_KEY,
  TYPE_KEY,
  addType,
  changeType,
  findType,
  moveType,
  readEntityTypes,
  readFields,
  removeType,
  typeKey,
  writeEntityTypes,
} from './types';
export type { EntityType, TypeDetails, TypeEdit } from './types';

export { entityFields, fieldText, isEntityPath, newEntityBody, newEntityFrontmatter, readAliases, readEntities } from './entity';
export type { Entity, EntityField, WorldNote } from './entity';

export {
  addEntityLink,
  buildWorldLinks,
  linkTo,
  nameLink,
  parseLink,
  pathLink,
  readEntityLinks,
  removeEntityLink,
} from './links';
export type { Appearance, LinkChange, LinkResolver, LinkingNote, NoteLink, WorldLinks, WorldSources, WrittenLink } from './links';

export {
  ALL_TYPES,
  NARROW_PANE_PX,
  NARROW_SLACK_PX,
  OTHER_NAME,
  OTHER_TYPE,
  groupEntities,
  isNarrowPane,
  matchesSearch,
  sceneCountText,
  searchKey,
} from './browse';
export type { EntityGroup } from './browse';

export { MIN_MENTION_LENGTH, SNIPPET_REACH, findMention, mentionNames, sceneMention, snippetAround } from './mentions';
export type { Mention, MentionSnippet } from './mentions';

export { SCENE_ENTITIES_SERVICE } from './services';
export type { SceneEntitiesService, SceneEntityChip } from './services';

export { WORLD_FOLDER } from '../projectLayout';
