import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TeamInfo } from '../../shared/ipc.ts';
import { shareTargetsOf } from './share-targets.ts';

const code = 'ABCD-EF01-2345-6789-ABCD';

function team(overrides: Partial<TeamInfo>): TeamInfo {
  return {
    vaultId: 'v'.repeat(32),
    name: 'Roadmap',
    host: 'https://relay.test/',
    role: 'writer',
    pending: false,
    members: [],
    invites: [],
    requests: [],
    error: null,
    ...overrides,
  };
}

describe('shareTargetsOf', () => {
  it('marks every team as a team, so one named like a code can’t pass for a person', () => {
    const { targets } = shareTargetsOf({
      status: 'ready',
      code,
      error: null,
      notes: [],
      peers: [
        { identity: 'a'.repeat(64), code, stoppedAt: null },
        { identity: 'b'.repeat(64), code: 'gone', stoppedAt: 3 },
      ],
      teams: [
        team({ vaultId: 't'.repeat(32), name: code }),
        team({ name: '' }),
      ],
    });
    assert.deepEqual(
      targets.map((target) => [target.kind, target.label]),
      [
        ['person', code],
        ['team', `Team “${code}”`],
        ['team', 'Team “Unnamed team”'],
      ],
    );
  });

  it('offers only teams this person writes in, but knows every team they are in', () => {
    const { targets, known } = shareTargetsOf({
      status: 'ready',
      code,
      error: null,
      notes: [],
      peers: [],
      teams: [
        team({ vaultId: 'r'.repeat(32), name: 'Readers', role: 'reader' }),
        team({ vaultId: 'p'.repeat(32), name: 'Asked', pending: true }),
        team({ vaultId: 'w'.repeat(32), name: 'Writers' }),
      ],
    });
    assert.deepEqual(
      targets.map((target) => target.name),
      ['Writers'],
    );
    assert.deepEqual(
      known.map((target) => target.name),
      ['Readers', 'Writers'],
    );
  });
});
