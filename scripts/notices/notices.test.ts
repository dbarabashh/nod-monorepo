import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildNotices, renderNotices, type Component } from './notices.ts';

const mit = (holder: string) => `MIT License

Copyright (c) 2024 ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software.`;

function component(
  name: string,
  text: string | null,
  overrides: Partial<Component> = {},
): Component {
  return {
    name,
    version: '1.0.0',
    license: 'MIT',
    source: 'npm',
    texts: text === null ? [] : [text],
    ...overrides,
  };
}

describe('buildNotices', () => {
  it('stores one body for licenses that differ only in copyright and spacing', () => {
    const notices = buildNotices([
      component('b-lib', mit('Bea')),
      component('a-lib', mit('Ann').replace('of this', 'of  this')),
    ]);
    assert.deepEqual(Object.keys(notices.texts), ['t1']);
    assert.deepEqual(
      notices.entries.map((entry) => [entry.name, entry.copyright, entry.text]),
      [
        ['a-lib', ['Copyright (c) 2024 Ann'], 't1'],
        ['b-lib', ['Copyright (c) 2024 Bea'], 't1'],
      ],
    );
  });

  it('keeps a different license as its own body', () => {
    const notices = buildNotices([
      component('a', mit('Ann')),
      component('z', 'Zlib license text\n\n(c) Zed', {
        license: 'Zlib',
        source: 'crate',
      }),
    ]);
    assert.deepEqual(Object.keys(notices.texts), ['t1', 't2']);
    assert.equal(notices.texts.t2, 'Zlib license text');
    assert.deepEqual(notices.entries[1]?.copyright, ['(c) Zed']);
  });

  it('marks a component that ships no license file', () => {
    const notices = buildNotices([component('bare', null, { license: 'ISC' })]);
    assert.equal(notices.entries[0]?.text, null);
    assert.match(
      renderNotices(notices, 'Title'),
      /bare 1\.0\.0 \(npm package\) - ISC\n\nNo license file ships with this component; its metadata names ISC\./,
    );
  });
});

describe('license bodies', () => {
  const apache = `Apache License
Version 2.0, January 2004

"Work" shall mean the work of authorship, as indicated by a
copyright notice that is included in or attached to the work.

(c) You must retain, in the Source form of any Derivative Works
that You distribute, all copyright notices.

Copyright [yyyy] [name of copyright owner]`;

  const isc = `ISC License

Copyright (c) 2020 Ann

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.`;

  const bsd = `Copyright (c) 2019, Bea
All rights reserved.

Redistribution and use in source and binary forms are permitted provided that:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.`;

  it('keeps every line of the license, even ones that start with copyright', () => {
    const notices = buildNotices([
      component('apache-lib', apache, { license: 'Apache-2.0' }),
      component('isc-lib', isc, { license: 'ISC' }),
      component('bsd-lib', bsd, { license: 'BSD-2-Clause' }),
    ]);
    const body = (name: string) => {
      const entry = notices.entries.find((item) => item.name === name);
      return entry?.text ? notices.texts[entry.text] : undefined;
    };
    assert.match(
      body('apache-lib') ?? '',
      /\ncopyright notice that is included in or attached to the work\./,
    );
    assert.match(
      body('apache-lib') ?? '',
      /\(c\) You must retain, in the Source form/,
    );
    assert.match(
      body('isc-lib') ?? '',
      /\ncopyright notice and this permission notice appear in all copies\.$/,
    );
    assert.match(
      body('bsd-lib') ?? '',
      /retain the above copyright notice,\n   this list of conditions/,
    );
  });

  it('takes copyright holders from the heading only, and never a template line', () => {
    const notices = buildNotices([
      component('apache-lib', apache, { license: 'Apache-2.0' }),
      component('isc-lib', isc, { license: 'ISC' }),
      component('bsd-lib', bsd, { license: 'BSD-2-Clause' }),
    ]);
    assert.deepEqual(
      notices.entries.map((entry) => [entry.name, entry.copyright]),
      [
        ['apache-lib', []],
        ['bsd-lib', ['Copyright (c) 2019, Bea']],
        ['isc-lib', ['Copyright (c) 2020 Ann']],
      ],
    );
  });
});

describe('dual-licensed crates', () => {
  const apache =
    'Apache License\nVersion 2.0, January 2004\n\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION.';
  const mitFor = (holder: string) =>
    `Copyright (c) 2014 ${holder}\n\nPermission is hereby granted, free of charge.`;

  it('names each crate its own holder from its own LICENSE-MIT', () => {
    const notices = buildNotices([
      {
        name: 'cfg-if',
        version: '1.0.0',
        license: 'MIT OR Apache-2.0',
        source: 'crate',
        texts: [apache, mitFor('Alex Crichton')],
      },
      {
        name: 'sha2',
        version: '0.10.0',
        license: 'MIT OR Apache-2.0',
        source: 'crate',
        texts: [apache, mitFor('The RustCrypto Project Developers')],
      },
    ]);
    assert.deepEqual(
      notices.entries.map((entry) => [entry.name, entry.copyright]),
      [
        ['cfg-if', ['Copyright (c) 2014 Alex Crichton']],
        ['sha2', ['Copyright (c) 2014 The RustCrypto Project Developers']],
      ],
    );
    assert.equal(notices.entries[0]?.text, notices.entries[1]?.text);
  });

  it('never merges a body that names a different holder inside it', () => {
    const filled = (holder: string) =>
      `Apache License\nVersion 2.0, January 2004\n\nTERMS AND CONDITIONS FOR USE.\n\nCopyright 2019 ${holder}`;
    const notices = buildNotices([
      component('a', filled('Coveo Solutions Inc.'), { license: 'Apache-2.0' }),
      component('b', filled('Someone Else'), { license: 'Apache-2.0' }),
    ]);
    assert.notEqual(notices.entries[0]?.text, notices.entries[1]?.text);
    assert.match(
      notices.texts[notices.entries[0]?.text ?? ''] ?? '',
      /Copyright 2019 Coveo Solutions Inc\.$/,
    );
  });

  it('keeps a holder that wraps onto the next line', () => {
    const notices = buildNotices([
      component(
        'retry',
        'Copyright (c) 2011:\nTim Koschützki (tim@debuggable.com)\n\nPermission is hereby granted.',
      ),
    ]);
    assert.deepEqual(notices.entries[0]?.copyright, [
      'Copyright (c) 2011: Tim Koschützki (tim@debuggable.com)',
    ]);
    assert.equal(
      notices.texts[notices.entries[0]?.text ?? ''],
      'Permission is hereby granted.',
    );
  });
});

describe('renderNotices', () => {
  it('writes each component with its copyright and full license body', () => {
    const text = renderNotices(
      buildNotices([component('a-lib', mit('Ann'))]),
      'Nod third-party notices',
    );
    assert.equal(
      text,
      `Nod third-party notices

${'-'.repeat(72)}

a-lib 1.0.0 (npm package) - MIT

Copyright (c) 2024 Ann

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software.
`,
    );
  });
});
