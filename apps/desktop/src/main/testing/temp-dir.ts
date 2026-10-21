import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'node:test';

export function useTempDir(prefix: string): () => string {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), prefix));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return () => dir;
}
