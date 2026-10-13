// A small writer (and reader) of zip files, for the Word export: a .docx is
// a zip of a few XML files.
//
// Every file is "stored": put in as it is, not compressed. That needs no
// library and works the same on a phone; a novel's worth of text is a few
// megabytes at most. Dates are left at zero, so that the same manuscript
// always gives exactly the same bytes.
//
// The reader understands what the writer makes (stored entries only). The
// tests use it to open an exported file again and look inside.

/** One file inside a zip. */
export interface ZipEntry {
  /** The file's path inside the zip, with forward slashes. */
  readonly name: string;
  readonly data: Uint8Array;
}

const LOCAL_HEADER = 0x04034b50;
const DIRECTORY_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
/** The zip version that stored entries need: 2.0. */
const VERSION = 20;
/** Bit 11 of the flags: the name is written as UTF-8. */
const UTF8_NAMES = 0x0800;

let crcTable: Uint32Array | null = null;

function tableOfCrc(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** The CRC-32 checksum of some bytes, as zip files use it. */
export function crc32(data: Uint8Array): number {
  const table = tableOfCrc();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Text as UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** UTF-8 bytes as text. */
export function fromUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Put files together into one zip. The entries are written in the order
 * given, uncompressed. Two entries may not share a name.
 */
export function zipStored(entries: readonly ZipEntry[]): Uint8Array {
  const names = entries.map((entry) => utf8(entry.name));
  const seen = new Set<string>();
  let size = 22;
  entries.forEach((entry, index) => {
    if (entry.name === '' || seen.has(entry.name)) throw new Error(`A zip cannot hold two files called "${entry.name}".`);
    seen.add(entry.name);
    const nameLength = (names[index] as Uint8Array).length;
    size += 30 + nameLength + entry.data.length + 46 + nameLength;
  });

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  const sums: number[] = [];
  let at = 0;

  entries.forEach((entry, index) => {
    const name = names[index] as Uint8Array;
    const sum = crc32(entry.data);
    offsets.push(at);
    sums.push(sum);
    view.setUint32(at, LOCAL_HEADER, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, UTF8_NAMES, true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, 0, true); // time
    view.setUint16(at + 12, 0, true); // date
    view.setUint32(at + 14, sum, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(entry.data, at + 30 + name.length);
    at += 30 + name.length + entry.data.length;
  });

  const directoryStart = at;
  entries.forEach((entry, index) => {
    const name = names[index] as Uint8Array;
    view.setUint32(at, DIRECTORY_HEADER, true);
    view.setUint16(at + 4, VERSION, true); // made by
    view.setUint16(at + 6, VERSION, true); // needed to read
    view.setUint16(at + 8, UTF8_NAMES, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, 0, true);
    view.setUint32(at + 16, sums[index] as number, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, name.length, true);
    // No extra field, no comment, disk 0, no attributes.
    view.setUint32(at + 42, offsets[index] as number, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });

  view.setUint32(at, END_RECORD, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directoryStart, true);
  view.setUint32(at + 16, directoryStart, true);
  return out;
}

/**
 * Open a zip of stored entries and give its files, in the order its
 * directory lists them. Throws, saying what is wrong, when the bytes are not
 * such a zip: a missing or damaged directory, a compressed entry, a checksum
 * that does not fit its file.
 */
export function unzipStored(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_RECORD) end--;
  if (end < 0) throw new Error('This is not a zip file: it has no directory.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (at + view.getUint32(end + 12, true) !== end) throw new Error('The directory of the zip is not where it says it is.');

  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== DIRECTORY_HEADER) throw new Error('The directory of the zip is damaged.');
    const method = view.getUint16(at + 10, true);
    const sum = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = fromUtf8(zip.subarray(at + 46, at + 46 + nameLength));
    if (method !== 0 || view.getUint32(at + 20, true) !== size) throw new Error(`"${name}" is compressed; only stored files can be read.`);
    if (view.getUint32(local, true) !== LOCAL_HEADER) throw new Error(`"${name}" is not where the directory says it is.`);
    const localName = fromUtf8(zip.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)));
    if (localName !== name) throw new Error(`"${name}" is listed under another name ("${localName}") than it is stored under.`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > zip.length) throw new Error(`"${name}" runs past the end of the zip.`);
    const data = zip.slice(start, start + size);
    if (crc32(data) !== sum || view.getUint32(local + 14, true) !== sum) throw new Error(`The checksum of "${name}" does not fit.`);
    entries.push({ name, data });
    at += 46 + nameLength + skip;
  }
  return entries;
}
