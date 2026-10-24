import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cleanSharingState } from './clean-state.ts';

describe('cleanSharingState', () => {
  it('takes hidden characters out of every name another person chose', () => {
    const cleaned = cleanSharingState({
      status: 'ready',
      code: 'AAAA-BBBB-CCCC-DDDD-EEEE',
      peers: [],
      error: 'Road\u202Emap wasn’t handed to the new phrase',
      teams: [
        {
          vaultId: 'v'.repeat(32),
          name: 'Road‮map',
          host: 'https://relay.test/',
          role: 'writer',
          pending: false,
          members: [
            {
              identity: 'a'.repeat(64),
              code: 'AAAA-BBBB-CCCC-DDDD-EEEE',
              name: '​',
              role: 'owner',
              leaving: false,
            },
            {
              identity: 'b'.repeat(64),
              code: 'BBBB-BBBB-CCCC-DDDD-EEEE',
              name: 'Sam⁦',
              role: 'writer',
              leaving: false,
            },
          ],
          invites: [],
          error: 'The list of Road\u2067map can’t be read',
          requests: [
            {
              id: 'r'.repeat(64),
              identity: 'c'.repeat(64),
              code: 'CCCC-BBBB-CCCC-DDDD-EEEE',
              name: 'Eve\n\nOwner',
              role: 'reader',
            },
          ],
        },
      ],
      notes: [
        {
          id: 'n1',
          title: 'Plan‮',
          sharedAt: 1,
          target: 'v'.repeat(32),
          kind: 'team',
          label: 'Road‮map',
        },
      ],
    });
    assert.equal(cleaned.status, 'ready');
    if (cleaned.status !== 'ready') {
      return;
    }
    const [team] = cleaned.teams;
    assert.equal(team?.name, 'Roadmap');
    assert.deepEqual(
      team?.members.map((member) => member.name),
      [null, 'Sam'],
    );
    assert.equal(team?.requests[0]?.name, 'Eve Owner');
    assert.equal(team?.error, 'The list of Roadmap can’t be read');
    assert.equal(cleaned.error, 'Roadmap wasn’t handed to the new phrase');
    assert.deepEqual(
      cleaned.notes.map((note) => [note.title, note.label]),
      [['Plan', 'Roadmap']],
    );
  });
});
