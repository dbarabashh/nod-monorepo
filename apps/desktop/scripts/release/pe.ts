import { createHash } from 'node:crypto';

// The SHA-256 of each section of a Windows PE file, by name. Resources are
// left out: Squirrel writes the app's icon and version into its launcher,
// its updater and its installer, and nothing else.
export function codeSections(file: Uint8Array): Map<string, string> {
  const view = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  const sections = new Map<string, string>();
  for (const section of headers(view).sections) {
    if (section.rawOffset + section.rawSize > view.length) {
      throw new Error(`Section ${section.name} runs past the end of the file`);
    }
    if (section.name !== '.rsrc') {
      sections.set(
        section.name,
        createHash('sha256')
          .update(
            view.subarray(
              section.rawOffset,
              section.rawOffset + section.rawSize,
            ),
          )
          .digest('hex'),
      );
    }
  }
  return sections;
}

export function sameCode(a: Map<string, string>, b: Map<string, string>) {
  return (
    a.size === b.size && [...a].every(([name, hash]) => b.get(name) === hash)
  );
}

type Section = {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawSize: number;
  rawOffset: number;
};

function headers(view: Buffer) {
  if (view.length < 64 || view.toString('latin1', 0, 2) !== 'MZ') {
    throw new Error('Not a Windows executable');
  }
  const pe = view.readUInt32LE(0x3c);
  if (view.toString('latin1', pe, pe + 4) !== 'PE\0\0') {
    throw new Error('Not a Windows executable');
  }
  const count = view.readUInt16LE(pe + 6);
  const optionalSize = view.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const table = optional + optionalSize;
  const sections: Section[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = table + index * 40;
    sections.push({
      name: view.toString('latin1', entry, entry + 8).replace(/\0+$/, ''),
      virtualSize: view.readUInt32LE(entry + 8),
      virtualAddress: view.readUInt32LE(entry + 12),
      rawSize: view.readUInt32LE(entry + 16),
      rawOffset: view.readUInt32LE(entry + 20),
    });
  }
  return { optional, optionalSize, sections };
}

// The resource of the given type name and numeric id, as Squirrel's
// WriteZipToSetup stores the installer's package (type DATA, id 131).
export function resource(
  file: Uint8Array,
  type: string,
  id: number,
): Uint8Array | null {
  const view = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  const { optional, optionalSize, sections } = headers(view);
  const magic = view.readUInt16LE(optional);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  if (directories + 24 > optional + optionalSize) {
    return null;
  }
  const rva = view.readUInt32LE(directories + 16);
  const offsetOf = (address: number) => {
    const section = sections.find(
      (candidate) =>
        address >= candidate.virtualAddress &&
        address <
          candidate.virtualAddress +
            Math.max(candidate.virtualSize, candidate.rawSize),
    );
    if (section === undefined) {
      throw new Error('A resource points outside the file');
    }
    return section.rawOffset + address - section.virtualAddress;
  };
  if (rva === 0) {
    return null;
  }
  const base = offsetOf(rva);
  const entries = (directory: number) => {
    const named = view.readUInt16LE(directory + 12);
    const ids = view.readUInt16LE(directory + 14);
    return Array.from({ length: named + ids }, (_, index) => {
      const entry = directory + 16 + index * 8;
      const name = view.readUInt32LE(entry);
      const target = view.readUInt32LE(entry + 4);
      const label =
        name & 0x80000000
          ? view.toString(
              'utf16le',
              base + (name & 0x7fffffff) + 2,
              base +
                (name & 0x7fffffff) +
                2 +
                view.readUInt16LE(base + (name & 0x7fffffff)) * 2,
            )
          : name;
      return {
        label,
        directory: (target & 0x80000000) !== 0,
        offset: base + (target & 0x7fffffff),
      };
    });
  };
  const typeEntry = entries(base).find(
    (entry) => entry.label === type && entry.directory,
  );
  const idEntry = typeEntry
    ? entries(typeEntry.offset).find(
        (entry) => entry.label === id && entry.directory,
      )
    : undefined;
  const languages = idEntry ? entries(idEntry.offset) : [];
  const [language] = languages;
  if (languages.length !== 1 || language === undefined || language.directory) {
    return null;
  }
  const dataRva = view.readUInt32LE(language.offset);
  const size = view.readUInt32LE(language.offset + 4);
  const start = offsetOf(dataRva);
  if (start + size > view.length) {
    throw new Error('A resource runs past the end of the file');
  }
  return view.subarray(start, start + size);
}
