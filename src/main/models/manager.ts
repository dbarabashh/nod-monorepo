import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { modelSize, type ModelDefinition } from '../../core/models/index.ts';
import type { ModelError, ModelInfo, ModelStatus } from '../../shared/ipc.ts';
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
};

export function createModelManager(options: {
  catalog: ModelDefinition[];
  directory: string;
  fetch: Fetch;
  onChange: (models: ModelInfo[]) => void;
}): ModelManager {
  const { catalog, directory, fetch, onChange } = options;
  const running = new Map<string, Running>();
  const onDisk = new Map<string, Progress>();
  const errors = new Map<string, ModelError>();

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

  function snapshot(): ModelInfo[] {
    return catalog.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      languages: model.languages,
      license: model.license,
      recommended: model.recommended,
      sizeBytes: modelSize(model),
      error: errors.get(model.id) ?? null,
      ...progress(model),
    }));
  }

  const changed = () => onChange(snapshot());

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
    list: async () => {
      await Promise.all(
        catalog.filter((model) => !onDisk.has(model.id)).map(scan),
      );
      return snapshot();
    },
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
    },
  };
}
