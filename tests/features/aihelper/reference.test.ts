// The reference for AI assistants: one text, in two places.
//
// The Markdown file in the repository ("AI helper/Spellbook for AI
// assistants.md") is the source. The plugin ships the same text in a
// generated module. These tests fail when the two differ, and when the
// reference stops saying what the code does.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HELPER_MODULE, HELPER_SOURCE, helperModule, helperText } from '../../../scripts/aihelper.mjs';
import { SCENE_STATUSES } from '../../../src/core/scene';
import { INDEX_MARKER_KEY, INDEX_MARKER_VALUE, INDEX_VERSION } from '../../../src/core/projectIndex';
import {
  AI_HELPER_FILE,
  AI_HELPER_FOLDER,
  EXPORTS_FOLDER,
  MANUSCRIPT_FOLDER,
  RESEARCH_FOLDER,
  SNAPSHOTS_FOLDER,
  STATS_FOLDER,
  TIMELINE_FOLDER,
  TODO_FILE,
  WORLD_FOLDER,
} from '../../../src/core/projectLayout';
import { RESERVED_INDEX_KEYS } from '../../../src/core/projectStore';
import { CARD_COLORS, TAG_INDEX_KEYS } from '../../../src/core/cards';
import { DUE_MARK, MARKS_KEY } from '../../../src/core/planner';
import { TARGETS_KEY } from '../../../src/core/progress/index';
import { SCENE_ID_KEY, SNAPSHOT_MARK } from '../../../src/core/snapshots';
import { CALENDAR_KEY, EVENT_MARKER_VALUE } from '../../../src/core/timeline';
import { ALIASES_KEY, BUILT_IN_TYPES, ENTITIES_KEY, ENTITY_TYPES_KEY, IMAGE_KEY, RELATED_KEY, RELATION_LABEL_MAX, newEntityBody } from '../../../src/core/world';
import { HELPER_TEXT } from '../../../src/features/aihelper/index';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(path.join(repoRoot, HELPER_SOURCE), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8')) as { version: string };

describe('one source', () => {
  it('lives where the plugin writes it: the same folder and file name', () => {
    expect(HELPER_SOURCE).toBe(`${AI_HELPER_FOLDER}/${AI_HELPER_FILE}`);
    expect(HELPER_MODULE).toBe('src/features/aihelper/referenceText.ts');
  });

  it('ships exactly the text of the file in the repository', () => {
    // When this fails: the Markdown file was changed without a build. Run "npm run build".
    expect(HELPER_TEXT).toBe(helperText(source));
    expect(readFileSync(path.join(repoRoot, HELPER_MODULE), 'utf8')).toBe(helperModule(source));
  });

  it('is plain text with one line break at its end, and no invisible characters', () => {
    expect(HELPER_TEXT.endsWith('\n')).toBe(true);
    expect(HELPER_TEXT.endsWith('\n\n')).toBe(false);
    expect(HELPER_TEXT).not.toContain('\r');
    expect(HELPER_TEXT.startsWith('# Spellbook for AI assistants\n')).toBe(true);
    // It must not start with a properties block: it is a note to read, not one with properties of its own.
    expect(HELPER_TEXT.startsWith('---')).toBe(false);
    expect(/[​-‏‪-‮⁠-⁩﻿]/.test(HELPER_TEXT)).toBe(false);
  });

  it('has a README next to it', () => {
    const readme = readFileSync(path.join(repoRoot, AI_HELPER_FOLDER, 'README.md'), 'utf8');
    expect(readme).toContain(AI_HELPER_FILE);
    expect(readme).toContain('Create AI helper note');
  });
});

describe('the reference says what the code does', () => {
  const says = (piece: string): void => {
    expect(HELPER_TEXT, piece).toContain(piece);
  };

  it('names the version it describes', () => {
    says(`Spellbook version ${manifest.version} (project layout version ${INDEX_VERSION})`);
  });

  it('names the marker of a project and every folder', () => {
    says(`\`${INDEX_MARKER_KEY}: ${INDEX_MARKER_VALUE}\``);
    says(`\`${INDEX_MARKER_KEY}: ${EVENT_MARKER_VALUE}\``);
    says(`\`${SNAPSHOT_MARK}: 1\``);
    for (const folder of [MANUSCRIPT_FOLDER, TIMELINE_FOLDER, RESEARCH_FOLDER, STATS_FOLDER, WORLD_FOLDER, SNAPSHOTS_FOLDER, EXPORTS_FOLDER, AI_HELPER_FOLDER]) {
      says(`\`${folder}/\``);
    }
    says(`\`${TODO_FILE}\``);
  });

  it('lists every key of the index', () => {
    const keys = [...RESERVED_INDEX_KEYS, TAG_INDEX_KEYS.status, TAG_INDEX_KEYS.label, TARGETS_KEY, MARKS_KEY, 'timelines', CALENDAR_KEY, ENTITY_TYPES_KEY, 'author'];
    for (const key of keys) says(`| \`${key}\` |`);
  });

  it('lists the built-in statuses and the eight colours', () => {
    says(SCENE_STATUSES.map((name) => `\`${name}\``).join(', '));
    says(CARD_COLORS.map((name) => `\`${name}\``).join(', '));
  });

  it('lists every scene property, and says which are never written', () => {
    for (const key of ['synopsis', 'status', 'label', 'target', 'compile', 'order', 'created', 'edited', ENTITIES_KEY, 'date', 'end', 'tags', SCENE_ID_KEY]) {
      says(`| \`${key}\` |`);
    }
    says('Never write, change or remove an `order` value.');
    says(`**\`${SCENE_ID_KEY}\`** on any scene: never write, change or remove it.`);
  });

  it('gives the to-do format with the due mark the planner reads', () => {
    says(`- [ ] Send chapter one ${DUE_MARK} 2026-10-20`);
    says('U+1F4C5');
  });

  it('lists every built-in entity type with its folder, its fields and its headings', () => {
    for (const type of BUILT_IN_TYPES) {
      const headings = newEntityBody(type)
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3));
      says(`| \`${type.id}\` | \`${type.folder}\` | ${type.fields.map((field) => `\`${field}\``).join(', ')} | ${headings.join(', ')} |`);
      // And an example note of each, in the type's folder, with the type's fields in order.
      says(`\`${WORLD_FOLDER}/${type.folder}/`);
      const example = new RegExp(`type: ${type.id}\\n${type.fields.map((field) => `${field}: [^\\n]*\\n`).join('')}${ALIASES_KEY}: \\[\\]\\n---\\n${headings.map((heading) => `## ${heading}\\n`).join('\\n')}`);
      expect(example.test(HELPER_TEXT), `an example of a ${type.id}`).toBe(true);
    }
    expect(BUILT_IN_TYPES.map((type) => type.id)).toEqual(['character', 'place', 'faction', 'item', 'lore', 'creature', 'culture']);
  });

  it('describes relations, pictures and other names as the code reads them', () => {
    says(`| \`${RELATED_KEY}\` | list of links |`);
    says(`| \`${IMAGE_KEY}\` | link |`);
    says(`| \`${ALIASES_KEY}\` | list of text |`);
    says('"[[Tamar|sister]]"');
    says(`${RELATION_LABEL_MAX} characters at most`);
  });
});
