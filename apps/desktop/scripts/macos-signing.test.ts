import { strict as assert } from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  entitlementsFor,
  isBundleExecutable,
  signingOrder,
} from './macos-signing.ts';

const app = '/out/Nod-darwin-arm64/Nod.app';
const frameworks = `${app}/Contents/Frameworks`;
const plist = (file: string) => path.basename(entitlementsFor(file));

describe('entitlementsFor', () => {
  it('gives the app its own entitlements and each helper only what it needs', () => {
    assert.equal(plist(app), 'entitlements.mac.plist');
    assert.equal(
      plist(`${frameworks}/Nod Helper.app`),
      'entitlements.helper.plist',
    );
    assert.equal(
      plist(`${frameworks}/Nod Helper (GPU).app`),
      'entitlements.jit.plist',
    );
    assert.equal(
      plist(`${frameworks}/Nod Helper (Renderer).app`),
      'entitlements.jit.plist',
    );
    assert.equal(
      plist(`${frameworks}/Nod Helper (Plugin).app`),
      'entitlements.plugin.plist',
    );
  });

  it('gives everything else none', () => {
    for (const file of [
      `${app}/Contents/Resources/nod-mic-monitor`,
      `${frameworks}/Electron Framework.framework`,
      `${frameworks}/Squirrel.framework/Versions/A/Resources/ShipIt`,
      `${app}/Contents/Resources/app.asar.unpacked/node_modules/@fugood/node-whisper-darwin-arm64/index.node`,
    ]) {
      assert.equal(plist(file), 'entitlements.none.plist', file);
    }
  });
});

describe('isBundleExecutable', () => {
  it('tells a bundle’s own executable from nested code', () => {
    assert.equal(isBundleExecutable(`${app}/Contents/MacOS/Nod`), true);
    assert.equal(
      isBundleExecutable(
        `${frameworks}/Electron Framework.framework/Versions/A/Electron Framework`,
      ),
      true,
    );
    assert.equal(
      isBundleExecutable(
        `${frameworks}/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`,
      ),
      false,
    );
    assert.equal(
      isBundleExecutable(`${app}/Contents/Resources/nod-mic-monitor`),
      false,
    );
  });
});

describe('signingOrder', () => {
  it('signs nested code before the bundles that hold it', () => {
    const order = signingOrder([
      { path: app, bundle: true },
      { path: `${frameworks}/Nod Helper.app`, bundle: true },
      { path: `${app}/Contents/Resources/nod-mic-monitor`, bundle: false },
      {
        path: `${frameworks}/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`,
        bundle: false,
      },
      { path: `${frameworks}/Electron Framework.framework`, bundle: true },
      { path: `${frameworks}/Foo`, bundle: false },
    ]).map((item) => item.path.slice(app.length) || 'Nod.app');
    assert.deepEqual(order, [
      '/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
      '/Contents/Resources/nod-mic-monitor',
      '/Contents/Frameworks/Foo',
      '/Contents/Frameworks/Nod Helper.app',
      '/Contents/Frameworks/Electron Framework.framework',
      'Nod.app',
    ]);
  });
});
