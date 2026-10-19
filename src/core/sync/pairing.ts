import {
  isSyncId,
  pairingPath,
  pairingPrefix,
  parsePairingPath,
  type PairingStep,
} from './layout.ts';
import {
  bytesOf,
  commitmentOf,
  createPairingKeys,
  fromBase64,
  grantKey,
  keyLength,
  matchesCommitment,
  open,
  pairingCode,
  seal,
  textOf,
  toBase64,
  type PairingKeys,
} from '../crypto/index.ts';
import type { Transport } from './transport.ts';

export type JoinProgress =
  | { step: 'waiting' }
  | { step: 'confirm'; code: string }
  | { step: 'approving'; code: string }
  | { step: 'joined'; vaultId: string; key: Uint8Array };

export type JoinRequest = { requestId: string; code: string };

export const pairingMaxBytes = 4 * 1024;
const maxOpenRequests = 4;
const unrevealedTtlMs = 10 * 60 * 1000;
const abandonedTtlMs = 24 * 60 * 60 * 1000;

type Checked =
  | { kind: 'waiting' }
  | { kind: 'code'; code: string }
  | { kind: 'step-aside' }
  | { kind: 'abort' };
const steps: PairingStep[] = ['request', 'offer', 'reveal', 'grant'];

function grantContext(requestId: string): string {
  return `nod:grant:${requestId}`;
}

async function readField(
  transport: Transport,
  requestId: string,
  step: PairingStep,
  key: string,
): Promise<string | null> {
  const data = await transport.read(
    pairingPath(requestId, step),
    pairingMaxBytes,
  );
  if (!data) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(textOf(data));
    const value =
      typeof parsed === 'object' && parsed !== null
        ? Reflect.get(parsed, key)
        : null;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function writeField(
  transport: Transport,
  requestId: string,
  step: PairingStep,
  key: string,
  value: string,
) {
  return transport.write(
    pairingPath(requestId, step),
    bytesOf(JSON.stringify({ [key]: value })),
  );
}

// A relay only lets the vault's own devices delete; anything left behind
// expires there on its own.
async function forget(transport: Transport, requestId: string) {
  for (const step of steps) {
    await transport.remove(pairingPath(requestId, step)).catch(() => undefined);
  }
}

function parseGrant(text: string): { vaultId: string; key: Uint8Array } {
  const granted: unknown = JSON.parse(text);
  const field = (name: string) =>
    typeof granted === 'object' && granted !== null
      ? Reflect.get(granted, name)
      : null;
  const vaultId = field('vaultId');
  const encoded = field('key');
  const key = typeof encoded === 'string' ? fromBase64(encoded) : null;
  if (
    typeof vaultId !== 'string' ||
    !isSyncId(vaultId) ||
    key?.length !== keyLength
  ) {
    throw new Error('The other device sent an invalid answer');
  }
  return { vaultId, key };
}

const changed =
  'The request changed while pairing, so it was stopped. Start again.';

// Everything seen from the transport is pinned the first time. A transport
// that swaps a key after the codes were compared can only stop pairing, not
// redirect it.
export function createJoin(transport: Transport, requestId: string) {
  const keys = createPairingKeys();
  let offer: string | null = null;
  let confirmed = false;

  return {
    requestId,
    begin: () =>
      writeField(
        transport,
        requestId,
        'request',
        'commitment',
        commitmentOf(keys.publicKey),
      ),
    poll: async (): Promise<JoinProgress> => {
      const current = await readField(
        transport,
        requestId,
        'offer',
        'publicKey',
      );
      if (!offer) {
        if (!current) {
          return { step: 'waiting' };
        }
        offer = current;
        await writeField(
          transport,
          requestId,
          'reveal',
          'publicKey',
          keys.publicKey,
        );
      } else if (current !== offer) {
        throw new Error(
          current ? changed : 'The other device turned this request down.',
        );
      }
      const code = pairingCode(keys.publicKey, offer);
      if (!confirmed) {
        return { step: 'confirm', code };
      }
      const sealed = await readField(transport, requestId, 'grant', 'sealed');
      if (!sealed) {
        return { step: 'approving', code };
      }
      const granted = parseGrant(
        textOf(
          open(
            grantKey(keys, offer, requestId),
            fromBase64(sealed),
            grantContext(requestId),
          ),
        ),
      );
      await forget(transport, requestId);
      return { step: 'joined', ...granted };
    },
    // The new device only takes a vault after its user saw the same code on
    // both screens; otherwise a transport could hand it a vault of its own.
    confirm: (code: string) => {
      if (!offer || pairingCode(keys.publicKey, offer) !== code) {
        throw new Error('That code is no longer the one shown');
      }
      confirmed = true;
    },
    cancel: () => forget(transport, requestId),
  };
}

export type Join = ReturnType<typeof createJoin>;

type Tracked = {
  keys: PairingKeys;
  commitment: string;
  revealed: string | null;
  since: number;
};

export function createApprover(
  transport: Transport,
  vault: { id: string; key: Uint8Array },
  now: () => number = Date.now,
) {
  const tracked = new Map<string, Tracked>();

  async function requests(): Promise<
    Map<string, { steps: Set<PairingStep>; changedAt: number }>
  > {
    const found = new Map<
      string,
      { steps: Set<PairingStep>; changedAt: number }
    >();
    for (const file of await transport.list(pairingPrefix())) {
      const parsed = parsePairingPath(file.path);
      if (parsed) {
        const known = found.get(parsed.requestId) ?? {
          steps: new Set<PairingStep>(),
          changedAt: 0,
        };
        known.steps.add(parsed.step);
        known.changedAt = Math.max(known.changedAt, file.changedAt);
        found.set(parsed.requestId, known);
      }
    }
    return found;
  }

  async function abort(requestId: string) {
    tracked.delete(requestId);
    await forget(transport, requestId);
  }

  async function check(requestId: string, request: Tracked): Promise<Checked> {
    const commitment = await readField(
      transport,
      requestId,
      'request',
      'commitment',
    );
    const offer = await readField(transport, requestId, 'offer', 'publicKey');
    const revealed = await readField(
      transport,
      requestId,
      'reveal',
      'publicKey',
    );
    // Another device of the vault posting its offer at the same moment can
    // replace this one; that device answers instead, so this one steps aside.
    if (offer !== request.keys.publicKey) {
      return { kind: 'step-aside' };
    }
    if (commitment !== request.commitment) {
      return { kind: 'abort' };
    }
    if (!request.revealed) {
      if (!revealed) {
        return { kind: 'waiting' };
      }
      if (!matchesCommitment(revealed, request.commitment)) {
        return { kind: 'abort' };
      }
      request.revealed = revealed;
    } else if (revealed !== request.revealed) {
      return { kind: 'abort' };
    }
    return {
      kind: 'code',
      code: pairingCode(request.keys.publicKey, request.revealed),
    };
  }

  return {
    pending: async (): Promise<JoinRequest[]> => {
      const present = await requests();
      for (const requestId of tracked.keys()) {
        if (!present.has(requestId)) {
          tracked.delete(requestId);
        }
      }
      const waiting: JoinRequest[] = [];
      for (const [requestId, { steps: files, changedAt }] of present) {
        if (!files.has('request') || files.has('grant')) {
          continue;
        }
        const request = tracked.get(requestId);
        if (!request) {
          // Another device of the vault answered first, or this one did before
          // a restart; either way it isn't this device's to answer. A request
          // nobody touched for a day is cleared, as a relay would.
          if (files.has('offer')) {
            if (now() - changedAt > abandonedTtlMs) {
              await forget(transport, requestId);
            }
            continue;
          }
          if (tracked.size >= maxOpenRequests) {
            continue;
          }
          const commitment = await readField(
            transport,
            requestId,
            'request',
            'commitment',
          );
          if (!commitment) {
            continue;
          }
          const keys = createPairingKeys();
          await writeField(
            transport,
            requestId,
            'offer',
            'publicKey',
            keys.publicKey,
          );
          tracked.set(requestId, {
            keys,
            commitment,
            revealed: null,
            since: now(),
          });
          continue;
        }
        // A request nobody finishes would otherwise hold one of the few slots
        // forever.
        if (!request.revealed && now() - request.since > unrevealedTtlMs) {
          await abort(requestId);
          continue;
        }
        const checked = await check(requestId, request);
        if (checked.kind === 'abort') {
          await abort(requestId);
        } else if (checked.kind === 'step-aside') {
          tracked.delete(requestId);
        } else if (checked.kind === 'code') {
          waiting.push({ requestId, code: checked.code });
        }
      }
      return waiting;
    },
    approve: async (requestId: string, code: string) => {
      const request = tracked.get(requestId);
      const checked = request ? await check(requestId, request) : null;
      if (
        !request?.revealed ||
        checked?.kind !== 'code' ||
        checked.code !== code
      ) {
        if (request) {
          await abort(requestId);
        }
        throw new Error('That request changed or is no longer waiting');
      }
      const sealed = seal(
        grantKey(request.keys, request.revealed, requestId),
        bytesOf(
          JSON.stringify({
            vaultId: vault.id,
            key: toBase64(vault.key),
          }),
        ),
        grantContext(requestId),
      );
      await writeField(
        transport,
        requestId,
        'grant',
        'sealed',
        toBase64(sealed),
      );
      tracked.delete(requestId);
    },
    reject: (requestId: string) => abort(requestId),
  };
}

export type Approver = ReturnType<typeof createApprover>;
