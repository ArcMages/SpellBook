// The inspector, driven through a fake host and the stand-in screen
// (tests/obsidianStub.ts). These tests check what it shows and what it asks
// the host to write; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDisplayDate } from '../../../src/core/cards';
import {
  INSPECTOR_NO_PROJECT_TEXT,
  INSPECTOR_STARTING_TEXT,
  INSPECTOR_VIEW_TYPE,
  InspectorView,
  NO_DATE_TEXT,
  NO_SCENE_HINT,
  NO_SCENE_TEXT,
  SAVE_PAUSE_MS,
  SUMMARY_SLOT_CLASS,
  createInspectorView,
} from '../../../src/features/corkboard/inspectorView';
import { TagListsModal } from '../../../src/features/corkboard/tagListsModal';
import { Modal as StubModal, Platform as StubPlatform, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import {
  CLOSING,
  DANIEL,
  FakeHost,
  FakeWorkbench,
  HEBREW_SCENE,
  HEBREW_SYNOPSIS,
  LETTER,
  OPENING,
  choose,
  clearScreen,
  isShown,
  notices,
  novelHost,
  novelIndex,
  novelTree,
  one,
  openInspector,
  openWindow,
  rest,
  seen,
  tap,
  typeInto,
} from './stage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

interface Fields {
  synopsis: FakeElement;
  status: FakeElement;
  label: FakeElement;
  target: FakeElement;
  compile: FakeElement & { checked?: boolean };
}

function fieldsOf(pane: FakeElement): Fields {
  return {
    synopsis: one(pane, 'spellbook-inspector-synopsis'),
    status: one(pane, 'spellbook-inspector-status'),
    label: one(pane, 'spellbook-inspector-label'),
    target: one(pane, 'spellbook-inspector-target'),
    compile: one(pane, 'spellbook-inspector-compile').children[0] as FakeElement,
  };
}

/** The message under a field ("" when there is none). */
const errorOf = (pane: FakeElement, field: string): string =>
  one(one(pane, `spellbook-field-${field}`), 'spellbook-field-error').text;

const options = (select: FakeElement): Array<[string, string]> => select.children.map((option) => [option.value, option.text]);

/** A host with the small novel open and its first scene in the editor. */
function hostAt(path: string | null = OPENING): FakeHost {
  const host = novelHost();
  host.activeScenePath = path;
  return host;
}

describe('the view itself', () => {
  it('is the Inspector, with an icon, and is made from a host', () => {
    const view = createInspectorView(new FakeWorkbench().leaf, novelHost());
    expect(view).toBeInstanceOf(InspectorView);
    expect(view.getViewType()).toBe('spellbook-inspector');
    expect(INSPECTOR_VIEW_TYPE).toBe('spellbook-inspector');
    expect(view.getDisplayText()).toBe('Inspector');
    expect(view.getIcon()).not.toBe('');
    expect(view.navigation).toBe(false);
  });

  it('has an empty place at its top for another part of the plugin to fill', async () => {
    const host = hostAt();
    const { pane, view, shell } = await openInspector(host);
    const root = one(pane, 'spellbook-inspector');
    const slot = one(pane, SUMMARY_SLOT_CLASS);
    expect(root.children[0]).toBe(slot);
    expect(slot.children).toEqual([]);
    expect(slot.text).toBe('');
    // It is handed to the host when the inspector opens, and can be asked for.
    expect(host.summarySlot).toBe(slot);
    expect(view.summarySlot).toBe(slot);

    // What is put into it is left alone when the scene changes.
    slot.createSpan({ text: '250 words' });
    host.setActive(CLOSING);
    host.setScene(CLOSING, { frontmatter: { synopsis: 'x' }, words: 1 });
    expect(slot.fullText).toBe('250 words');

    expect(host.summaryUnmounts).toBe(0);
    await shell.close();
    expect(host.summaryUnmounts).toBe(1);
    expect(view.summarySlot).toBeNull();
  });
});

describe('with no scene', () => {
  it('says that no scene is open', async () => {
    const host = hostAt(null);
    const { pane } = await openInspector(host);
    expect(seen(pane, 'spellbook-inspector-message')).toBe(NO_SCENE_TEXT);
    expect(seen(pane, 'spellbook-inspector-hint')).toBe(NO_SCENE_HINT);
    expect(isShown(one(pane, 'spellbook-inspector-form'))).toBe(false);
    // The lists can still be reached.
    expect(isShown(one(pane, 'spellbook-inspector-lists'))).toBe(true);

    host.setActive(OPENING);
    expect(seen(pane, 'spellbook-inspector-message')).toBe('');
    expect(isShown(one(pane, 'spellbook-inspector-form'))).toBe(true);
    host.setActive(null);
    expect(seen(pane, 'spellbook-inspector-message')).toBe(NO_SCENE_TEXT);
  });

  it('says so when no project is open, and while Spellbook is still starting', async () => {
    const host = new FakeHost();
    host.ready = false;
    const { pane } = await openInspector(host);
    expect(seen(pane, 'spellbook-inspector-message')).toBe(INSPECTOR_STARTING_TEXT);
    expect(isShown(one(pane, 'spellbook-inspector-lists'))).toBe(false);
    host.ready = true;
    host.emit({ type: 'project' });
    expect(seen(pane, 'spellbook-inspector-message')).toBe(INSPECTOR_NO_PROJECT_TEXT);
    expect(seen(pane, 'spellbook-inspector-hint')).toBe('');
  });
});

describe('showing the open scene', () => {
  it('shows its title, synopsis, status, label, target, compile switch and dates', async () => {
    const { pane } = await openInspector(hostAt());
    const fields = fieldsOf(pane);
    expect(one(pane, 'spellbook-inspector-title').text).toBe('Opening');
    expect(fields.synopsis.tag).toBe('textarea');
    expect(fields.synopsis.value).toBe('Anna arrives in the old town.');
    expect(options(fields.status)).toEqual([
      ['', 'No status'],
      ['To do', 'To do'],
      ['First draft', 'First draft'],
      ['Done', 'Done'],
    ]);
    expect(fields.status.value).toBe('To do');
    expect(options(fields.label)).toEqual([
      ['', 'No label'],
      ['Anna', 'Anna'],
      [DANIEL, DANIEL],
    ]);
    expect(fields.label.value).toBe('Anna');
    expect(fields.target.value).toBe('1000');
    expect(fields.compile.checked).toBe(true);
    expect(fields.compile.attrs['type']).toBe('checkbox');
    expect(one(pane, 'spellbook-inspector-compile').hasClass('is-enabled')).toBe(true);

    // The dates are plain text, not fields.
    const dates = pane.withClass('spellbook-inspector-date').map((row) => row.children.map((child) => child.text));
    expect(dates).toEqual([
      ['Created', formatDisplayDate('2026-10-01')],
      ['Edited', formatDisplayDate('2026-10-13')],
    ]);
    expect(dates[0]?.[1]).toBe('1 Oct 2026');
    expect(one(pane, 'spellbook-inspector-dates').all().some((element) => ['input', 'select', 'textarea'].includes(element.tag))).toBe(false);
  });

  it("keeps a scene's own status when the project's list does not have it", async () => {
    const { pane } = await openInspector(hostAt(CLOSING));
    const fields = fieldsOf(pane);
    expect(options(fields.status)).toEqual([
      ['', 'No status'],
      ['To do', 'To do'],
      ['First draft', 'First draft'],
      ['Done', 'Done'],
      ['Sent off', 'Sent off (not in the list)'],
    ]);
    expect(fields.status.value).toBe('Sent off');
    expect(fields.label.value).toBe('');
    expect(fields.target.value).toBe('');
    expect(fields.compile.checked).toBe(false);
    expect(one(pane, 'spellbook-inspector-compile').hasClass('is-enabled')).toBe(false);
    expect(pane.withClass('spellbook-inspector-date-value').map((value) => value.text)).toEqual([NO_DATE_TEXT, NO_DATE_TEXT]);
  });

  it("lets only the writer's own text choose its direction", async () => {
    const { pane } = await openInspector(hostAt(HEBREW_SCENE));
    const fields = fieldsOf(pane);
    expect(fields.synopsis.value).toBe(HEBREW_SYNOPSIS);
    expect(fields.synopsis.attrs['dir']).toBe('auto');
    expect(one(pane, 'spellbook-inspector-title').attrs['dir']).toBe('auto');
    // Names of statuses and labels are the writer's own; "No status" is the app's.
    expect(fields.label.children.map((option) => option.attrs['dir'])).toEqual([undefined, 'auto', 'auto']);
    // A number reads left to right in every language.
    expect(fields.target.attrs['dir']).toBe('ltr');
    expect(fields.target.attrs['inputmode']).toBe('numeric');
    // Nothing else has a direction of its own.
    const others = one(pane, 'spellbook-inspector')
      .all()
      .filter((element) => element.attrs['dir'] !== undefined && !['option', 'textarea', 'input'].includes(element.tag));
    expect(others.map((element) => [...element.classes][0])).toEqual(['spellbook-inspector-title']);
  });

  it('says what it could not understand in the properties of the scene', async () => {
    const host = hostAt(LETTER);
    host.scenes.set(LETTER, { frontmatter: { target: 'many', status: ['a', 'b'] } });
    const { pane } = await openInspector(host);
    const problems = pane.withClass('spellbook-inspector-problem');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.attrs['dir'] === 'auto')).toBe(true);
    expect(isShown(one(pane, 'spellbook-inspector-problems'))).toBe(true);
    host.setScene(LETTER, { frontmatter: {} });
    expect(isShown(one(pane, 'spellbook-inspector-problems'))).toBe(false);
  });

  it('follows the editor from scene to scene, and the scene as it changes', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    host.setActive(CLOSING);
    expect(one(pane, 'spellbook-inspector-title').text).toBe('Closing');
    expect(fieldsOf(pane).status.value).toBe('Sent off');

    host.setScene(CLOSING, { frontmatter: { status: 'Done', synopsis: 'The end.', target: 300 } });
    const fields = fieldsOf(pane);
    expect(fields.status.value).toBe('Done');
    expect(fields.synopsis.value).toBe('The end.');
    expect(fields.target.value).toBe('300');
    // The status the list did not have is no longer offered.
    expect(options(fields.status)).toHaveLength(4);

    // A change to another scene is none of its business.
    host.asked.clear();
    host.setScene(OPENING, { frontmatter: { synopsis: 'Elsewhere.' } });
    expect(host.asked.size).toBe(0);
  });

  it('offers the new names when the lists change', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    host.open(novelTree(), { ...novelIndex(), statuses: [{ name: 'To do' }, { name: 'Polished' }] });
    expect(options(fieldsOf(pane).status)).toEqual([
      ['', 'No status'],
      ['To do', 'To do'],
      ['Polished', 'Polished'],
    ]);
    expect(fieldsOf(pane).status.value).toBe('To do');
  });

  it('lets nothing be changed while the project is read-only', async () => {
    const host = hostAt();
    host.open(novelTree(), novelIndex(), { readOnly: true });
    const { pane } = await openInspector(host);
    const fields = fieldsOf(pane);
    expect([fields.synopsis, fields.status, fields.label, fields.target, fields.compile].map((field) => field.disabled)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('saving edits', () => {
  it('saves the synopsis a short pause after the last key, writing only that key', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const { synopsis } = fieldsOf(pane);
    typeInto(synopsis, 'Anna arrives');
    host.timers.advance(SAVE_PAUSE_MS - 1);
    typeInto(synopsis, 'Anna arrives late.');
    host.timers.advance(SAVE_PAUSE_MS - 1);
    // Still typing: nothing is written yet.
    expect(host.patches).toEqual([]);
    host.timers.advance(1);
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { synopsis: 'Anna arrives late.' }, remove: [] } }]);
    await rest(host);
    expect(host.frontmatterOf(OPENING)).toMatchObject({ synopsis: 'Anna arrives late.', status: 'To do', order: 1024 });
    expect(synopsis.value).toBe('Anna arrives late.');
    expect(host.timers.pending).toBe(0);
  });

  it('saves at once when the field loses the keyboard', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const { synopsis } = fieldsOf(pane);
    typeInto(synopsis, 'Shorter.');
    synopsis.dispatch('blur', {});
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { synopsis: 'Shorter.' }, remove: [] } }]);
    // The pause that was running is over: nothing is written a second time.
    host.timers.advance(SAVE_PAUSE_MS * 2);
    await rest(host);
    expect(host.patches).toHaveLength(1);
    // Leaving a field that was not changed writes nothing.
    synopsis.dispatch('blur', {});
    expect(host.patches).toHaveLength(1);
  });

  it('saves a status and a label as soon as they are chosen, and "none" as an empty text', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const fields = fieldsOf(pane);
    choose(fields.status, 'Done');
    choose(fields.label, DANIEL);
    choose(fields.status, '');
    expect(host.patches).toEqual([
      { path: OPENING, patch: { set: { status: 'Done' }, remove: [] } },
      { path: OPENING, patch: { set: { label: DANIEL }, remove: [] } },
      { path: OPENING, patch: { set: { status: '' }, remove: [] } },
    ]);
    await rest(host);
    expect(fields.status.value).toBe('');
    expect(fields.label.value).toBe(DANIEL);
    // Choosing what the scene already has writes nothing.
    choose(fields.label, DANIEL);
    expect(host.patches).toHaveLength(3);
  });

  it('writes nothing when the scene keeps a status the list does not have', async () => {
    const host = hostAt(CLOSING);
    const { pane } = await openInspector(host);
    choose(fieldsOf(pane).status, 'Sent off');
    expect(host.patches).toEqual([]);
  });

  it('saves a target as a whole number, and no target by taking the key away', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const { target } = fieldsOf(pane);
    typeInto(target, '1,500');
    target.dispatch('blur', {});
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { target: 1500 }, remove: [] } }]);
    await rest(host);
    // Shown the way it is stored.
    expect(target.value).toBe('1500');

    typeInto(target, '');
    target.dispatch('keydown', { key: 'Enter', preventDefault: () => {} });
    expect(host.patches[1]).toEqual({ path: OPENING, patch: { set: {}, remove: ['target'] } });
    await rest(host);
    expect(host.frontmatterOf(OPENING)).not.toHaveProperty('target');
    expect(target.value).toBe('');
  });

  it('says beside the field why a target will not do, writes nothing for it, and still saves the rest', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const { target, synopsis } = fieldsOf(pane);
    typeInto(target, 'about a thousand');
    typeInto(synopsis, 'A new synopsis.');
    host.timers.advance(SAVE_PAUSE_MS);
    expect(errorOf(pane, 'target')).toBe('A target is a whole number of words.');
    expect(target.attrs['aria-invalid']).toBe('true');
    expect(target.hasClass('spellbook-is-invalid')).toBe(true);
    expect(errorOf(pane, 'synopsis')).toBe('');
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { synopsis: 'A new synopsis.' }, remove: [] } }]);
    await rest(host);
    // What was typed stays in the field, to be put right.
    expect(target.value).toBe('about a thousand');

    typeInto(target, '900');
    expect(errorOf(pane, 'target')).toBe('');
    expect(target.attrs['aria-invalid']).toBeUndefined();
    target.dispatch('blur', {});
    expect(host.patches[1]).toEqual({ path: OPENING, patch: { set: { target: 900 }, remove: [] } });
  });

  it('saves the compile switch as soon as it is flipped', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const { compile } = fieldsOf(pane);
    compile.checked = false;
    compile.dispatch('change', {});
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { compile: false }, remove: [] } }]);
    expect(one(pane, 'spellbook-inspector-compile').hasClass('is-enabled')).toBe(false);
    await rest(host);
    expect(compile.checked).toBe(false);
  });

  it('saves what was typed to the scene it was typed for, when the writer moves on to another', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    typeInto(fieldsOf(pane).synopsis, 'Typed for the opening.');
    host.setActive(CLOSING);
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { synopsis: 'Typed for the opening.' }, remove: [] } }]);
    expect(fieldsOf(pane).synopsis.value).toBe('');
    host.timers.advance(SAVE_PAUSE_MS * 2);
    await rest(host);
    expect(host.patches).toHaveLength(1);
    expect(host.frontmatterOf(CLOSING)).toEqual({ status: 'Sent off', compile: false });
  });

  it('leaves the field being typed in alone when the scene changes from elsewhere', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const fields = fieldsOf(pane);
    typeInto(fields.synopsis, 'Half a sent');
    // A sync brings another status; the synopsis on disk is still the old one.
    host.setScene(OPENING, { frontmatter: { ...host.frontmatterOf(OPENING), status: 'Done' } });
    expect(fields.status.value).toBe('Done');
    expect(fields.synopsis.value).toBe('Half a sent');
    host.timers.advance(SAVE_PAUSE_MS);
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { synopsis: 'Half a sent' }, remove: [] } }]);
    await rest(host);
    // The status that arrived meanwhile was not undone.
    expect(host.frontmatterOf(OPENING)).toMatchObject({ synopsis: 'Half a sent', status: 'Done' });
  });

  it('keeps showing an edit while the host is still writing it, and goes by it for the next one', async () => {
    const host = hostAt();
    host.obedient = false; // the host notes what is asked and carries nothing out: a slow disk
    const { pane } = await openInspector(host);
    const fields = fieldsOf(pane);
    choose(fields.status, 'Done');
    // Something else about the scene is reported before the write has landed.
    host.emit({ type: 'scenes', paths: [OPENING] });
    expect(fields.status.value).toBe('Done');
    // Back to what the disk still says: that is a change now, and is written.
    choose(fields.status, 'To do');
    expect(host.patches.map((entry) => entry.patch.set)).toEqual([{ status: 'Done' }, { status: 'To do' }]);
    await rest(host);
    // The host answered and wrote nothing: the form shows what the scene really says.
    expect(fields.status.value).toBe('To do');
  });

  it('tells the writer when the host could not save, and shows what the scene still says', async () => {
    const host = hostAt();
    host.refusal = 'The note could not be written.';
    const { pane } = await openInspector(host);
    const fields = fieldsOf(pane);
    choose(fields.label, DANIEL);
    await rest(host);
    expect(notices()).toEqual(['The note could not be written.']);
    expect(fields.label.value).toBe('Anna');
  });

  it('writes nothing when a field is put back the way it was', async () => {
    const host = hostAt();
    const { pane } = await openInspector(host);
    const { synopsis, target } = fieldsOf(pane);
    typeInto(synopsis, 'Something else.');
    typeInto(synopsis, 'Anna arrives in the old town.');
    typeInto(target, '1,000');
    host.timers.advance(SAVE_PAUSE_MS);
    expect(host.patches).toEqual([]);
    expect(target.value).toBe('1000');
  });
});

describe('the lists, and closing', () => {
  it('opens the statuses-and-labels window', async () => {
    const { pane } = await openInspector(hostAt());
    const button = one(pane, 'spellbook-inspector-lists');
    expect(button.tag).toBe('button');
    expect(button.text).toBe('Statuses and labels');
    tap(button);
    expect(openWindow()).toBeInstanceOf(TagListsModal as unknown as typeof StubModal);
  });

  it('saves what was typed and releases everything when it closes', async () => {
    const host = hostAt();
    const { pane, shell } = await openInspector(host);
    typeInto(fieldsOf(pane).synopsis, 'Typed just before closing.');
    expect(host.listenerCount).toBe(1);
    expect(host.timers.pending).toBe(1);

    await shell.close();
    expect(host.patches).toEqual([
      { path: OPENING, patch: { set: { synopsis: 'Typed just before closing.' }, remove: [] } },
    ]);
    expect(host.listenerCount).toBe(0);
    expect(host.timers.pending).toBe(0);
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-inspector-pane')).toBe(false);
    // The host's answer arrives after the inspector is gone: nothing breaks.
    await rest(host);
    host.emit({ type: 'active' });
    expect(pane.children).toEqual([]);
  });

  it('marks phones for the room their floating bar needs, by what Obsidian says the device is', async () => {
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: true });
    const { pane } = await openInspector(hostAt());
    const root = one(pane, 'spellbook-inspector');
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
  });
});
