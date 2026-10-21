import { readFile, stat } from 'node:fs/promises';
import { readMeetingExport } from '@nod/core/meetings';
import type { MeetingImportResult } from '../../shared/ipc.ts';
import type { Recorder } from './recorder.ts';

// An hour of talk is about 50 KB of JSON, so years of meetings fit well
// within this; the cap keeps a wrong file from filling memory while it is
// parsed.
const maxFileBytes = 100 * 1024 * 1024;
const notAnExport =
  'This file isn’t a meetings export. Choose the nod-meetings.json file the previous Nod app saved.';

const unopenable =
  'This file couldn’t be opened. Check that it is still there and try again.';

export function createMeetingImport(options: {
  recorder: Pick<Recorder, 'importMeetings'>;
  chooseFile: () => Promise<string | null>;
}) {
  let running = false;

  async function read(file: string): Promise<unknown> {
    const opened = () => {
      throw new Error(unopenable);
    };
    const { size } = await stat(file).catch(opened);
    if (size > maxFileBytes) {
      throw new Error('This file is too large to be a meetings export.');
    }
    const text = await readFile(file, 'utf8').catch(opened);
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(notAnExport);
    }
  }

  return async (): Promise<MeetingImportResult> => {
    if (running) {
      throw new Error('Meetings are already being imported.');
    }
    running = true;
    try {
      const file = await options.chooseFile();
      if (file === null) {
        return { status: 'cancelled' };
      }
      const parsed = readMeetingExport(await read(file));
      if (!parsed) {
        throw new Error(notAnExport);
      }
      const saved = await options.recorder.importMeetings(parsed.meetings);
      return { status: 'imported', ...saved, skipped: parsed.skipped };
    } finally {
      running = false;
    }
  };
}
