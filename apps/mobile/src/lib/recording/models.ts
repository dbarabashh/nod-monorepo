import { File } from 'expo-file-system';
import {
  modelSize,
  phoneSpeechModels,
  type ModelFile,
  type SpeechModel,
} from '@nod/core/models';
import { FileDigest } from '../../../modules/file-digest/index.ts';
import { messageOf } from '../message-of.ts';
import { ensureDirectory, modelsDirectory } from '../storage.ts';

export type ModelState =
  | { status: 'missing' }
  | { status: 'downloading'; progress: number }
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'failed'; error: string };

export type ModelEntry = { model: SpeechModel; state: ModelState };

const directory = modelsDirectory();
const fileOf = (file: ModelFile) => new File(directory, file.name);

// A file was checked when it was moved in, so its size says it is whole.
function installed(model: SpeechModel): boolean {
  return model.files.every((file) => {
    const target = fileOf(file);
    return target.exists && target.size === file.sizeBytes;
  });
}

// Moved into place only after its size and sha256 match the pinned catalog,
// so a model that wasn't verified is never loaded.
async function fetchFile(
  file: ModelFile,
  onBytes: (bytes: number) => void,
  onChecking: () => void,
  signal: AbortSignal,
): Promise<void> {
  const target = fileOf(file);
  if (target.exists && target.size === file.sizeBytes) {
    onBytes(file.sizeBytes);
    return;
  }
  await ensureDirectory(directory);
  const partial = new File(directory, `${file.name}.partial`);
  await File.downloadFileAsync(file.url, partial, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten }) => onBytes(bytesWritten),
  });
  onChecking();
  const whole = partial.size === file.sizeBytes;
  if (!whole || (await FileDigest.sha256(partial.uri)) !== file.sha256) {
    partial.delete();
    throw new Error(`${file.name} didn’t match what was expected. Try again.`);
  }
  await partial.move(target, { overwrite: true });
}

const listeners = new Set<() => void>();
const states = new Map<string, ModelState>();
const downloads = new Map<string, AbortController>();
let snapshot: ModelEntry[] = [];

function publish() {
  snapshot = phoneSpeechModels.map((model) => ({
    model,
    state:
      states.get(model.id) ??
      (installed(model) ? { status: 'ready' } : { status: 'missing' }),
  }));
  for (const listener of listeners) {
    listener();
  }
}

function set(id: string, state: ModelState | null) {
  if (state) {
    states.set(id, state);
  } else {
    states.delete(id);
  }
  publish();
}

export function subscribeModels(listener: () => void): () => void {
  if (snapshot.length === 0) {
    publish();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function modelEntries(): ModelEntry[] {
  if (snapshot.length === 0) {
    publish();
  }
  return snapshot;
}

// The one recording uses: the first installed in the catalog's order, which
// puts the recommended model first.
export function installedModel(): SpeechModel | null {
  return phoneSpeechModels.find(installed) ?? null;
}

export function modelPath(model: SpeechModel, kind: 'speech' | 'vad'): string {
  const file =
    kind === 'vad'
      ? model.files.find((entry) => entry.name.startsWith('ggml-silero'))
      : model.files.find((entry) => !entry.name.startsWith('ggml-silero'));
  if (!file) {
    throw new Error(`${model.name} has no ${kind} file`);
  }
  return fileOf(file).uri;
}

export async function downloadModel(id: string): Promise<void> {
  const model = phoneSpeechModels.find((entry) => entry.id === id);
  if (!model || downloads.has(id)) {
    return;
  }
  const controller = new AbortController();
  downloads.set(id, controller);
  const total = modelSize(model);
  let done = 0;
  set(id, { status: 'downloading', progress: 0 });
  try {
    for (const file of model.files) {
      await fetchFile(
        file,
        (bytes) =>
          set(id, {
            status: 'downloading',
            progress: Math.min((done + bytes) / total, 1),
          }),
        () => set(id, { status: 'checking' }),
        controller.signal,
      );
      done += file.sizeBytes;
    }
    set(id, null);
  } catch (failure) {
    // A download cut short is hundreds of megabytes nothing will use.
    for (const file of model.files) {
      const partial = new File(directory, `${file.name}.partial`);
      if (partial.exists) {
        partial.delete();
      }
    }
    set(
      id,
      controller.signal.aborted
        ? null
        : { status: 'failed', error: messageOf(failure) },
    );
  } finally {
    downloads.delete(id);
  }
}

export function cancelDownload(id: string): void {
  downloads.get(id)?.abort();
}

export function deleteModel(id: string): void {
  cancelDownload(id);
  const model = phoneSpeechModels.find((entry) => entry.id === id);
  // The voice activity model is shared, so it stays while another model has
  // it or is downloading it.
  const others = phoneSpeechModels.filter(
    (entry) => entry.id !== id && (installed(entry) || downloads.has(entry.id)),
  );
  for (const file of model?.files ?? []) {
    const shared = others.some((entry) =>
      entry.files.some((other) => other.name === file.name),
    );
    const target = fileOf(file);
    if (!shared && target.exists) {
      target.delete();
    }
  }
  set(id, null);
}
