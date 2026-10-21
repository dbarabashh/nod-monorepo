import { releaseInfo, use } from '@automerge/automerge';
import { createBackend } from '../backend.ts';
import { loadWasmCore } from './wasm-core.ts';

use(createBackend(loadWasmCore()));

if (releaseInfo().wasm?.cargoPackageName !== 'nod-automerge') {
  throw new Error('the native Automerge backend did not take over');
}
