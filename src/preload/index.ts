import { contextBridge } from 'electron';
import type { AppApi } from '../shared/ipc.ts';

const api: AppApi = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
