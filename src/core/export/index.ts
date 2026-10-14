// The export engine: everything an exported manuscript is worked out with.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   manuscript  buildManuscript: the scenes in binder order, the folders as
//               chapters, scenes that are switched off left out; the options
//   markdown    the plugin's own reader of a scene's Markdown
//   direction   which way a paragraph runs (Hebrew: right to left)
//   presets     how the pages look: a manuscript, a reading copy, a proof
//   matter      the pages before and after the text, in manuscript.ts
//   writers     toMarkdown, toHtml, toDocx, toEpub
//   zip         the zip a .docx or an .epub is, written and read
//   fileName    the name of the new file
//
// All paths are relative to the project folder, as in the project snapshot.

export { directionOf, looksArabic, splitByScript } from './direction';
export type { Direction, ScriptStretch } from './direction';
export { EXTENSIONS, MAX_NAME_TRIES, exportFileName } from './fileName';
export {
  BACK_MATTER,
  BOOK_SCENE_BREAK,
  BOOK_WORDS,
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FORMATS,
  FRONT_MATTER,
  HEADING_KEYS,
  MARGIN_TWIPS,
  MATTER_KINDS,
  MAX_HEADING_TEXT,
  MAX_MATTER_TEXT,
  PAGE_BREAK_KEY,
  PAPERS,
  PAPER_SIZES,
  PRESETS,
  PRESET_IDS,
  SCENE_BREAK_MARK,
  TITLE_KEY,
  bookWords,
  buildManuscript,
  cleanHeading,
  contentsOf,
  guessBookLanguage,
  headerText,
  headingDirection,
  readExportOptions,
  readHeadingChoices,
  readSceneExportChoices,
  roundWords,
  scenesInScope,
  scopeChoices,
  scopeOf,
  titledMatter,
  withPreset,
  wordsLine,
} from './manuscript';
export type {
  BookLanguage,
  BookWords,
  ChapterPart,
  ExportFormat,
  ExportOptions,
  HeadingChoices,
  HeadingKey,
  Manuscript,
  ManuscriptInput,
  ManuscriptPart,
  MatterChoice,
  MatterKind,
  MatterPart,
  PaperId,
  Preset,
  PresetId,
  SceneSource,
  ScenePart,
  ScopeChoice,
  ScopedScene,
} from './manuscript';
export { BULLET, demoteHeadings, manuscriptText, parseBlocks, parseInline, plainText, plainTextOfBlocks } from './markdown';
export type { Block, Run } from './markdown';
export { DOCX_STYLES, docxParts, escapeXml, toDocx } from './toDocx';
export { CONTENTS_TITLE, PRINT_BUTTON_TEXT, PRINT_HINT_TEXT, escapeHtml, toHtml } from './toHtml';
export { COVER_TYPES, EPUB_MIMETYPE, epubParts, isCoverPath, toEpub } from './toEpub';
export type { EpubCover, EpubExtras } from './toEpub';
export { MARKDOWN_SCENE_BREAK, toMarkdown } from './toMarkdown';
export { crc32, fromUtf8, unzipStored, utf8, zipStored } from './zip';
export type { ZipEntry } from './zip';
