import { BrowserWindow } from 'electron';
import { IpcChannel, IpcEvent, type ModelInfo } from '../../shared/ipc.ts';
import type { ModelManager } from '../models/manager.ts';
import { handleFromApp } from '../security/sender.ts';

function modelId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Unknown model');
  }
  return value;
}

export function registerModelsIpc(appUrl: string, models: ModelManager): void {
  handleFromApp(appUrl, IpcChannel.listModels, models.list);
  handleFromApp(appUrl, IpcChannel.downloadModel, (id) => {
    void models.download(modelId(id));
  });
  handleFromApp(appUrl, IpcChannel.cancelModelDownload, (id) =>
    models.cancel(modelId(id)),
  );
  handleFromApp(appUrl, IpcChannel.deleteModel, (id) =>
    models.remove(modelId(id)),
  );
}

export function broadcastModels(): (models: ModelInfo[]) => void {
  let latest: ModelInfo[] | null = null;
  return (models) => {
    const scheduled = latest !== null;
    latest = models;
    if (scheduled) {
      return;
    }
    setTimeout(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcEvent.onModelsChanged, latest);
      }
      latest = null;
    }, 200);
  };
}
