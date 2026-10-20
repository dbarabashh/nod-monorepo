import { readFile } from 'node:fs/promises';
import type { AppState } from '../../shared/ipc.ts';
import { writeAtomically } from '../storage/write-atomically.ts';
import { defaultAppState, parseAppState } from './app-state.ts';

// A function is applied to the state as saved at its turn, so changes that
// build on the current state never undo each other.
type AppStateChange =
  | Partial<AppState>
  | ((state: AppState) => Partial<AppState>);

export type AppStateStore = {
  read: () => Promise<AppState>;
  update: (change: AppStateChange) => Promise<AppState>;
};

export function createAppStateStore(
  file: string,
  onChange: (state: AppState) => void = () => {},
): AppStateStore {
  async function read(): Promise<AppState> {
    try {
      return parseAppState(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      return defaultAppState;
    }
  }

  async function write(change: AppStateChange): Promise<AppState> {
    const current = await read();
    const next = {
      ...current,
      ...(typeof change === 'function' ? change(current) : change),
    };
    await writeAtomically(file, JSON.stringify(next));
    onChange(next);
    return next;
  }

  let pending: Promise<unknown> = Promise.resolve();

  function update(change: AppStateChange): Promise<AppState> {
    const result = pending.then(() => write(change));
    pending = result.catch(() => undefined);
    return result;
  }

  return { read, update };
}
