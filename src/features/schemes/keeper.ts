// Which colour scheme this device wears: remembered on the device, put on
// the page, and told to whoever shows the choice.
//
// The choice is kept per device (and per vault), never in the synced data: a
// phone and a desktop may well want different schemes. Only the scheme's id
// is saved, as text; nothing is saved for "None". Whatever comes back from
// the storage is checked before it is used: an id that no scheme has (an
// older version's, or something edited by hand) counts as "None".

import type { DeviceStorage } from '../../core/devicePrefs';
import { nextScheme, schemeById } from '../../core/schemes';
import type { ColourScheme } from '../../core/schemes';
import type { SchemeWearer } from './wearer';

/** Where the chosen scheme's id is kept in the device's own storage. */
export const SCHEME_KEY = 'spellbook-colour-scheme';

export class SchemeKeeper {
  private readonly storage: DeviceStorage;
  private readonly wearer: SchemeWearer;
  private readonly listeners = new Set<() => void>();
  private released = false;

  constructor(storage: DeviceStorage, wearer: SchemeWearer) {
    this.storage = storage;
    this.wearer = wearer;
  }

  /** Put on what this device chose the last time. Nothing is touched when that was "None". */
  start(): void {
    if (this.released) return;
    let stored: unknown = null;
    try {
      stored = this.storage.load(SCHEME_KEY);
    } catch (error) {
      console.error('Spellbook: the colour scheme of this device could not be read', error);
    }
    this.wearer.wear(schemeById(stored));
  }

  /** The scheme in use, or null for "None". */
  get scheme(): ColourScheme | null {
    return this.wearer.scheme;
  }

  /** Change the scheme, at once, and remember it on this device. Null is "None". */
  choose(scheme: ColourScheme | null): void {
    if (this.released) return;
    const before = this.wearer.scheme;
    this.wearer.wear(scheme);
    if (before?.id === scheme?.id) return;
    try {
      this.storage.save(SCHEME_KEY, scheme?.id ?? null);
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: the colour scheme could not be saved on this device', error);
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** Go on to the next scheme of the list, round and round. Returns what is worn now. */
  chooseNext(): ColourScheme | null {
    this.choose(nextScheme(this.wearer.scheme));
    return this.wearer.scheme;
  }

  /** Put right whatever something else took off the page (see SchemeWearer.settle). */
  settle(): void {
    if (!this.released) this.wearer.settle();
  }

  /** Be told when the choice changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The plugin is being switched off: everything comes off the page. The choice stays remembered. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.listeners.clear();
    this.wearer.wear(null);
  }
}
