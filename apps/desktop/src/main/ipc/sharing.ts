import { IpcChannel, IpcEvent } from '../../shared/ipc.ts';
import { broadcast, handleFromApp } from '../security/sender.ts';
import type { SharingController } from '../sharing/controller.ts';
import type { createSharingHandlers } from '../sharing/handlers.ts';

export function registerSharingIpc(
  appUrl: string,
  handlers: ReturnType<typeof createSharingHandlers>,
): void {
  handleFromApp(appUrl, IpcChannel.getSharingState, handlers.getSharingState);
  handleFromApp(appUrl, IpcChannel.showIdentityCard, handlers.showIdentityCard);
  handleFromApp(appUrl, IpcChannel.addSharingPeer, handlers.addSharingPeer);
  handleFromApp(appUrl, IpcChannel.stopSharingPeer, handlers.stopSharingPeer);
  handleFromApp(appUrl, IpcChannel.shareMeeting, handlers.shareMeeting);
  handleFromApp(appUrl, IpcChannel.getSharedNote, handlers.getSharedNote);
  handleFromApp(appUrl, IpcChannel.editSharedNote, handlers.editSharedNote);
  handleFromApp(appUrl, IpcChannel.deleteSharedNote, handlers.deleteSharedNote);
}

export function broadcastSharing(controller: SharingController): void {
  broadcast(IpcEvent.onSharingChanged, controller.snapshot());
}
