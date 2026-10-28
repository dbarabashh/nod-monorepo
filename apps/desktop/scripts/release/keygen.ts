import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function pair() {
  const keys = generateKeyPairSync('ed25519');
  return {
    publicKey: keys.publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(12)
      .toString('base64'),
    privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
  };
}

// Two pairs: the current key signs releases, the next one waits offline until
// the current one has to be replaced. Installed copies trust both from the
// start, so replacing a key never strands them.
async function generate(directory: string | undefined) {
  if (directory === undefined) {
    throw new Error('Usage: pnpm release:key <empty folder outside the repo>');
  }
  const current = pair();
  const next = pair();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'current.pem'), current.privateKey, {
    mode: 0o600,
    flag: 'wx',
  });
  await writeFile(path.join(directory, 'next.pem'), next.privateKey, {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(
    `NOD_UPDATE_PUBLIC_KEY=${current.publicKey},${next.publicKey}\n\nUPDATE_SIGNING_KEY is ${path.join(directory, 'current.pem')}; keep next.pem offline.`,
  );
}

generate(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
