// The colour schemes as they are plugged into the plugin: a scheme is put on
// without a reload, survives a restart, is remembered per device, and comes
// off the page entirely when the plugin is switched off.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_SCHEME_DESCRIPTION, SCHEMES, SCHEME_VARIABLE_NAMES, schemeById, schemeVariables } from '../../../src/core/schemes';
import type { ColourScheme } from '../../../src/core/schemes';
import { SCHEME_COMMANDS, SCHEME_KEY } from '../../../src/features/schemes/index';
import { IN_USE_TEXT, PICKER_EMPTY_TEXT, PICKER_PLACEHOLDER } from '../../../src/features/schemes/picker';
import { SETTINGS_INTRO, SETTINGS_TITLE, USED_TEXT, USE_TEXT } from '../../../src/features/schemes/settings';
import { SCHEME_CLASSES, SchemeWearer } from '../../../src/features/schemes/wearer';
import type { SchemeSurface } from '../../../src/features/schemes/wearer';
import { Notice as StubNotice, fakeDocument, fakeWindow, resetFakeDocument } from '../../obsidianStub';
import { MemoryDeviceStorage } from '../../storeHarness';
import { buttonOf, coloursOf, forgetWrites, schemeClassesOn, swatchColours, undressBody, variablesOn, wire, writes } from './stage';

afterEach(() => {
  vi.restoreAllMocks();
  undressBody();
  resetFakeDocument();
});

const scheme = (id: string): ColourScheme => {
  const found = schemeById(id);
  if (!found) throw new Error(`no scheme "${id}"`);
  return found;
};

const asSet = (wanted: ColourScheme): Record<string, string> => Object.fromEntries(schemeVariables(wanted));

/** A device that already chose a scheme. */
function deviceWith(id: string): MemoryDeviceStorage {
  const storage = new MemoryDeviceStorage();
  storage.save(SCHEME_KEY, id);
  storage.saves.length = 0;
  return storage;
}

describe('the colour schemes, plugged in', () => {
  it('adds two commands and a part of the settings, and nothing else', () => {
    const stage = wire();
    expect(stage.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['choose-colour-scheme', 'Choose colour scheme'],
      ['next-colour-scheme', 'Next colour scheme'],
    ]);
    expect(SCHEME_COMMANDS.choose.id).toBe('choose-colour-scheme');
    expect(SCHEME_COMMANDS.next.id).toBe('next-colour-scheme');
    expect(stage.features.settingsSections.map((section) => [section.id, section.title])).toEqual([['schemes', SETTINGS_TITLE]]);
    expect(stage.plugin.viewTypes).toEqual([]);
    expect(stage.plugin.ribbonIcons).toEqual([]);
    expect(stage.plugin.statusBar.children).toEqual([]);
    expect(stage.plugin.editorExtensions).toEqual([]);
    // It listens to nothing of the workspace or the vault: only for the app coming back to the front.
    expect(stage.fake.workspace.listenerCount()).toBe(0);
    expect(stage.fake.vault.listenerCount()).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(1);
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(1);
    expect(fakeWindow.listenerCount()).toBe(0);
  });

  it('with no scheme chosen, leaves no mark at all: not on the page, not on the device', () => {
    const stage = wire();
    stage.body.addClass('theme-dark');
    expect(variablesOn(stage.body)).toEqual({});
    expect(schemeClassesOn(stage.body)).toEqual([]);
    expect(writes).toEqual({ set: 0, removed: 0, read: 0 }); // the body was not so much as looked at
    expect(stage.storage.saves).toEqual([]);
    expect(stage.idsMade()).toBe(0);
    // Nor when the app comes back to the front, or the plugin is switched off.
    fakeDocument.dispatch('visibilitychange');
    stage.switchOff();
    expect(writes).toEqual({ set: 0, removed: 0, read: 0 });
    expect([...stage.body.classes]).toEqual(['theme-dark']);
  });

  it('puts a scheme on at once when it is picked, with no reload', () => {
    const stage = wire();
    const picker = stage.openPicker();
    picker.pick('Sepia');

    expect(schemeClassesOn(stage.body)).toEqual(['spellbook-scheme', 'spellbook-scheme-light', 'spellbook-scheme-sepia']);
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('sepia')));
    expect(stage.body.style['--background-primary']).toBe(scheme('sepia').page);
    expect(stage.body.style['--text-normal']).toBe(scheme('sepia').ink);
    expect(stage.body.style['--spellbook-scheme-accent']).toBe(scheme('sepia').accent);
    expect(stage.storage.saves).toEqual([[SCHEME_KEY, 'sepia']]);
  });

  it('changes from one scheme to another: the new one whole, nothing of the old', () => {
    const stage = wire();
    stage.openPicker().pick('Sepia');
    stage.openPicker().pick('Ember');
    expect(schemeClassesOn(stage.body)).toEqual(['spellbook-scheme', 'spellbook-scheme-dark', 'spellbook-scheme-ember']);
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('ember')));
    expect(stage.storage.values.get(SCHEME_KEY)).toBe(JSON.stringify('ember'));
  });

  it('gives everything back to the Obsidian theme with "None"', () => {
    const stage = wire();
    stage.body.addClass('theme-light', 'is-mobile');
    stage.body.style['--someone-elses'] = '1';
    stage.openPicker().pick('Dusk');
    stage.openPicker().pick('None');

    expect(schemeClassesOn(stage.body)).toEqual([]);
    expect(variablesOn(stage.body)).toEqual({ '--someone-elses': '1' }); // what is not the plugin's stays
    expect([...stage.body.classes].sort()).toEqual(['is-mobile', 'theme-light']);
    expect(stage.storage.saves).toEqual([
      [SCHEME_KEY, 'dusk'],
      [SCHEME_KEY, null], // nothing is kept for "None"
    ]);
    expect(stage.storage.values.size).toBe(0);
  });

  it('keeps its own colours whichever mode Obsidian is in, and never touches the mode', () => {
    const stage = wire();
    stage.body.addClass('theme-dark');
    stage.openPicker().pick('Paper'); // a light scheme while Obsidian is dark
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('paper')));
    expect(stage.body.hasClass('spellbook-scheme-light')).toBe(true);
    expect(stage.body.hasClass('theme-dark')).toBe(true);

    // Obsidian goes light (the system does, in the morning): the scheme stays as it is.
    stage.body.removeClass('theme-dark');
    stage.body.addClass('theme-light');
    forgetWrites();
    stage.fake.workspace.trigger('css-change');
    fakeDocument.dispatch('visibilitychange');
    expect(writes.set).toBe(0);
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('paper')));
    expect([...stage.body.classes].filter((name) => name.startsWith('theme-'))).toEqual(['theme-light']);
  });

  it('survives a restart: the scheme this device chose is put on again when the plugin starts', () => {
    const first = wire();
    first.openPicker().pick('Mist');
    first.switchOff();
    expect(variablesOn(first.body)).toEqual({});

    const second = wire(first.storage);
    expect(schemeClassesOn(second.body)).toEqual(['spellbook-scheme', 'spellbook-scheme-light', 'spellbook-scheme-mist']);
    expect(variablesOn(second.body)).toEqual(asSet(scheme('mist')));
    // Putting it on again saves nothing: the device already knows.
    expect(second.storage.saves).toEqual([[SCHEME_KEY, 'mist']]);
  });

  it('is remembered per device: another device has its own choice, or none', () => {
    const desktop = wire();
    desktop.openPicker().pick('Paper');
    desktop.switchOff();
    undressBody();

    // The phone shares the vault, not what the desktop remembers.
    const phone = wire(deviceWith('ink'));
    expect(variablesOn(phone.body)).toEqual(asSet(scheme('ink')));
    phone.switchOff();
    undressBody();

    const tablet = wire();
    expect(variablesOn(tablet.body)).toEqual({});
    expect(schemeClassesOn(tablet.body)).toEqual([]);
    // And nothing of it went near the vault.
    expect(desktop.fake.calls).toEqual([]);
    expect(desktop.storage.values.get(SCHEME_KEY)).toBe(JSON.stringify('paper'));
  });

  it('takes every class and every variable off the page when the plugin is switched off', () => {
    const stage = wire(deviceWith('ember'));
    stage.body.addClass('theme-dark');
    stage.body.style['--someone-elses'] = '1';
    expect(Object.keys(variablesOn(stage.body)).length).toBe(SCHEME_VARIABLE_NAMES.length + 1);

    stage.switchOff();

    expect(variablesOn(stage.body)).toEqual({ '--someone-elses': '1' });
    expect([...stage.body.classes]).toEqual(['theme-dark']);
    expect(fakeDocument.listenerCount()).toBe(0);
    // The choice itself stays: it is what the device wants the next time.
    expect(stage.storage.saves).toEqual([]);
    expect(stage.storage.values.get(SCHEME_KEY)).toBe(JSON.stringify('ember'));

    // Nothing comes back afterwards, whatever is still waiting.
    stage.timers.advance(1000);
    fakeDocument.dispatch('visibilitychange');
    expect(variablesOn(stage.body)).toEqual({ '--someone-elses': '1' });
  });

  it('counts as "None" whatever the device remembers that is no scheme, and repairs nothing by itself', () => {
    for (const stored of ['gone', '', 'Paper', 'constructor']) {
      const stage = wire(deviceWith(stored));
      expect(variablesOn(stage.body), stored).toEqual({});
      expect(schemeClassesOn(stage.body), stored).toEqual([]);
      expect(stage.storage.saves, stored).toEqual([]);
      stage.switchOff();
      undressBody();
    }
    // Something that is not text at all.
    const storage = new MemoryDeviceStorage();
    storage.values.set(SCHEME_KEY, JSON.stringify({ id: 'paper' }));
    expect(variablesOn(wire(storage).body)).toEqual({});
  });

  it('carries on when the device\'s storage fails: the scheme then lasts until Obsidian closes', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = new MemoryDeviceStorage();
    storage.broken = true;
    const stage = wire(storage);
    expect(logged).toHaveBeenCalledTimes(1); // it could not be read
    expect(stage.features.ids).toEqual(['schemes']);
    expect(variablesOn(stage.body)).toEqual({});

    stage.openPicker().pick('Dusk');
    expect(logged).toHaveBeenCalledTimes(2); // it could not be saved
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('dusk')));
    stage.switchOff();
    expect(variablesOn(stage.body)).toEqual({});
  });
});

describe('the page loses what a scheme set on it', () => {
  it('is put right when the app comes back to the front, writing only what is missing', () => {
    const stage = wire(deviceWith('dusk'));
    // As on a phone when the app was in the background: the body was made anew.
    delete stage.body.style['--background-primary'];
    delete stage.body.style['--text-normal'];
    stage.body.style['--text-muted'] = 'something else';
    stage.body.removeClass('spellbook-scheme-dusk');
    forgetWrites();

    fakeDocument.dispatch('visibilitychange');

    expect(variablesOn(stage.body)).toEqual(asSet(scheme('dusk')));
    expect(schemeClassesOn(stage.body)).toEqual(['spellbook-scheme', 'spellbook-scheme-dark', 'spellbook-scheme-dusk']);
    expect(writes.set).toBe(3);
    expect(writes.removed).toBe(0);

    // Asked again with nothing wrong, nothing is written.
    forgetWrites();
    fakeDocument.dispatch('visibilitychange');
    expect(writes.set).toBe(0);
    expect(writes.removed).toBe(0);
  });

  it('is not put right while the app is going out of sight', () => {
    const stage = wire(deviceWith('dusk'));
    delete stage.body.style['--background-primary'];
    const page = fakeDocument as unknown as { visibilityState?: string };
    page.visibilityState = 'hidden';
    try {
      fakeDocument.dispatch('visibilitychange');
      expect(stage.body.style['--background-primary']).toBeUndefined();
      page.visibilityState = 'visible';
      fakeDocument.dispatch('visibilitychange');
      expect(stage.body.style['--background-primary']).toBe(scheme('dusk').page);
    } finally {
      delete page.visibilityState;
    }
  });

  it('is put right after the picker has closed, in case the closing window put the old page back', () => {
    const stage = wire(deviceWith('paper'));
    const before = variablesOn(stage.body);
    stage.openPicker().pick('Ink');
    expect(stage.timers.pending).toBe(2); // once the window is gone, and when the page has been drawn
    // As a phone's window may do when it closes: the body as it was when the window opened.
    for (const name of Object.keys(stage.body.style)) delete stage.body.style[name];
    Object.assign(stage.body.style, before);
    stage.body.removeClass('spellbook-scheme-ink');
    stage.body.addClass('spellbook-scheme-paper');

    stage.timers.advance(0);
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('ink')));
    expect(schemeClassesOn(stage.body)).toEqual(['spellbook-scheme', 'spellbook-scheme-dark', 'spellbook-scheme-ink']);
    forgetWrites();
    stage.timers.advance(16);
    expect(writes.set).toBe(0);
    expect(stage.timers.pending).toBe(0);
  });

  it('takes off again what a closing window brought back after "None" was picked', () => {
    const stage = wire(deviceWith('paper'));
    const before = variablesOn(stage.body);
    stage.openPicker().pick('None');
    expect(variablesOn(stage.body)).toEqual({});
    Object.assign(stage.body.style, before);
    stage.body.addClass('spellbook-scheme', 'spellbook-scheme-paper');

    stage.timers.advance(16);
    expect(variablesOn(stage.body)).toEqual({});
    expect(schemeClassesOn(stage.body)).toEqual([]);
  });
});

describe('"Choose colour scheme"', () => {
  it('lists "None" and every scheme, each with a picture of itself and a line that says what it is', () => {
    const stage = wire();
    const picker = stage.openPicker();
    expect(picker.isOpen).toBe(true);
    expect(picker.modalEl.hasClass('spellbook-scheme-picker')).toBe(true);
    expect(picker.inputEl.getAttr('placeholder')).toBe(PICKER_PLACEHOLDER);
    expect(picker.emptyStateText).toBe(PICKER_EMPTY_TEXT);

    const rows = picker.shownFor();
    expect(rows.map((row) => row.withClass('spellbook-scheme-option-name')[0]?.text)).toEqual([
      'None',
      'Paper',
      'Sepia',
      'Mist',
      'Dusk',
      'Ink',
      'Ember',
    ]);
    expect(rows.map((row) => row.withClass('spellbook-scheme-option-note')[0]?.text)).toEqual([
      NO_SCHEME_DESCRIPTION,
      ...SCHEMES.map((entry) => entry.description),
    ]);
    rows.forEach((row, at) => {
      expect(row.hasClass('spellbook-scheme-option')).toBe(true);
      const swatch = row.withClass('spellbook-scheme-swatch');
      expect(swatch).toHaveLength(1);
      expect(swatch[0]?.getAttr('aria-hidden')).toBe('true');
      const shown = SCHEMES[at - 1];
      if (shown) {
        // The picture shows the scheme it stands for, in that scheme's own colours.
        expect(swatchColours(swatch[0] as never)).toEqual(coloursOf(shown));
        expect(swatch[0]?.hasClass('spellbook-scheme-swatch-none')).toBe(false);
      } else {
        // "None" has no colours of its own: its picture follows the theme.
        expect(swatch[0]?.hasClass('spellbook-scheme-swatch-none')).toBe(true);
        expect(Object.values(swatchColours(swatch[0] as never)).every((value) => value === undefined)).toBe(true);
      }
    });
  });

  it('marks the one in use, and only that one', () => {
    const fresh = wire();
    const marked = (rows: ReturnType<ReturnType<typeof fresh.openPicker>['shownFor']>): string[] =>
      rows
        .filter((row) => row.hasClass('spellbook-scheme-option-current'))
        .map((row) => `${row.withClass('spellbook-scheme-option-name')[0]?.text}: ${row.withClass('spellbook-scheme-option-mark')[0]?.text}`);
    expect(marked(fresh.openPicker().shownFor())).toEqual([`None: ${IN_USE_TEXT}`]);
    fresh.openPicker().pick('Mist');
    expect(marked(fresh.openPicker().shownFor())).toEqual([`Mist: ${IN_USE_TEXT}`]);
  });

  it('can be narrowed by typing, and changes nothing when it is closed without a pick', () => {
    const stage = wire(deviceWith('sepia'));
    const picker = stage.openPicker();
    expect(picker.shownFor('em').map((row) => row.withClass('spellbook-scheme-option-name')[0]?.text)).toEqual(['Ember']);
    expect(picker.shownFor('zzz')).toEqual([]);
    picker.close();
    stage.timers.advance(16);
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('sepia')));
    expect(stage.storage.saves).toEqual([]);
  });

  it('saves nothing when the scheme in use is picked again', () => {
    const stage = wire(deviceWith('sepia'));
    stage.openPicker().pick('Sepia');
    expect(stage.storage.saves).toEqual([]);
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('sepia')));
  });
});

describe('"Next colour scheme"', () => {
  it('goes through every scheme and back to none, saying each time which it is', () => {
    const stage = wire();
    const seen: string[][] = [];
    for (let turn = 0; turn <= SCHEMES.length; turn++) {
      stage.command('next-colour-scheme').callback?.();
      seen.push(schemeClassesOn(stage.body).filter((name) => !/-(light|dark)$/.test(name) && name !== 'spellbook-scheme'));
    }
    expect(seen).toEqual([
      ['spellbook-scheme-paper'],
      ['spellbook-scheme-sepia'],
      ['spellbook-scheme-mist'],
      ['spellbook-scheme-dusk'],
      ['spellbook-scheme-ink'],
      ['spellbook-scheme-ember'],
      [],
    ]);
    expect(variablesOn(stage.body)).toEqual({});
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual([
      'Colour scheme: Paper',
      'Colour scheme: Sepia',
      'Colour scheme: Mist',
      'Colour scheme: Dusk',
      'Colour scheme: Ink',
      'Colour scheme: Ember',
      'Colour scheme: None',
    ]);
    expect(StubNotice.shown.every((notice) => (notice.duration ?? 0) > 0)).toBe(true);
    expect(stage.storage.saves.map(([, value]) => value)).toEqual(['paper', 'sepia', 'mist', 'dusk', 'ink', 'ember', null]);
  });

  it('starts from the scheme this device remembers', () => {
    const stage = wire(deviceWith('ink'));
    stage.command('next-colour-scheme').callback?.();
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('ember')));
  });
});

describe('the "Colour scheme" part of the settings', () => {
  it('shows a row for "None" and for every scheme, with its picture and a button', () => {
    const stage = wire(deviceWith('dusk'));
    const { place } = stage.openSettings();
    expect(place.settings[0]?.descEl.text).toBe(SETTINGS_INTRO);
    // The introduction says the three things a writer has to know.
    expect(SETTINGS_INTRO).toMatch(/this device only/);
    expect(SETTINGS_INTRO).toMatch(/light or dark mode/);
    expect(SETTINGS_INTRO).toMatch(/"None"/);

    const rows = place.settings.slice(1);
    expect(rows.map((row) => row.nameEl.text)).toEqual(['None', 'Paper', 'Sepia', 'Mist', 'Dusk', 'Ink', 'Ember']);
    expect(rows.map((row) => row.descEl.text)).toEqual([NO_SCHEME_DESCRIPTION, ...SCHEMES.map((entry) => entry.description)]);
    rows.forEach((row, at) => {
      expect(row.settingEl.hasClass('spellbook-scheme-row')).toBe(true);
      const swatch = row.controlEl.withClass('spellbook-scheme-swatch');
      expect(swatch).toHaveLength(1);
      const shown = SCHEMES[at - 1];
      if (shown) expect(swatchColours(swatch[0] as never)).toEqual(coloursOf(shown));
    });
    // The one in use says so, and its button cannot be pressed.
    expect(rows.filter((row) => row.settingEl.hasClass('spellbook-scheme-row-current')).map((row) => row.nameEl.text)).toEqual(['Dusk']);
    expect(rows.map((row) => buttonOf(place, row.nameEl.text).buttonEl.text)).toEqual([
      USE_TEXT,
      USE_TEXT,
      USE_TEXT,
      USE_TEXT,
      USED_TEXT,
      USE_TEXT,
      USE_TEXT,
    ]);
    expect(buttonOf(place, 'Dusk').disabled).toBe(true);
    expect(buttonOf(place, 'Paper').disabled).toBe(false);
  });

  it('puts a scheme on at the press of its button, remembers it, and shows the new choice', () => {
    const stage = wire();
    const { place } = stage.openSettings();
    buttonOf(place, 'Sepia').click();

    expect(variablesOn(stage.body)).toEqual(asSet(scheme('sepia')));
    expect(stage.storage.saves).toEqual([[SCHEME_KEY, 'sepia']]);
    expect(buttonOf(place, 'Sepia').buttonEl.text).toBe(USED_TEXT);
    expect(buttonOf(place, 'None').buttonEl.text).toBe(USE_TEXT);
    expect(place.settings).toHaveLength(SCHEMES.length + 2); // drawn anew, not drawn twice

    buttonOf(place, 'None').click();
    expect(variablesOn(stage.body)).toEqual({});
    expect(buttonOf(place, 'None').disabled).toBe(true);
  });

  it('follows a change made from the keyboard while it is open, and no longer once it is closed', () => {
    const stage = wire();
    const { place, close } = stage.openSettings();
    stage.command('next-colour-scheme').callback?.();
    expect(buttonOf(place, 'Paper').buttonEl.text).toBe(USED_TEXT);

    close();
    // Closing the settings puts the scheme right, as closing the picker does.
    expect(stage.timers.pending).toBe(2);
    stage.timers.advance(16);
    stage.command('next-colour-scheme').callback?.();
    expect(buttonOf(place, 'Paper').buttonEl.text).toBe(USED_TEXT); // left as it was: nobody is looking
    expect(variablesOn(stage.body)).toEqual(asSet(scheme('sepia')));
  });
});

describe('the wearer', () => {
  /** A stand-in page that keeps a list of everything done to it. */
  function surface(): SchemeSurface & { classes: Set<string>; variables: Map<string, string>; done: string[] } {
    const classes = new Set<string>();
    const variables = new Map<string, string>();
    const done: string[] = [];
    return {
      classes,
      variables,
      done,
      hasClass: (name) => classes.has(name),
      addClass: (name) => {
        done.push(`+${name}`);
        classes.add(name);
      },
      removeClass: (name) => {
        done.push(`-${name}`);
        classes.delete(name);
      },
      getVariable: (name) => variables.get(name) ?? '',
      setVariable: (name, value) => {
        done.push(`set ${name}`);
        variables.set(name, value);
      },
      removeVariable: (name) => {
        done.push(`remove ${name}`);
        variables.delete(name);
      },
    };
  }

  it('only ever adds and removes the classes of its own list', () => {
    expect(SCHEME_CLASSES).toEqual([
      'spellbook-scheme',
      'spellbook-scheme-light',
      'spellbook-scheme-dark',
      ...SCHEMES.map((entry) => `spellbook-scheme-${entry.id}`),
    ]);
    const page = surface();
    const wearer = new SchemeWearer(page);
    for (const entry of [...SCHEMES, null]) wearer.wear(entry);
    const touched = new Set(page.done.filter((step) => /^[+-]/.test(step)).map((step) => step.slice(1)));
    expect([...touched].every((name) => SCHEME_CLASSES.includes(name))).toBe(true);
    expect(touched.size).toBe(SCHEME_CLASSES.length);
    const variables = new Set(page.done.filter((step) => /^(set|remove) /.test(step)).map((step) => step.replace(/^\w+ /, '')));
    expect([...variables].sort()).toEqual([...SCHEME_VARIABLE_NAMES].sort());
    expect(page.classes.size).toBe(0);
    expect(page.variables.size).toBe(0);
  });

  it('writes a class only when it is wrong: putting the same scheme on twice does nothing the second time', () => {
    const page = surface();
    const wearer = new SchemeWearer(page);
    wearer.wear(scheme('paper'));
    expect(wearer.scheme?.id).toBe('paper');
    const steps = page.done.length;
    wearer.wear(scheme('paper'));
    wearer.settle();
    expect(page.done.length).toBe(steps);
  });

  it('does nothing at all until a scheme has been worn', () => {
    const page = surface();
    page.variables.set('--background-primary', 'left by something else');
    const wearer = new SchemeWearer(page);
    wearer.wear(null);
    wearer.settle();
    expect(page.done).toEqual([]);
    expect(wearer.scheme).toBeNull();
  });
});
