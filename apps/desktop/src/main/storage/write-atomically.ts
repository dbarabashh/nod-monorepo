import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeAtomically(
  file: string,
  data: Buffer | string,
  mode?: number,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, data, mode === undefined ? undefined : { mode });
  await rename(temporary, file);
}
