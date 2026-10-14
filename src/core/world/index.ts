// The world-building engine: everything the World browser, the windows
// around it and the inspector's "In this scene" part are built on.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   types.ts     the types an entity can have, and the changes to that list
//   entity.ts    an entity note: its properties, its template, reading them,
//                and the lines of its sheet
//   image.ts     an entity's picture: the link to it, and where it leads
//   links.ts     which entities a scene or an event lists, both ways round
//   relations.ts which entities an entity has to do with, both ways round
//   browse.ts    the browser's search, filter, groups, cards and table
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
  FIELDS_VERSION,
  FIELDS_VERSION_KEY,
  IMAGE_KEY,
  RELATED_KEY,
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

export {
  entityFields,
  fieldText,
  isEntityPath,
  newEntityBody,
  newEntityFrontmatter,
  readAliases,
  readEntities,
  editAliases,
  setAliases,
  setEntityField,
  tidyAliases,
  sheetFields,
} from './entity';
export type { AliasEdit, Entity, EntityField, FieldChange, SheetField, WorldNote } from './entity';

export { imageLink, readImageTarget, resolveImage, searchImages, setImage } from './image';

export {
  RELATION_LABEL_MAX,
  addRelation,
  buildRelations,
  groupRelations,
  parseRelation,
  readRelationEntries,
  relabelRelation,
  relationTo,
  removeRelation,
  tidyLabel,
  writeRelation,
} from './relations';
export type { BackRelation, Relation, RelationGroup, RelationSources, WorldRelations, WrittenRelation } from './relations';

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
  CARD_FACTS_MAX,
  DEFAULT_LAYOUT,
  DEFAULT_SORT,
  NARROW_PANE_PX,
  NARROW_SLACK_PX,
  OTHER_NAME,
  OTHER_TYPE,
  WORLD_COLUMNS,
  WORLD_LAYOUTS,
  cardFacts,
  groupEntities,
  isNarrowPane,
  kindOf,
  matchesSearch,
  nextSort,
  readLayout,
  sceneCountText,
  searchKey,
  tableRows,
} from './browse';
export type { CardFact, EntityGroup, WorldColumn, WorldLayout, WorldRow, WorldSort } from './browse';

export { MIN_MENTION_LENGTH, SNIPPET_REACH, findMention, mentionNames, sceneMention, snippetAround } from './mentions';
export type { Mention, MentionSnippet } from './mentions';

export { SCENE_ENTITIES_SERVICE } from './services';
export type { SceneEntitiesService, SceneEntityChip } from './services';

export { WORLD_FOLDER } from '../projectLayout';
