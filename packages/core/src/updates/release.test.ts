import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesOf, toBase64 } from '../crypto/encoding.ts';
import {
  newestRelease,
  parseManifest,
  releaseKeys,
  verifyManifest,
} from './release.ts';

const releaseKeysOfTheRepository =
  'WU/kAw0AdSgzo0qSvvRJU00HFw8GWWEOEqhmalOuDTo=,h3K3LZ8dpF6TQyi29QTO+EJlbD5p5VRPD+ytA4o1xqs=';

// desktop-v0.1.1 as the release workflow wrote and signed it with Node's
// crypto, so the noble check here agrees with what desktop copies trust.
const desktopManifest = {
  version: '0.1.1',
  tag: 'desktop-v0.1.1',
  files: {
    'Nod-0.1.1-Setup.exe': {
      size: 161648640,
      sha256:
        'a2e61f381be8f513b1900f40e7423d32ad8203362c966a764ebbba5dda770f79',
    },
    'Nod-0.1.1-arm64.dmg': {
      size: 138018724,
      sha256:
        '184647bc35a1123f80c0d05e5eeab9980f314ce57c4a8f66d99084aabea998c3',
    },
    'Nod-0.1.1-x64.dmg': {
      size: 144226084,
      sha256:
        '89fa688a29d7100762c62707be862b9043a335ee3b528b95b52ac8953a7662f3',
    },
    'Nod-darwin-arm64-0.1.1.zip': {
      size: 138080581,
      sha256:
        '07894e0468b457fa963f437884bee8777cd68e02935ef651c8d9c8e5a5222345',
    },
    'Nod-darwin-x64-0.1.1.zip': {
      size: 144389054,
      sha256:
        '8cc138a2e399f00e5f721163f1703d76e6c96a150c4a98b90d964bf4d18622c4',
    },
    'Nod.ico': {
      size: 94925,
      sha256:
        '0924356c1b292a8866559850de4b76074d4130297016e5dd7b9b81f71b821efc',
    },
    RELEASES: {
      size: 82,
      sha256:
        '398768587ce4ae092e138fa7890dc7048f91c4d7c3bdc4d335d2c08a40c789a3',
    },
    'RELEASES-darwin-arm64.json': {
      size: 432,
      sha256:
        '9c100d5b8dbb3e0c43bcbc31b745e23bce6415542e1c07e06db179832ce44608',
    },
    'RELEASES-darwin-x64.json': {
      size: 430,
      sha256:
        'a1ccc85fa094b711fe33bf94145bf9b7219d80d3c4b1a8e7bc6ec7bb45cd0db1',
    },
    'nod-desktop-0.1.1-1.arm64.rpm': {
      size: 103208061,
      sha256:
        'dea5e7b74c4f38dca2036b59b12d43daec1cba0205221a19638eee0502a294c0',
    },
    'nod-desktop-0.1.1-1.x86_64.rpm': {
      size: 108903921,
      sha256:
        'dd5c42f20d866133b01e55fd8578ee72cfadae6893a172aeb505a1f31a3fa5d6',
    },
    'nod-desktop_0.1.1_amd64.deb': {
      size: 99376384,
      sha256:
        'bec3b06d212b621280ab0a4002f5bced6e3d3c7783d64c70b880fa6b8630e225',
    },
    'nod-desktop_0.1.1_arm64.deb': {
      size: 93991916,
      sha256:
        '3341425c6b14792d659ff66adfba62ac5e434df121596b5272ddfcfc6c60a532',
    },
    'nod_desktop-0.1.1-full.nupkg': {
      size: 160725180,
      sha256:
        '2785ba4704c291e8d787fa0514362181842f241fb1515f53ba8c36e868ad9054',
    },
  },
};
const desktopSignature =
  '6dALXefbVD/ASRnOi/VuHYyWUHFL8qNtgm+MSEsMMUz58EUXQLF287brD3hLub1EglasF7ZcI1LCmVJa89TxDw==';

function manifestBytes(value: unknown): Uint8Array {
  return bytesOf(`${JSON.stringify(value, null, 2)}\n`);
}

function keyPair() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: toBase64(ed25519.getPublicKey(secretKey)) };
}

describe('verifyManifest', () => {
  it('accepts a manifest the release workflow signed', () => {
    assert.equal(
      verifyManifest(
        manifestBytes(desktopManifest),
        `${desktopSignature}\n`,
        releaseKeysOfTheRepository,
      ),
      true,
    );
  });

  it('rejects the same signature over a changed manifest', () => {
    const changed = { ...desktopManifest, version: '0.1.2' };
    assert.equal(
      verifyManifest(
        manifestBytes(changed),
        desktopSignature,
        releaseKeysOfTheRepository,
      ),
      false,
    );
  });

  it('accepts the next key and rejects a key it was not given', () => {
    const current = keyPair();
    const next = keyPair();
    const bytes = manifestBytes({ version: '1.0.0' });
    const signature = toBase64(ed25519.sign(bytes, next.secretKey));
    assert.equal(
      verifyManifest(
        bytes,
        signature,
        `${current.publicKey},${next.publicKey}`,
      ),
      true,
    );
    assert.equal(verifyManifest(bytes, signature, current.publicKey), false);
  });

  it('rejects malformed signatures and key lists', () => {
    const bytes = manifestBytes(desktopManifest);
    assert.equal(
      verifyManifest(bytes, 'not base64', releaseKeysOfTheRepository),
      false,
    );
    assert.equal(verifyManifest(bytes, desktopSignature, ''), false);
    assert.equal(releaseKeys('a,b,c'), null);
  });
});

describe('parseManifest', () => {
  const files = {
    'Nod-1.2.0.apk': { size: 120, sha256: 'a'.repeat(64) },
  };

  it('reads a manifest whose tag matches the prefix and version', () => {
    const manifest = parseManifest(
      { version: '1.2.0', tag: 'mobile-v1.2.0', files },
      ['mobile-v'],
    );
    assert.equal(manifest?.version, '1.2.0');
    assert.deepEqual(manifest?.files.get('Nod-1.2.0.apk'), {
      size: 120,
      sha256: 'a'.repeat(64),
    });
  });

  it("refuses another app's manifest, a prerelease and a bad file", () => {
    assert.equal(parseManifest(desktopManifest, ['mobile-v']), null);
    assert.equal(
      parseManifest(
        { version: '1.2.0-beta.1', tag: 'mobile-v1.2.0-beta.1', files },
        ['mobile-v'],
      ),
      null,
    );
    assert.equal(
      parseManifest(
        {
          version: '1.2.0',
          tag: 'mobile-v1.2.0',
          files: { '../Nod.apk': { size: 1, sha256: 'a'.repeat(64) } },
        },
        ['mobile-v'],
      ),
      null,
    );
  });
});

describe('newestRelease', () => {
  it('picks the newest published release of the app', () => {
    const releases = [
      { tag_name: 'desktop-v9.0.0', draft: false, prerelease: false },
      { tag_name: 'mobile-v1.9.0', draft: false, prerelease: false },
      { tag_name: 'mobile-v1.10.0', draft: false, prerelease: false },
      { tag_name: 'mobile-v2.0.0', draft: true, prerelease: false },
      { tag_name: 'mobile-v3.0.0', draft: false, prerelease: true },
      { tag_name: 'mobile-v01.0.0', draft: false, prerelease: false },
    ];
    assert.deepEqual(newestRelease(releases, 'mobile-v'), {
      tag: 'mobile-v1.10.0',
      version: '1.10.0',
    });
  });

  it('finds nothing in a list without one', () => {
    assert.equal(
      newestRelease({ message: 'API rate limit exceeded' }, 'mobile-v'),
      null,
    );
    assert.equal(newestRelease([], 'mobile-v'), null);
  });
});
