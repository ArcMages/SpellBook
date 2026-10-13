// The export engine: everything an exported manuscript is worked out with.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   manuscript  buildManuscript: the scenes in binder order, the folders as
//               chapters, scenes that are switched off left out; the options
//   markdown    the plugin's own reader of a scene's Markdown
//   direction   which way a paragraph runs (Hebrew: right to left)
//   writers     toMarkdown, toHtml, toDocx
//   zip         the zip a .docx is, written and read
//   fileName    the name of the new file
//
// All paths are relative to the project folder, as in the project snapshot.

export { directionOf, looksArabic, splitByScript } from './direction';
export type { Direction, ScriptStretch } from './direction';
export { EXTENSIONS, MAX_NAME_TRIES, exportFileName } from './fileName';
export {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FORMATS,
  MARGIN_TWIPS,
  PAPERS,
  PAPER_SIZES,
  SCENE_BREAK_MARK,
  buildManuscript,
  contentsOf,
  headerText,
  readExportOptions,
  roundWords,
  scenesInScope,
  scopeChoices,
  scopeOf,
  wordsLine,
} from './manuscript';
export type {
  ChapterPart,
  ExportFormat,
  ExportOptions,
  Manuscript,
  ManuscriptInput,
  ManuscriptPart,
  PaperId,
  SceneSource,
  ScenePart,
  ScopeChoice,
  ScopedScene,
} from './manuscript';
export { BULLET, demoteHeadings, manuscriptText, parseBlocks, parseInline, plainText, plainTextOfBlocks } from './markdown';
export type { Block, Run } from './markdown';
export { DOCX_STYLES, docxParts, escapeXml, toDocx } from './toDocx';
export { CONTENTS_TITLE, PRINT_BUTTON_TEXT, PRINT_HINT_TEXT, escapeHtml, toHtml } from './toHtml';
export { MARKDOWN_SCENE_BREAK, toMarkdown } from './toMarkdown';
export { crc32, fromUtf8, unzipStored, utf8, zipStored } from './zip';
export type { ZipEntry } from './zip';
