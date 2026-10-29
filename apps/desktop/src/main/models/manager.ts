import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { modelSize, type ModelDefinition } from '@nod/core/models';
import type {
  ChosenModels,
  ModelError,
  ModelInfo,
  ModelStatus,
} from '../../shared/ipc.ts';
import {
  ChecksumError,
  downloadFile,
  fileSize,
  partialPath,
  type Fetch,
} from './download.ts';

type Running = {
  controller: AbortController;
  downloadedBytes: number;
  finished: Promise<void>;
};

type Progress = { status: ModelStatus; downloadedBytes: number };

export function downloadError(error: unknown): ModelError {
  if (error instanceof ChecksumError) {
    return 'checksum';
  }
  const code =
    error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOSPC') {
    return 'disk-full';
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return 'not-writable';
  }
  return 'network';
}

export type ModelManager = {
  list: () => Promise<ModelInfo[]>;
  download: (id: string) => Promise<void>;
  cancel: (id: string) => void;
  remove: (id: string) => Promise<void>;
  use: (id: string) => Promise<void>;
  installed: (kind: ModelDefinition['kind']) => Promise<InstalledModel | null>;
};

export type InstalledModel = {
  model: ModelDefinition;
  path: (fileName: string) => string;
};

// Windows and Linux report a little less memory than is installed, as the
// firmware and built-in graphics keep some, so an 8 GB computer counts as one.
const reportedShare = 0.9;

export type ModelChoice = {
  read: () => Promise<ChosenModels>;
  save: (chosen: ChosenModels) => Promise<void>;
};

export function createModelManager(options: {
  catalog: ModelDefinition[];
  directory: string;
  fetch: Fetch;
  memoryBytes: number;
  choice: ModelChoice;
  onChange: (models: ModelInfo[]) => void;
}): ModelManager {
  const { catalog, directory, fetch, memoryBytes, choice, onChange } = options;
  const running = new Map<string, Running>();
  const onDisk = new Map<string, Progress>();
  const errors = new Map<string, ModelError>();
  let chosen: ChosenModels = { speech: null, summary: null };
  const choiceLoaded = choice.read().then(
    (saved) => {
      chosen = saved;
    },
    () => undefined,
  );

  function find(id: string): ModelDefinition {
    const model = catalog.find((candidate) => candidate.id === id);
    if (!model) {
      throw new Error('Unknown model');
    }
    return model;
  }

  function filePath(model: ModelDefinition, name: string): string {
    return path.join(directory, model.id, name);
  }

  async function scan(model: ModelDefinition): Promise<void> {
    const sizes = await Promise.all(
      model.files.map(async (file) => {
        const size = await fileSize(filePath(model, file.name));
        return size === file.sizeBytes
          ? { complete: size, partial: 0 }
          : {
              complete: 0,
              partial: await fileSize(partialPath(filePath(model, file.name))),
            };
      }),
    );
    const complete = sizes.reduce((sum, size) => sum + size.complete, 0);
    const downloadedBytes =
      complete + sizes.reduce((sum, size) => sum + size.partial, 0);
    let status: ModelStatus = 'available';
    if (complete === modelSize(model)) {
      status = 'downloaded';
    } else if (downloadedBytes > 0) {
      status = 'paused';
    }
    onDisk.set(model.id, { status, downloadedBytes });
  }

  function progress(model: ModelDefinition): Progress {
    const active = running.get(model.id);
    if (active) {
      return { status: 'downloading', downloadedBytes: active.downloadedBytes };
    }
    return onDisk.get(model.id) ?? { status: 'available', downloadedBytes: 0 };
  }

  function tooLarge(model: ModelDefinition): boolean {
    return (
      model.kind === 'summary' &&
      memoryBytes < model.minMemoryBytes * reportedShare
    );
  }

  // A model short of memory is used only when chosen: summaries run in the
  // process that transcribes, so running out of memory there loses audio.
  function inUse(kind: ModelDefinition['kind']): ModelDefinition | undefined {
    const ready = catalog.filter(
      (model) =>
        model.kind === kind &&
        !running.has(model.id) &&
        onDisk.get(model.id)?.status === 'downloaded',
    );
    const fitting = ready.filter((model) => !tooLarge(model));
    return (
      ready.find((model) => model.id === chosen[kind]) ??
      fitting.find((model) => model.recommended) ??
      fitting[0]
    );
  }

  function snapshot(): ModelInfo[] {
    const used = new Set(
      [inUse('speech'), inUse('summary')].map((model) => model?.id),
    );
    return catalog.map((model) => ({
      id: model.id,
      kind: model.kind,
      name: model.name,
      description: model.description,
      languages: model.languages,
      license: model.license,
      recommended: model.recommended,
      sizeBytes: modelSize(model),
      error: errors.get(model.id) ?? null,
      inUse: used.has(model.id),
      tooLarge: tooLarge(model),
      ...progress(model),
    }));
  }

  // Broadcasts wait for the saved choice, so they never show the wrong model
  // in use; they stay in order, as each waits on the same promise.
  const changed = () => {
    void choiceLoaded.then(() => onChange(snapshot()));
  };

  async function save(next: ChosenModels): Promise<void> {
    await choice.save(next);
    chosen = next;
    changed();
  }

  async function choose(id: string): Promise<void> {
    const model = find(id);
    await scan(model);
    if (running.has(id) || onDisk.get(id)?.status !== 'downloaded') {
      throw new Error('Model is not downloaded');
    }
    await save({ ...chosen, [model.kind]: id });
  }

  // A deleted model stops being the choice, so downloading it again later
  // doesn't put it back in use unasked.
  async function forget(model: ModelDefinition): Promise<void> {
    if (chosen[model.kind] === model.id) {
      await save({ ...chosen, [model.kind]: null });
    }
  }

  // One choice at a time, so a second one never saves over the first.
  let choosing: Promise<unknown> = choiceLoaded;

  function inTurn(change: () => Promise<void>): Promise<void> {
    const result = choosing.then(change);
    choosing = result.catch(() => undefined);
    return result;
  }

  async function transfer(
    model: ModelDefinition,
    signal: AbortSignal,
    onProgress: (bytes: number) => void,
  ): Promise<void> {
    try {
      await mkdir(path.join(directory, model.id), { recursive: true });
      let done = 0;
      for (const file of model.files) {
        await downloadFile({
          ...file,
          destination: filePath(model, file.name),
          fetch,
          signal,
          onProgress: (bytes) => onProgress(done + bytes),
        });
        done += file.sizeBytes;
      }
    } catch (error) {
      if (!signal.aborted) {
        errors.set(model.id, downloadError(error));
      }
    } finally {
      await scan(model);
      running.delete(model.id);
      changed();
    }
  }

  function download(id: string): Promise<void> {
    const model = find(id);
    const current = running.get(id);
    if (current) {
      return current.controller.signal.aborted
        ? current.finished.then(() => download(id))
        : current.finished;
    }
    errors.delete(id);
    const controller = new AbortController();
    const active: Running = {
      controller,
      downloadedBytes: 0,
      finished: transfer(model, controller.signal, (bytes) => {
        active.downloadedBytes = bytes;
        changed();
      }),
    };
    running.set(id, active);
    changed();
    return active.finished;
  }

  return {
    installed: async (kind) => {
      await Promise.all(
        catalog
          .filter((model) => model.kind === kind && !running.has(model.id))
          .map(scan),
      );
      await choiceLoaded;
      const model = inUse(kind);
      return model
        ? { model, path: (fileName) => filePath(model, fileName) }
        : null;
    },
    list: async () => {
      await Promise.all(
        catalog.filter((model) => !onDisk.has(model.id)).map(scan),
      );
      await choiceLoaded;
      return snapshot();
    },
    use: (id) => inTurn(() => choose(id)),
    download,
    cancel: (id) => running.get(id)?.controller.abort(),
    remove: async (id) => {
      const model = find(id);
      const current = running.get(id);
      current?.controller.abort();
      await current?.finished;
      errors.delete(id);
      await rm(path.join(directory, model.id), {
        recursive: true,
        force: true,
      });
      onDisk.set(id, { status: 'available', downloadedBytes: 0 });
      changed();
      await inTurn(() => forget(model));
    },
  };
}
