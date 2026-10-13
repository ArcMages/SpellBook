// A name for this device that stays the same from one day to the next.
//
// Some of what the plugin writes into the vault is kept per device, so that
// two devices never write the same file: the daily word log is one file per
// device per month. For that each device needs a short id of its own. It is
// made once, from random letters and digits, and kept in the device's own
// storage (never in the plugin's synced data, or every device would end up
// with the same one).
//
// The id says nothing about the device or its owner. It is only ever made of
// lower-case letters and digits, so it can be used in a file name anywhere.

import type { DeviceStorage } from './devicePrefs';

export const DEVICE_ID_KEY = 'spellbook-device-id';

/** How many letters and digits a new id has. */
export const DEVICE_ID_LENGTH = 10;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const VALID_ID = /^[a-z0-9]{6,32}$/;

/** True for text that can serve as a device id: 6 to 32 lower-case letters and digits. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID.test(value);
}

/** A new id, from the random source handed in (a number from 0 up to, not including, 1). */
export function newDeviceId(random: () => number): string {
  let id = '';
  for (let i = 0; i < DEVICE_ID_LENGTH; i++) {
    const at = Math.min(ALPHABET.length - 1, Math.max(0, Math.floor(random() * ALPHABET.length)));
    id += ALPHABET[at] ?? 'a';
  }
  return id;
}

/**
 * This device's id: the one kept in its storage or, the first time, a new one
 * that is saved there. When the storage cannot be read or written, an id is
 * still returned; it then lasts until Obsidian closes.
 */
export function deviceIdOf(storage: DeviceStorage, random: () => number): string {
  let stored: unknown = null;
  try {
    stored = storage.load(DEVICE_ID_KEY);
  } catch (error) {
    console.error('Spellbook: could not read what this device remembers', error);
  }
  if (isDeviceId(stored)) return stored;
  const id = newDeviceId(random);
  try {
    storage.save(DEVICE_ID_KEY, id);
  } catch (error) {
    console.error('Spellbook: could not save what this device remembers', error);
  }
  return id;
}
