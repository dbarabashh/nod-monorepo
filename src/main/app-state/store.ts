import { readFile, rename, writeFile } from 'node:fs/promises';
import type { AppState } from '../../shared/ipc.ts';
import { defaultAppState, parseAppState } from './app-state.ts';

export type AppStateStore = {
  read: () => Promise<AppState>;
  update: (change: Partial<AppState>) => Promise<AppState>;
};

export function createAppStateStore(file: string): AppStateStore {
  async function read(): Promise<AppState> {
    try {
      return parseAppState(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      return defaultAppState;
    }
  }

  async function write(change: Partial<AppState>): Promise<AppState> {
    const next = { ...(await read()), ...change };
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify(next), 'utf8');
    await rename(temporary, file);
    return next;
  }

  let pending: Promise<unknown> = Promise.resolve();

  function update(change: Partial<AppState>): Promise<AppState> {
    const result = pending.then(() => write(change));
    pending = result.catch(() => undefined);
    return result;
  }

  return { read, update };
}
