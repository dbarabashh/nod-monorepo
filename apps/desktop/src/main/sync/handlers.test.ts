import { strict as assert } from 'node:assert';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createMeetingStore } from '../meetings/store.ts';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncController } from './controller.ts';
import { randomKey, recoveryPhrase } from '@nod/core/crypto';
import { openPairingOffer, readPairingCode } from '@nod/core/sync';
import {
  createSyncHandlers,
  type PairingScreen,
  type Question,
  type ListenForPairing,
} from './handlers.ts';
import { createDialogGate } from './dialog-gate.ts';
import { createSyncSettings } from './settings.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

const zeroKeyPhrase = `${'abandon '.repeat(23)}art`;
const zeroKeyCode = '32E2-308C-8391-59D8';

describe('sync handlers', () => {
  const dir = useTempDir('sync-handlers-');

  async function setUp(options: {
    answers?: boolean[];
    confirm?: (question: Question) => Promise<boolean>;
    folder?: string | null;
    relayAnswers?: boolean;
    respond?: () => Response;
    showPairing?: (screen: PairingScreen) => Promise<void>;
    listenForPairing?: ListenForPairing;
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
        if (options.respond) {
          return options.respond();
        }
        if (options.relayAnswers) {
          return new Response(null, { status: 204 });
        }
        throw new Error('no network in this test');
      },
      newId: randomUUID,
      now: () => 1,
      onChange: () => {},
      defaultRelay: null,
    });
    await controller.load();
    const asked: Question[] = [];
    const paired: PairingScreen[] = [];
    const offers: Array<{
      sealed: Uint8Array;
      proofFor: (host: string, port: number) => string;
      confirm: (by: string) => Promise<boolean>;
    }> = [];
    let closedListeners = 0;
    const answers = options.answers ?? [];
    let clock = 0;
    let fetches = 0;
    const shared = join(dir(), 'shared');
    await mkdir(shared, { recursive: true });
    const handlers = createSyncHandlers({
      controller,
      chooseFolder: async () =>
        options.folder === undefined ? shared : options.folder,
      gate: createDialogGate({
        confirm:
          options.confirm ??
          (async (question) => {
            asked.push(question);
            return answers.shift() ?? false;
          }),
        now: () => clock,
      }),
      showPairing:
        options.showPairing ??
        (async (screen) => {
          paired.push(screen);
        }),
      listenForPairing:
        options.listenForPairing ??
        (async ({ sealed, proofFor, confirm }) => {
          offers.push({ sealed, proofFor, confirm });
          return {
            port: 51234,
            hosts: ['192.168.1.20'],
            outcome: Promise.resolve(null),
            close: () => {
              closedListeners += 1;
            },
          };
        }),
      syncSoon: () => {},
    });
    return {
      controller,
      handlers,
      asked,
      paired,
      offers,
      closedListeners: () => closedListeners,
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
    assert.deepEqual(asked[0]?.code, {
      label: 'Vault code',
      value: zeroKeyCode,
    });
    assert.deepEqual(asked[0]?.words, zeroKeyPhrase.split(' '));

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
    assert.deepEqual(asked[0]?.words, controller.recoveryPhrase().split(' '));

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

    assert.deepEqual(asked[1]?.code, {
      label: 'Vault code',
      value: zeroKeyCode,
    });
    assert.equal(asked[1]?.words?.[0], 'abandon');
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

  it('shows a pairing code only once a relay is connected, with its vault code and host', async () => {
    const { handlers, paired, offers, closedListeners, tick } = await setUp({
      answers: [true, true],
      relayAnswers: true,
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await assert.rejects(handlers.showPairingCode(), /Connect a relay/);
    assert.equal(paired.length, 0);

    tick(10_000);
    await handlers.connectSyncRelay('https://relay.example.com');
    await handlers.showPairingCode();

    assert.deepEqual(paired.length, 1);
    assert.equal(paired[0]?.vaultCode, '32E2-308C-8391-59D8');
    assert.equal(paired[0]?.relayHost, 'relay.example.com');
    const code = readPairingCode(paired[0]?.code ?? '');
    assert.equal(code.port, 51234);
    assert.deepEqual(code.hosts, ['192.168.1.20']);
    assert.doesNotMatch(
      paired[0]?.code ?? '',
      /relay|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/,
    );
    assert.equal(
      offers[0]?.proofFor('192.168.1.20', 51234),
      createHmac('sha256', code.secret)
        .update('nod:pair-request:192.168.1.20:51234')
        .digest('hex'),
    );
    const offer = openPairingOffer(
      code.secret,
      offers[0]?.sealed ?? new Uint8Array(),
    );
    assert.deepEqual(
      [...offer.key],
      Array.from({ length: 32 }, () => 0),
    );
    assert.equal(offer.relayUrl, 'https://relay.example.com/');
    assert.equal(closedListeners(), 1);
  });

  it('asks in its own dialog, naming the asking address, before the offer goes out', async () => {
    const { handlers, asked, offers, tick } = await setUp({
      answers: [true, true, false],
      relayAnswers: true,
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    tick(10_000);
    await handlers.connectSyncRelay('https://relay.example.com');
    await handlers.showPairingCode();

    assert.equal(await offers[0]?.confirm('192.168.1.37'), false);

    const question = asked.at(-1);
    assert.equal(question?.message, 'Pair the phone that scanned the code?');
    assert.match(question?.detail ?? '', /192\.168\.1\.37/);
    assert.match(question?.detail ?? '', /Choose Pair on your computer/);
    assert.equal(question?.confirmLabel, 'Pair');
    assert.equal(question?.cancelLabel, 'Don’t pair');
  });

  const decisions: Array<[boolean, string]> = [
    [true, 'offer'],
    [false, 'refusal'],
  ];
  for (const [answer, delivery] of decisions) {
    it(`answers a phone with the ${delivery} chosen after the code window closed, before it stops listening`, async () => {
      const delivered: string[] = [];
      const { handlers, asked, tick } = await setUp({
        answers: [true, true, answer],
        relayAnswers: true,
        listenForPairing: async ({ confirm }) => {
          let closedAt = 'never';
          const outcome = confirm('192.168.1.37').then(
            (allowed) =>
              new Promise<{ by: string } | null>((resolve) => {
                setTimeout(() => {
                  delivered.push(
                    `${allowed ? 'offer' : 'refusal'} before ${closedAt}`,
                  );
                  resolve(allowed ? { by: '192.168.1.37' } : null);
                }, 20);
              }),
          );
          return {
            port: 51234,
            hosts: ['192.168.1.20'],
            outcome,
            close: () => {
              closedAt = 'close';
            },
          };
        },
      });
      await handlers.enterRecoveryPhrase(zeroKeyPhrase);
      tick(10_000);
      await handlers.connectSyncRelay('https://relay.example.com');

      await handlers.showPairingCode();

      assert.deepEqual(delivered, [`${delivery} before never`]);
      assert.equal(asked.at(-1)?.message === 'A phone is paired', answer);
    });
  }

  it('holds sync changes while the code is up, and limits showing it like the phrase', async () => {
    let close = () => {};
    let shown = 0;
    const { handlers, tick } = await setUp({
      answers: [true, true],
      relayAnswers: true,
      showPairing: () => {
        shown += 1;
        return shown === 1
          ? new Promise<void>((resolve) => {
              close = resolve;
            })
          : Promise.resolve();
      },
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await handlers.connectSyncRelay('https://relay.example.com');
    const showing = handlers.showPairingCode();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await assert.rejects(handlers.disconnectSync(), /open question/);
    await assert.rejects(handlers.showRecoveryPhrase(), /open question/);
    tick(10_000);
    close();
    await showing;

    await assert.rejects(handlers.showRecoveryPhrase(), /Wait a moment/);
    await assert.rejects(handlers.showPairingCode(), /Wait a moment/);
    tick(10_000);
    await handlers.showPairingCode();
    assert.equal(shown, 2);
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

  it('says in the phrase dialog how long the relay asked to wait', async () => {
    let status = 204;
    const { handlers, asked } = await setUp({
      answers: [true, true, true],
      respond: () =>
        new Response(null, {
          status,
          headers: status === 429 ? { 'retry-after': '300' } : {},
        }),
    });
    await handlers.enterRecoveryPhrase(zeroKeyPhrase);
    await handlers.connectSyncRelay('https://relay.example.com');

    status = 429;
    await handlers.enterRecoveryPhrase(recoveryPhrase(randomKey()));
    assert.match(
      asked.at(-1)?.detail ?? '',
      /The relay asked this device to wait, so the copies this device put there stay behind until you delete them\. Sync will try again in about 5 minutes\.$/,
    );
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
