import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { keyLength, randomKey } from '@nod/core/crypto';

export type KeyWrap = {
  wrap: (plain: string) => Buffer;
  unwrap: (data: Buffer) => string;
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// The key that encrypts local files is itself kept encrypted by the OS
// keychain. A new key is only made when nothing exists that the old one
// encrypted, so a lost key file never silently orphans saved meetings.
export async function loadDataKey(
  file: string,
  keychain: KeyWrap,
  hasEncryptedData: () => Promise<boolean>,
): Promise<Buffer> {
  try {
    const key = Buffer.from(keychain.unwrap(await readFile(file)), 'base64');
    if (key.length !== keyLength) {
      throw new Error('The data key is damaged');
    }
    return key;
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  if (await hasEncryptedData()) {
    throw new Error('The key for saved meetings is missing');
  }
  const key = Buffer.from(randomKey());
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, keychain.wrap(key.toString('base64')));
  await rename(temporary, file);
  return key;
}
