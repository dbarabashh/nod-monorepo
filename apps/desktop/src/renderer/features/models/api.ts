import type { ModelInfo } from '../../../shared/ipc.ts';

export function listModels(): Promise<ModelInfo[]> {
  return window.api.listModels();
}

export function downloadModel(id: string): Promise<void> {
  return window.api.downloadModel(id);
}

export function cancelModelDownload(id: string): Promise<void> {
  return window.api.cancelModelDownload(id);
}

export function deleteModel(id: string): Promise<void> {
  return window.api.deleteModel(id);
}

export function chooseModel(id: string): Promise<void> {
  return window.api.useModel(id);
}

export function onModelsChanged(
  callback: (models: ModelInfo[]) => void,
): () => void {
  return window.api.onModelsChanged(callback);
}
