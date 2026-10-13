// The plugin's own zip writer and reader (src/core/export/zip.ts): what a
// Word export is packed with.

import { describe, expect, it } from 'vitest';
import { crc32, fromUtf8, unzipStored, utf8, zipStored } from '../../../src/core/export';

describe('crc32', () => {
  it('gives the checksums every zip tool gives', () => {
    expect(crc32(utf8(''))).toBe(0);
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipStored', () => {
  const entries = [
    { name: '[Content_Types].xml', data: utf8('<Types/>') },
    { name: 'word/document.xml', data: utf8('<w:t>שלום</w:t>') },
    { name: 'empty.txt', data: new Uint8Array(0) },
  ];

  it('writes a zip that reads back file for file, byte for byte, in order', () => {
    const zip = zipStored(entries);
    const back = unzipStored(zip);
    expect(back.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
    expect(back.map((entry) => fromUtf8(entry.data))).toEqual(['<Types/>', '<w:t>שלום</w:t>', '']);
  });

  it('is laid out as the format asks: a header before each file, a directory, an end record', () => {
    const zip = zipStored([{ name: 'a.txt', data: utf8('hello') }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // local header
    expect(view.getUint16(6, true)).toBe(0x0800); // names are UTF-8
    expect(view.getUint16(8, true)).toBe(0); // stored, not compressed
    expect(view.getUint32(14, true)).toBe(crc32(utf8('hello')));
    expect(view.getUint32(18, true)).toBe(5);
    expect(view.getUint32(22, true)).toBe(5);
    expect(fromUtf8(zip.subarray(30, 35))).toBe('a.txt');
    expect(fromUtf8(zip.subarray(35, 40))).toBe('hello');
    expect(view.getUint32(40, true)).toBe(0x02014b50); // directory
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 16, true)).toBe(40); // where the directory starts
    expect(zip.length).toBe(30 + 5 + 5 + 46 + 5 + 22);
  });

  it('gives the same bytes for the same files: no date goes in', () => {
    expect(zipStored(entries)).toEqual(zipStored(entries));
  });

  it('keeps a Hebrew file name', () => {
    const [entry] = unzipStored(zipStored([{ name: 'פרק.txt', data: utf8('x') }]));
    expect(entry?.name).toBe('פרק.txt');
  });

  it('refuses two files of one name, and a file with no name', () => {
    expect(() => zipStored([entries[0]!, entries[0]!])).toThrow(/two files/);
    expect(() => zipStored([{ name: '', data: utf8('x') }])).toThrow();
  });
});

describe('unzipStored', () => {
  it('says so when the bytes are no zip, or a damaged one', () => {
    expect(() => unzipStored(utf8('just some text, long enough to look at'))).toThrow(/not a zip/);
    const zip = zipStored([{ name: 'a.txt', data: utf8('hello') }]);
    const damaged = zip.slice();
    damaged[36] = 0x58; // a letter of the file changed: the checksum no longer fits
    expect(() => unzipStored(damaged)).toThrow(/checksum/);
    const compressed = zip.slice();
    new DataView(compressed.buffer).setUint16(40 + 10, 8, true);
    expect(() => unzipStored(compressed)).toThrow(/compressed/);
  });

  it('reads a zip that sits inside a larger buffer', () => {
    const zip = zipStored([{ name: 'a.txt', data: utf8('hello') }]);
    const padded = new Uint8Array(zip.length + 8);
    padded.set(zip, 8);
    expect(fromUtf8(unzipStored(padded.subarray(8))[0]!.data)).toBe('hello');
  });
});
