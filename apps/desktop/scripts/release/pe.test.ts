import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { codeSections, sameCode } from './pe.ts';

// A minimal PE: DOS header, PE signature, COFF header without an optional
// header, and the given sections' bytes laid out after the table.
function pe(sections: Array<[string, string]>): Uint8Array {
  const tableStart = 0x40 + 24;
  let offset = tableStart + sections.length * 40;
  const header = Buffer.alloc(offset);
  header.write('MZ', 0, 'latin1');
  header.writeUInt32LE(0x40, 0x3c);
  header.write('PE\0\0', 0x40, 'latin1');
  header.writeUInt16LE(sections.length, 0x40 + 6);
  header.writeUInt16LE(0, 0x40 + 20);
  const bodies: Buffer[] = [];
  sections.forEach(([name, data], index) => {
    const entry = tableStart + index * 40;
    header.write(name, entry, 'latin1');
    header.writeUInt32LE(data.length, entry + 16);
    header.writeUInt32LE(offset, entry + 20);
    bodies.push(Buffer.from(data, 'latin1'));
    offset += data.length;
  });
  return Buffer.concat([header, ...bodies]);
}

describe('codeSections', () => {
  it('hashes every section but the resources', () => {
    const sections = codeSections(
      pe([
        ['.text', 'code'],
        ['.rsrc', 'icon'],
        ['.reloc', 'fix'],
      ]),
    );
    assert.deepEqual([...sections.keys()], ['.text', '.reloc']);
    assert.equal(
      sections.get('.text'),
      '5694d08a2e53ffcae0c3103e5ad6f6076abd960eb1f8a56577040bc1028f702b',
    );
  });

  it('refuses what isn’t an executable', () => {
    assert.throws(
      () => codeSections(Buffer.from('#!/bin/sh')),
      /Not a Windows/,
    );
  });
});

describe('sameCode', () => {
  it('ignores a changed icon and catches changed code', () => {
    const vendor = codeSections(
      pe([
        ['.text', 'code'],
        ['.rsrc', 'electron'],
      ]),
    );
    assert.equal(
      sameCode(
        codeSections(
          pe([
            ['.text', 'code'],
            ['.rsrc', 'nod icon'],
          ]),
        ),
        vendor,
      ),
      true,
    );
    assert.equal(
      sameCode(
        codeSections(
          pe([
            ['.text', 'evil'],
            ['.rsrc', 'electron'],
          ]),
        ),
        vendor,
      ),
      false,
    );
    assert.equal(
      sameCode(
        codeSections(
          pe([
            ['.text', 'code'],
            ['.data', 'x'],
            ['.rsrc', 'electron'],
          ]),
        ),
        vendor,
      ),
      false,
    );
  });
});
