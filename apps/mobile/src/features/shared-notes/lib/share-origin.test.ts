import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TeamInfo } from '@nod/core/sharing';
import { isReaderIn, shareOrigin, teamStanding } from './share-origin.ts';

const teamVaultId = '0123456789abcdef0123456789abcdef';
const otherVaultId = 'fedcba9876543210fedcba9876543210';
const peerIdentity = `${teamVaultId}${teamVaultId}`;

function team(vaultId: string, role: TeamInfo['role']): TeamInfo {
  return {
    vaultId,
    name: 'Design',
    host: 'https://relay.example',
    role,
    pending: false,
    members: [],
    invites: [],
    requests: [],
    error: null,
  };
}

const owner = {
  identity: peerIdentity,
  code: 'ABCD-EFGH',
  name: null,
  role: 'owner',
  leaving: false,
} satisfies TeamInfo['members'][number];

describe('shareOrigin', () => {
  it('names a team note by the team and a one-to-one note by the person', () => {
    assert.equal(shareOrigin({ kind: 'team', label: 'Design' }), 'In Design');
    assert.equal(
      shareOrigin({ kind: 'person', label: 'ABCD-EFGH' }),
      'With ABCD-EFGH',
    );
  });
});

describe('teamStanding', () => {
  it('shows a waiting request before any role, then the role', () => {
    assert.equal(
      teamStanding({ role: null, pending: true, members: [] }),
      'Waiting for approval',
    );
    assert.equal(
      teamStanding({ role: 'reader', pending: false, members: [owner] }),
      'Reader',
    );
  });

  it('tells a list not yet checked from one that leaves the person out', () => {
    assert.equal(
      teamStanding({ role: null, pending: false, members: [] }),
      'Checking…',
    );
    assert.equal(
      teamStanding({ role: null, pending: false, members: [owner] }),
      'No access',
    );
  });
});

describe('isReaderIn', () => {
  it('is true only for the team the note is in, and only for a reader', () => {
    const teams = [team(teamVaultId, 'reader'), team(otherVaultId, 'writer')];
    assert.equal(isReaderIn(teams, teamVaultId), true);
    assert.equal(isReaderIn(teams, otherVaultId), false);
    assert.equal(isReaderIn(teams, peerIdentity), false);
    assert.equal(isReaderIn([team(teamVaultId, null)], teamVaultId), false);
  });
});
