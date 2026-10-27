import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { UpdateState } from '../../shared/ipc.ts';
import { releaseKey, type ReleaseKey } from '../testing/release-key.ts';
import { updateFeed } from './feed.ts';
import type { Manifest } from './manifest.ts';
import {
  createUpdater,
  type Squirrel,
  type SquirrelEvent,
  type UpdaterOptions,
} from './updater.ts';

const base = 'https://github.com/owner/repo/releases';
const stable = `${base}/latest/download`;
const api = 'https://api.github.com/repos/owner/repo/releases?per_page=30';
const hash = 'b'.repeat(64);

function fakeSquirrel() {
  const checked: string[] = [];
  let installs = 0;
  let send = (_event: SquirrelEvent) => {};
  const squirrel: Squirrel = {
    check: (url) => checked.push(url),
    install: () => {
      installs += 1;
    },
    listen: (listener) => {
      send = listener;
    },
  };
  return {
    squirrel,
    checked,
    installs: () => installs,
    send: (event: SquirrelEvent) => send(event),
  };
}

type Server = Map<string, Uint8Array>;

function publish(
  server: Server,
  key: ReleaseKey,
  location: string,
  body: unknown,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  server.set(`${location}/latest.json`, bytes);
  server.set(
    `${location}/latest.json.sig`,
    new TextEncoder().encode(key.sign(bytes)),
  );
}

function manifest(version: string, tag = `desktop-v${version}`) {
  return {
    version,
    tag,
    files: { 'RELEASES-darwin-arm64.json': { size: 10, sha256: hash } },
  };
}

function setup(overrides: Partial<UpdaterOptions> = {}) {
  const key = releaseKey();
  const server: Server = new Map();
  publish(server, key, stable, manifest('1.3.0'));
  const fake = fakeSquirrel();
  const states: UpdateState[] = [];
  const timers: Array<{ ms: number; run: () => void }> = [];
  const staged: Manifest[] = [];
  let recording = false;
  let channel: 'stable' | 'test' = 'stable';
  let releases: unknown = [];
  let paused = false;
  let waiting: Array<() => void> = [];
  const updater = createUpdater({
    current: '1.2.0',
    feed: updateFeed(base),
    releaseKeys: key.publicKey,
    unavailable: null,
    squirrel: fake.squirrel,
    stage: async (release) => {
      staged.push(release);
      return `staged:${release.tag}`;
    },
    fetchBytes: async (url) => {
      if (paused) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      const bytes = server.get(url);
      if (!bytes) {
        throw new Error(`404 ${url}`);
      }
      return bytes;
    },
    fetchJson: async (url) => {
      assert.equal(url, api);
      return releases;
    },
    channel: async () => channel,
    automatic: async () => true,
    recording: () => recording,
    now: () => 1000,
    every: (ms, run) => {
      timers.push({ ms, run });
      return () => {};
    },
    later: (ms, run) => {
      timers.push({ ms, run });
      return () => {};
    },
    onChange: (state) => states.push(state),
    ...overrides,
  });
  return {
    updater,
    fake,
    key,
    server,
    states,
    timers,
    staged,
    record: (on: boolean) => {
      recording = on;
    },
    useTestChannel: (list: unknown) => {
      channel = 'test';
      releases = list;
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      for (const resolve of waiting) {
        resolve();
      }
      waiting = [];
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function checkAndStage(updater: { check: () => Promise<void> }) {
  await updater.check();
  await settle();
}

const timeoutOf = (timers: Array<{ ms: number; run: () => void }>) =>
  timers.find((timer) => timer.ms === 1_800_000);

describe('createUpdater', () => {
  it('stages a newer signed release, hands it to Squirrel, then offers to restart', async () => {
    const { updater, fake, staged } = setup();
    await checkAndStage(updater);
    assert.deepEqual(
      staged.map((release) => release.tag),
      ['desktop-v1.3.0'],
    );
    assert.deepEqual(fake.checked, ['staged:desktop-v1.3.0']);
    assert.deepEqual(updater.state(), {
      status: 'downloading',
      version: '1.3.0',
      current: '1.2.0',
      checkedAt: 1000,
    });
    fake.send({ kind: 'downloaded' });
    assert.deepEqual(updater.state(), {
      status: 'ready',
      version: '1.3.0',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('ignores a release that isn’t signed with the release key', async () => {
    const { updater, fake, server } = setup();
    publish(server, releaseKey(), stable, manifest('1.3.0'));
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, []);
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error:
        'The update wasn’t signed with Nod’s release key, so it was ignored.',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('ignores a signed test release served as the latest', async () => {
    const { updater, fake, server, key } = setup();
    publish(server, key, stable, manifest('1.3.0', 'desktop-test-v1.3.0'));
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, []);
    assert.equal(updater.state().status, 'idle');
  });

  it('does nothing when the latest release is the one running', async () => {
    const { updater, fake, server, key } = setup();
    publish(server, key, stable, manifest('1.2.0'));
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, []);
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: null,
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('never hands Squirrel an older release, which it would install', async () => {
    const { updater, fake } = setup({ current: '1.4.0' });
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, []);
  });

  it('finds the newest test release when test versions are on', async () => {
    const { updater, fake, server, key, useTestChannel } = setup();
    publish(
      server,
      key,
      `${base}/download/desktop-test-v1.4.0`,
      manifest('1.4.0', 'desktop-test-v1.4.0'),
    );
    useTestChannel([
      { tag_name: 'desktop-v1.3.0', draft: false },
      { tag_name: 'desktop-test-v1.4.0', draft: false },
    ]);
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, ['staged:desktop-test-v1.4.0']);
    assert.equal(updater.state().status, 'downloading');
  });

  it('falls back to the stable release when GitHub’s API fails', async () => {
    const { updater, fake, useTestChannel } = setup({
      fetchJson: async () => {
        throw new Error('rate limited');
      },
    });
    useTestChannel([]);
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, ['staged:desktop-v1.3.0']);
  });

  it('refuses a test release whose manifest names another tag', async () => {
    const { updater, fake, server, key, useTestChannel } = setup();
    publish(
      server,
      key,
      `${base}/download/desktop-test-v1.4.0`,
      manifest('1.4.0'),
    );
    useTestChannel([{ tag_name: 'desktop-test-v1.4.0', draft: false }]);
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, []);
    assert.equal(updater.state().status, 'idle');
  });

  it('only points Linux at the release page', async () => {
    const { updater } = setup({ squirrel: null, stage: null });
    await checkAndStage(updater);
    assert.deepEqual(updater.state(), {
      status: 'available',
      version: '1.3.0',
      current: '1.2.0',
      checkedAt: 1000,
    });
    assert.equal(updater.releasePage(), `${base}/tag/desktop-v1.3.0`);
  });

  it('reports a feed it can’t read and checks again later', async () => {
    const { updater, server, key } = setup();
    server.clear();
    await checkAndStage(updater);
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: 'Nod couldn’t check for updates.',
      current: '1.2.0',
      checkedAt: 1000,
    });
    publish(server, key, stable, manifest('1.3.0'));
    await checkAndStage(updater);
    assert.equal(updater.state().status, 'downloading');
  });

  it('reports a download that fails its checksum and lets the next check retry', async () => {
    let attempts = 0;
    const { updater, fake } = setup({
      stage: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('checksum');
        }
        return 'staged';
      },
    });
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, []);
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: 'The update couldn’t be downloaded.',
      current: '1.2.0',
      checkedAt: 1000,
    });
    await checkAndStage(updater);
    assert.deepEqual(fake.checked, ['staged']);
  });

  it('goes back to idle when Squirrel fails, so the next check retries', async () => {
    const { updater, fake } = setup();
    await checkAndStage(updater);
    fake.send({ kind: 'error', message: 'signature mismatch' });
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: 'The update couldn’t be downloaded.',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('does not claim to be up to date when Squirrel finds no update the feed promised', async () => {
    const { updater, fake } = setup();
    await checkAndStage(updater);
    fake.send({ kind: 'not-available' });
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: 'The update couldn’t be downloaded.',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('gives up on a download that never finishes, so checks resume', async () => {
    const { updater, timers } = setup();
    await checkAndStage(updater);
    const timeout = timeoutOf(timers);
    assert.ok(timeout);
    timeout.run();
    assert.equal(updater.state().status, 'idle');
    await checkAndStage(updater);
    assert.equal(updater.state().status, 'downloading');
  });

  it('still offers a download that finishes after the timeout', async () => {
    const { updater, fake, timers } = setup();
    await checkAndStage(updater);
    timeoutOf(timers)?.run();
    assert.equal(updater.state().status, 'idle');
    fake.send({ kind: 'downloaded' });
    assert.deepEqual(updater.state(), {
      status: 'ready',
      version: '1.3.0',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('waits for a slow download instead of starting another', async () => {
    const { updater, fake, timers } = setup();
    await checkAndStage(updater);
    timeoutOf(timers)?.run();
    await checkAndStage(updater);
    assert.equal(fake.checked.length, 1);
    assert.equal(updater.state().status, 'downloading');
    fake.send({ kind: 'downloaded' });
    assert.equal(updater.state().status, 'ready');
  });

  it('asks Squirrel again once a download has timed out twice', async () => {
    const { updater, fake, timers } = setup();
    await checkAndStage(updater);
    timeoutOf(timers)?.run();
    await checkAndStage(updater);
    assert.equal(fake.checked.length, 1);
    timers
      .filter((timer) => timer.ms === 1_800_000)
      .at(-1)
      ?.run();
    await checkAndStage(updater);
    assert.equal(fake.checked.length, 2);
  });

  it('keeps an update that finished while the feed was being read', async () => {
    const { updater, fake, timers, pause, resume } = setup();
    await checkAndStage(updater);
    timeoutOf(timers)?.run();
    pause();
    const second = updater.check();
    assert.equal(updater.state().status, 'checking');
    fake.send({ kind: 'downloaded' });
    resume();
    await second;
    assert.equal(updater.state().status, 'ready');
  });

  it('reports Squirrel refusing the feed at once', async () => {
    const { updater } = setup({
      squirrel: {
        check: () => {
          throw new Error('Can not find Squirrel');
        },
        install: () => {},
        listen: () => {},
      },
    });
    await checkAndStage(updater);
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: 'The update couldn’t be downloaded.',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('ignores Squirrel events it did not ask for', async () => {
    const { updater, fake, server, key } = setup();
    publish(server, key, stable, manifest('1.2.0'));
    await checkAndStage(updater);
    fake.send({ kind: 'downloaded' });
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: null,
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('checks once when asked twice at the same time', async () => {
    const { updater, fake, staged } = setup();
    await Promise.all([updater.check(), updater.check()]);
    await settle();
    assert.equal(staged.length, 1);
    assert.equal(fake.checked.length, 1);
  });

  it('reports an install that failed after the restart was asked for', async () => {
    const { updater, fake } = setup();
    await checkAndStage(updater);
    fake.send({ kind: 'downloaded' });
    updater.install();
    fake.send({ kind: 'error', message: 'ShipIt failed' });
    assert.deepEqual(updater.state(), {
      status: 'idle',
      error: 'The update couldn’t be installed.',
      current: '1.2.0',
      checkedAt: 1000,
    });
  });

  it('refuses to restart into the update while a meeting is recorded', async () => {
    const { updater, fake, record } = setup();
    await checkAndStage(updater);
    fake.send({ kind: 'downloaded' });
    record(true);
    assert.throws(() => updater.install(), /Stop recording first/);
    assert.equal(fake.installs(), 0);
    record(false);
    updater.install();
    assert.equal(fake.installs(), 1);
  });

  it('refuses to install before an update is downloaded', async () => {
    const { updater, fake } = setup();
    await checkAndStage(updater);
    assert.throws(() => updater.install(), /No update is ready/);
    assert.equal(fake.installs(), 0);
  });

  it('never checks a build that has no feed', async () => {
    let fetched = false;
    const { updater, timers } = setup({
      feed: null,
      fetchBytes: async () => {
        fetched = true;
        return new Uint8Array();
      },
    });
    updater.start();
    await checkAndStage(updater);
    assert.equal(fetched, false);
    assert.deepEqual(timers, []);
    assert.equal(updater.state().status, 'unavailable');
  });

  it('checks on its own only while automatic checks are on', async () => {
    let automatic = false;
    let checks = 0;
    const { updater, timers } = setup({
      automatic: async () => automatic,
      channel: async () => {
        checks += 1;
        return 'stable';
      },
    });
    updater.start();
    assert.deepEqual(
      timers.map((timer) => timer.ms),
      [60_000, 21_600_000],
    );
    for (const timer of timers) {
      timer.run();
    }
    await settle();
    assert.equal(checks, 0);
    automatic = true;
    timers[1]?.run();
    await settle();
    assert.equal(checks, 1);
  });
});
