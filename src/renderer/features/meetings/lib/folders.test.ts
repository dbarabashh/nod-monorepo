import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Meeting } from '../types.ts';
import {
  existingFolder,
  cleanFolderName,
  folderCounts,
  matchingFolders,
} from './folders.ts';

function meetingIn(id: string, folder: string | null): Meeting {
  return {
    id,
    title: id,
    startedAt: new Date(0),
    durationSeconds: 0,
    folder,
    status: 'finished',
    contentVersion: '0',
  };
}

describe('folders', () => {
  it('counts the meetings in each folder', () => {
    assert.deepEqual(
      folderCounts(
        [
          meetingIn('a', 'Design'),
          meetingIn('b', 'Code'),
          meetingIn('c', 'Design'),
          meetingIn('d', null),
          meetingIn('e', 'marketing'),
        ],
        'en-US',
      ),
      [
        { name: 'Code', count: 1 },
        { name: 'Design', count: 2 },
        { name: 'marketing', count: 1 },
      ],
    );
  });

  it('cleans a typed folder name the way it will be stored', () => {
    assert.equal(cleanFolderName('  Client \t work\n'), 'Client work');
    assert.equal(cleanFolderName('Cafe\u0301'), 'Caf\u00e9');
  });

  it('finds folders by any part of the name, ignoring case', () => {
    const names = ['Code', 'Design', 'Marketing'];
    assert.deepEqual(matchingFolders(names, ' ign '), ['Design']);
    assert.deepEqual(matchingFolders(names, 'K'), ['Marketing']);
    assert.deepEqual(matchingFolders(names, '  '), names);
  });

  it('reuses a folder whose name only differs in case instead of making a twin', () => {
    const names = ['Code', 'Design'];
    assert.equal(existingFolder(names, ' design '), 'Design');
    assert.equal(
      existingFolder(['Client work'], 'client   work'),
      'Client work',
    );
    assert.equal(existingFolder(['Caf\u00e9'], 'cafe\u0301'), 'Caf\u00e9');
    assert.equal(existingFolder(names, 'Des'), undefined);
  });
});
