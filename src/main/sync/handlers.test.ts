import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createMeetingStore } from '../meetings/store.ts';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncController } from './controller.ts';
import { createSyncHandlers, type Question } from './handlers.ts';
import { createSyncSettings } from './settings.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

const zeroKeyPhrase = `${'abandon '.repeat(23)}art`;
const zeroKeyCode = 'Vault code 32E2-308C-8391-59D8';

describe('sync handlers', () => {
  const dir = useTempDir('sync-handlers-');

  async function setUp(options: {
    answers?: boolean[];
    confirm?: (question: Question) => Promise<boolean>;
    folder?: string | null;
  }) {
    const store = createMeetingStore({
      directory: join(dir(), 'meetings'),
      cipher: async () => ({
        encrypt: (plain) => Buffer.from(plain),
        decrypt: (data) => data,
      }),
    });
    await store.load();
    const controller = createSyncController({
      settings: createSyncSettings({ directory: dir(), keychain: reversing }),
      store,
      onRemote: () => {},
      fetch: async () => {
        fetches += 1;
        throw new Error('no network in this test');
      },
      newId: randomUUID,
      now: () => 1,
      onChange: () => {},
      defaultRelay: null,
    });
    await controller.load();
    const asked: Question[] = [];
    const answers = options.answers ?? [];
    let clock = 0;
    let fetches = 0;
    const shared = join(dir(), 'shared');
    await mkdir(shared, { recursive: true });
    const handlers = createSyncHandlers({
      controller,
      chooseFolder: async () =>
        options.folder === undefined ? shared : options.folder,
      confirm:
        options.confirm ??
        (async (question) => {
          asked.push(question);
          return answers.shift() ?? false;
        }),
      syncSoon: () => {},
      now: () => clock,
    });
    return {
      controller,
      handlers,
      asked,
      shared,
      fetches: () => fetches,
      tick: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('puts a phrase on the device only after the user checks its words and vault code', async () => {
    const { controller, handlers, asked, tick } = await setUp({
      answers: [false, true],
    });

    assert.equal(await handlers.enterRecoveryPhrase(zeroKeyPhrase), false);
    assert.equal(controller.state().status, 'none');
    const detail = asked[0]?.detail ?? '';
    assert.match(detail, new RegExp(`^${zeroKeyCode}\n\n1\\. abandon`));
    assert.match(detail, /22\. abandon {4}23\. abandon {4}24\. art/);

    tick(10_000);
    assert.equal(await handlers.enterRecoveryPhrase(zeroKeyPhrase), true);
    assert.equal(controller.recoveryPhrase(), zeroKeyPhrase);
  });

  it('shows the phrase only in its own dialog, and records it written down only from there', async () => {
    const { controller, handlers, asked, tick } = await setUp({
      answers: [false, true, true],
    });
    await handlers.createRecoveryPhrase();

    assert.equal(await handlers.showRecoveryPhrase(), false);
    await assert.rejects(handlers.showRecoveryPhrase(), /showing the phrase/);
    tick(10_000);
    let state = controller.state();
    assert.equal(state.status === 'ready' && state.recoveryConfirmed, false);
    assert.equal(asked[0]?.cancelLabel, 'Later');
    assert.match(
      asked[0]?.detail ?? '',
      new RegExp(`1\\. ${controller.recoveryPhrase().split(' ')[0]}`),
    );

    assert.equal(await handlers.showRecoveryPhrase(), true);
    state = controller.state();
    assert.equal(state.status === 'ready' && state.recoveryConfirmed, true);

    tick(10_000);
    assert.equal(await handlers.showRecoveryPhrase(), false);
    assert.equal(asked[2]?.confirmLabel, 'Done');
    assert.equal(asked[2]?.cancelLabel, null);
  });

  it('waits longer after each Cancel, so one click at a time can’t wear the user down', async () => {
    const { handlers, asked, tick } = await setUp({});
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);

    tick(9_999);
    await assert.rejects(
      handlers.enterRecoveryPhrase(zeroKeyPhrase),
      /Wait a moment/,
    );
    await assert.rejects(
      handlers.connectSyncRelay('https://relay.example.com'),
      /Wait a moment/,
    );
    tick(1);
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    tick(19_999);
    await assert.rejects(handlers.disconnectSync(), /Wait a moment/);
    tick(1);
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    assert.equal(asked.length, 3);
  });

  it('shows the vault code main derives from the key, next to the words', async () => {
    const { handlers, asked, tick } = await setUp({ answers: [true, true] });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    tick(10_000);

    await handlers.showRecoveryPhrase();

    assert.match(
      asked[1]?.detail ?? '',
      new RegExp(`^${zeroKeyCode}\n\n1\\. abandon`),
    );
  });

  it('keeps the growing wait when the user only looks at the phrase', async () => {
    const { handlers, tick } = await setUp({ answers: [true, false, true] });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await handlers.connectSyncRelay('https://relay.example.com');
    tick(10_000);
    await handlers.showRecoveryPhrase();
    await handlers
      .connectSyncRelay('https://relay.example.com')
      .catch(() => undefined);
    tick(10_000);
    await assert.rejects(
      handlers.connectSyncRelay('https://relay.example.com'),
      /Wait a moment/,
    );
  });

  it('counts a cancelled folder picker as a Cancel', async () => {
    const { handlers, tick } = await setUp({ folder: null, answers: [] });
    tick(0);
    await handlers.chooseSyncFolder();
    await assert.rejects(handlers.chooseSyncFolder(), /Wait a moment/);
  });

  it('changes nothing else while a question is open', async () => {
    let answer = (_yes: boolean) => {};
    const { controller, handlers } = await setUp({
      confirm: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    const first = handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await assert.rejects(handlers.createRecoveryPhrase(), /open question/);
    await assert.rejects(handlers.chooseSyncFolder(), /open question/);
    await assert.rejects(handlers.disconnectSync(), /open question/);
    await assert.rejects(handlers.showRecoveryPhrase(), /open question/);
    await assert.rejects(
      handlers.enterRecoveryPhrase(zeroKeyPhrase),
      /open question/,
    );
    answer(true);
    assert.equal(await first, true);
    assert.equal(controller.state().status, 'ready');
  });

  it('connects a relay only after the user confirms its host', async () => {
    const { controller, handlers, asked, fetches } = await setUp({
      answers: [true, false],
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await assert.rejects(
      handlers.connectSyncRelay('https://relay.example.com/?words=secret'),
      /without a login/,
    );
    await assert.rejects(
      handlers.connectSyncRelay(
        'https://relay.example.com/U2hpcCBpdCBvbiBGcmlkYXk=',
      ),
      /short, plain path/,
    );

    await handlers.connectSyncRelay('https://relay.example.com');

    assert.equal(asked[1]?.message, 'Sync through relay.example.com?');
    assert.equal(fetches(), 0);
    const state = controller.state();
    assert.equal(state.status === 'ready' && state.transport, null);
  });

  it('stops syncing only after the user confirms', async () => {
    const { controller, handlers, shared } = await setUp({
      answers: [true, false],
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await handlers.chooseSyncFolder();

    await handlers.disconnectSync();

    const state = controller.state();
    assert.deepEqual(state.status === 'ready' && state.transport, {
      kind: 'folder',
      folder: shared,
    });
  });

  it('changes the recovery phrase only after the user confirms', async () => {
    const { controller, handlers, asked, tick } = await setUp({
      answers: [true, false, true],
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);

    await handlers.changeRecoveryPhrase();
    assert.equal(asked[1]?.message, 'Change your recovery phrase?');
    assert.equal(controller.recoveryPhrase(), zeroKeyPhrase);

    tick(10_000);
    await handlers.changeRecoveryPhrase();
    assert.notEqual(controller.recoveryPhrase(), zeroKeyPhrase);
  });

  it('changes the phrase while the place can’t be reached only after a second yes', async () => {
    const { controller, handlers, asked, tick } = await setUp({
      answers: [true, true, false, true, true],
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await handlers.chooseSyncFolder();
    await rm(join(dir(), 'shared'), { recursive: true });

    await assert.rejects(handlers.changeRecoveryPhrase(), /can’t be found/);
    assert.equal(asked.at(-1)?.message, 'Change the phrase anyway?');
    assert.equal(controller.recoveryPhrase(), zeroKeyPhrase);

    tick(60_000);
    await handlers.changeRecoveryPhrase();
    assert.equal(asked.at(-1)?.message, 'Change the phrase anyway?');
    assert.notEqual(controller.recoveryPhrase(), zeroKeyPhrase);
  });
});
