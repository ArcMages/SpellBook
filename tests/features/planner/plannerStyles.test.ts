// Rules about the planner's stylesheet (src/styles/planner.css), checked by
// reading it. The build joins it with the stylesheets of the other screens
// into styles.css (scripts/styles.mjs), which is generated and not kept in
// the repository; tests/sourceRules.test.ts checks the whole. These are the
// planner's own rules, and that its part keeps to itself.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STYLES_DIR, STYLE_FILES } from '../../../scripts/styles.mjs';
import { MARK_COLORS } from '../../../src/core/planner';
import { MARK_CLASSES, TINT_CLASSES } from '../../../src/features/planner/plannerModel';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const plannerDir = path.join(root, 'src', 'features', 'planner');
const stylesDir = path.join(root, STYLES_DIR);
const PLANNER_STYLES = 'planner.css';
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = withoutComments(readFileSync(path.join(stylesDir, PLANNER_STYLES), 'utf8'));
/** The stylesheets the planner's is joined with: what is shared, the binder and the other screens. */
const otherCss = withoutComments(
  STYLE_FILES.filter((name) => name !== PLANNER_STYLES)
    .map((name) => readFileSync(path.join(stylesDir, name), 'utf8'))
    .join('\n'),
);

interface Rule {
  selectors: string[];
  body: string;
}

/** The rules of a stylesheet, read the way tests/sourceRules.test.ts reads them. */
function rulesOf(text: string): Rule[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    body: match[2] ?? '',
  }));
}

/** What is inside every media rule that asks this question. */
function inside(text: string, query: RegExp): string {
  const pattern = new RegExp(`@media\\s*${query.source}\\s*\\{([\\s\\S]*?\\})\\s*\\}`, 'g');
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '').join('\n');
}

const rules = rulesOf(css);
const find = (selector: string): Rule | undefined => rules.find((rule) => rule.selectors.includes(selector));
const TOUCH = /min-(?:height|width):\s*var\(--spellbook-planner-touch\)/;

describe('src/styles/planner.css', () => {
  it('only styles things inside elements the plugin itself marked', () => {
    expect(rules.length).toBeGreaterThan(80);
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        expect(selector.startsWith('.spellbook-'), selector).toBe(true);
      }
    }
  });

  it('takes its colours from the theme, never from fixed values', () => {
    for (const rule of rules) {
      expect(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|color-mix)\(/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
  });

  it('names sides "start" and "end", never left and right', () => {
    for (const rule of rules) {
      expect(/\b(left|right)\b/.test(rule.body), `${rule.selectors.join(', ')} { ${rule.body.trim()} }`).toBe(false);
    }
  });

  it("gives its own variables the plugin's prefix, and uses none it did not declare or Obsidian does not have", () => {
    const declared = rules.flatMap((rule) => [...rule.body.matchAll(/(?:^|[;\s])(--[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
    expect(declared.length).toBeGreaterThan(4);
    for (const name of declared) expect(name.startsWith('--spellbook-'), name).toBe(true);
    const used = new Set([...css.matchAll(/var\((--spellbook-[A-Za-z0-9-]+)/g)].map((match) => match[1] ?? ''));
    for (const name of used) expect(declared, name).toContain(name);
  });

  it("maps each stored colour name to Obsidian's own colour of that name", () => {
    for (const color of MARK_COLORS) {
      expect(find(`.spellbook-planner .spellbook-mark-${color}`)?.body.trim(), color).toBe(`--spellbook-mark-color: var(--color-${color});`);
    }
    expect(find('.spellbook-planner .spellbook-mark-plain')?.body).toMatch(/--spellbook-mark-color:\s*var\(--text-muted\)/);
  });

  it('has a rule for each tint but the first, each stronger than the one before', () => {
    const strength = TINT_CLASSES.slice(1).map((cls) => {
      const body = find(`.spellbook-planner .spellbook-day.${cls}::before`)?.body ?? '';
      return Number(/opacity:\s*([\d.]+)/.exec(body)?.[1]);
    });
    expect(strength.every((value) => value > 0 && value < 1)).toBe(true);
    expect([...strength].sort((a, b) => a - b)).toEqual(strength);
    expect(new Set(strength).size).toBe(4);
    expect(find(`.spellbook-planner .spellbook-day.${TINT_CLASSES[0]}::before`)).toBeUndefined();
  });

  it('makes what is tapped big enough for a finger on touch screens, and only there', () => {
    expect(css).toMatch(/--spellbook-planner-touch:\s*44px/);
    const touchRules = rules.filter((rule) => TOUCH.test(rule.body));
    expect(touchRules.length).toBe(4);
    const coarse = inside(css, /\(pointer:\s*coarse\)/);
    for (const rule of touchRules) {
      const guarded = rule.selectors.every((selector) => selector.includes('.spellbook-is-mobile')) || coarse.includes(rule.body);
      expect(guarded, rule.selectors.join(', ')).toBe(true);
    }
    // Everything a finger taps is covered, in both places: by Obsidian's own platform check and by the kind of pointer.
    const tapped = [
      'spellbook-planner-tab',
      'spellbook-calendar-today',
      'spellbook-calendar-step',
      'spellbook-day',
      'spellbook-detail-close',
      'spellbook-mark-swatch',
      'spellbook-mark-label',
      'spellbook-mark-remove',
      'spellbook-todo-row',
      'spellbook-todo-tick',
      'spellbook-todo-more',
      'spellbook-todo-input',
      'spellbook-todo-date',
      'spellbook-todo-add-button',
      'spellbook-todos-open',
      'spellbook-todos-done-toggle',
    ];
    const selectors = touchRules.flatMap((rule) => rule.selectors);
    for (const cls of tapped) {
      expect(selectors, cls).toContain(`.spellbook-planner.spellbook-is-mobile .${cls}`);
      expect(selectors, cls).toContain(`.spellbook-planner .${cls}`);
    }
  });

  it('leaves room under whatever scrolls for the bar that floats over the bottom of a phone', () => {
    const rule = find('.spellbook-planner.spellbook-is-phone .spellbook-planner-scroll');
    expect(rule?.body).toMatch(/padding-block-end:/);
    expect(rule?.body).toMatch(/var\(--mobile-navbar-height, 0px\)/);
    expect(rule?.body).toMatch(/var\(--safe-area-inset-bottom, 0px\)/);
    expect(rule?.body).toMatch(/max\([^;]*var\(--spellbook-planner-bar-room\)/);
    expect(css).toMatch(/--spellbook-planner-bar-room:\s*80px/);
    // Both things that scroll carry the class the rule asks for.
    const sources = readdirSync(plannerDir).map((name) => readFileSync(path.join(plannerDir, name), 'utf8')).join('\n');
    expect(sources).toMatch(/spellbook-calendar-scroll spellbook-planner-scroll/);
    expect(sources).toMatch(/spellbook-todos-scroll spellbook-planner-scroll/);
    expect(find('.spellbook-planner-scroll')?.body).toMatch(/overflow-y:\s*auto/);
  });

  it('gives no element a direction: only the markup does, for the writer\'s own text', () => {
    for (const rule of rules) {
      expect(/(^|[;\s])direction\s*:|unicode-bidi\s*:/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
  });

  it('never hides or reveals anything on hover, and makes nothing invisible', () => {
    const changesWhatIsSeen = /\b(display|visibility|opacity|pointer-events)\s*:/;
    const hoverRules = rules.filter((rule) => rule.selectors.some((selector) => selector.includes(':hover')));
    expect(hoverRules.length).toBeGreaterThan(0);
    const hoverOnly = inside(css, /\(hover:\s*hover\)/);
    for (const rule of hoverRules) {
      expect(changesWhatIsSeen.test(rule.body), rule.selectors.join(', ')).toBe(false);
      // A hint for a pointer that can hover, asked for only where there is one.
      expect(hoverOnly.includes(rule.body), rule.selectors.join(', ')).toBe(true);
    }
    for (const rule of rules) {
      expect(/\b(opacity:\s*0(?![.\d])|visibility:\s*hidden\b)/.test(rule.body), rule.selectors.join(', ')).toBe(false);
    }
  });

  it('uses no transition or animation, which a slow phone would stutter on', () => {
    expect(/\b(transition|animation)\s*:|@keyframes/.test(css)).toBe(false);
  });

  it("keeps a finger that rests on a to-do from selecting its text or raising the phone's own bubble", () => {
    const row = find('.spellbook-planner .spellbook-todo-row');
    expect(row?.body).toMatch(/-webkit-touch-callout:\s*none/);
    expect(row?.body).toMatch(/-webkit-user-select:\s*none/);
    expect(row?.body).toMatch(/[^-]user-select:\s*none/);
  });

  it('shows two tabs on a narrow pane and both parts side by side on a wide one', () => {
    expect(find('.spellbook-planner-tabs')?.body).toMatch(/display:\s*none/);
    expect(find('.spellbook-planner.spellbook-is-narrow .spellbook-planner-tabs')?.body).toMatch(/display:\s*flex/);
    const hidden = find('.spellbook-planner.spellbook-is-narrow.spellbook-shows-todos .spellbook-calendar');
    expect(hidden?.selectors).toContain('.spellbook-planner.spellbook-is-narrow.spellbook-shows-calendar .spellbook-todos');
    expect(hidden?.body).toMatch(/display:\s*none/);
  });

  it('styles no class that the planner does not put on anything', () => {
    // A class that is misspelled here or there would style nothing, silently.
    const read = (file: string): string => readFileSync(file, 'utf8');
    const sources = [
      ...readdirSync(plannerDir).map((name) => read(path.join(plannerDir, name))),
      read(path.join(root, 'src', 'ui', 'dragDrop.ts')),
    ].join('\n');
    const known = new Set([...sources.matchAll(/spellbook-[a-z0-9-]+/g)].map((match) => match[0]));
    for (const cls of MARK_CLASSES) known.add(cls);
    const styled = new Set(rules.flatMap((rule) => rule.selectors.flatMap((selector) => [...selector.matchAll(/\.(spellbook-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''))));
    expect(styled.size).toBeGreaterThan(60);
    for (const cls of styled) expect(known.has(cls), cls).toBe(true);
    // The other way round, for the classes that carry a layout: each one the code sets is styled.
    for (const cls of [
      'spellbook-is-narrow',
      'spellbook-is-phone',
      'spellbook-is-mobile',
      'spellbook-is-rtl',
      'spellbook-is-unused',
      'spellbook-has-no-project',
      'spellbook-has-detail',
      'spellbook-detail-beside',
      'spellbook-shows-numbers',
      'spellbook-shows-labels',
      'spellbook-shows-calendar',
      'spellbook-shows-todos',
      'spellbook-is-today',
      'spellbook-is-selected',
      'spellbook-is-outside',
      'spellbook-has-mark',
      'spellbook-is-overdue',
      'spellbook-is-done',
      'spellbook-is-collapsed',
      'spellbook-is-current',
      'spellbook-is-chosen',
      'spellbook-is-met',
      'spellbook-is-dragged',
      'spellbook-drag-active',
    ]) {
      expect(styled.has(cls), cls).toBe(true);
    }
  });
});

describe('joined with the stylesheets of the other screens', () => {
  it('is one of the parts the build joins into styles.css', () => {
    expect(STYLE_FILES).toContain(PLANNER_STYLES);
    expect(rulesOf(otherCss).length).toBeGreaterThan(50);
  });

  it('declares no rule that another stylesheet declares too', () => {
    const mine = new Set(rules.flatMap((rule) => rule.selectors));
    for (const rule of rulesOf(otherCss)) {
      for (const selector of rule.selectors) expect(mine.has(selector), selector).toBe(false);
    }
  });

  it("uses its own figures for what a finger taps and for the phone's bar, and leaves the binder's alone", () => {
    // tests/sourceRules.test.ts allows the binder's figures in the binder's own rules only.
    expect(/--spellbook-touch-target\b/.test(css)).toBe(false);
    expect(/--spellbook-phone-bar-room\b/.test(css)).toBe(false);
    expect(otherCss).toMatch(/--spellbook-touch-target:\s*44px/);
    expect(otherCss).toMatch(/--spellbook-phone-bar-room:\s*80px/);
  });

  it('declares no variable that another stylesheet declares too', () => {
    const declaredIn = (text: string): Set<string> => new Set([...text.matchAll(/(?:^|[;{\s])(--spellbook-[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
    const others = declaredIn(otherCss);
    expect(others.size).toBeGreaterThan(0);
    for (const name of declaredIn(css)) expect(others.has(name), name).toBe(false);
  });
});
