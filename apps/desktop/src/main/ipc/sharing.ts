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
  handleFromApp(appUrl, IpcChannel.createTeam, handlers.createTeam);
  handleFromApp(appUrl, IpcChannel.joinTeam, handlers.joinTeam);
  handleFromApp(appUrl, IpcChannel.showTeamInvite, handlers.showTeamInvite);
  handleFromApp(appUrl, IpcChannel.revokeTeamInvite, handlers.revokeTeamInvite);
  handleFromApp(
    appUrl,
    IpcChannel.answerTeamRequest,
    handlers.answerTeamRequest,
  );
  handleFromApp(appUrl, IpcChannel.addTeamMember, handlers.addTeamMember);
  handleFromApp(
    appUrl,
    IpcChannel.setTeamMemberRole,
    handlers.setTeamMemberRole,
  );
  handleFromApp(appUrl, IpcChannel.removeTeamMember, handlers.removeTeamMember);
  handleFromApp(appUrl, IpcChannel.leaveTeam, handlers.leaveTeam);
  handleFromApp(appUrl, IpcChannel.transferTeam, handlers.transferTeam);
  handleFromApp(appUrl, IpcChannel.rotateTeamKey, handlers.rotateTeamKey);
  handleFromApp(appUrl, IpcChannel.showTeamLink, handlers.showTeamLink);
  handleFromApp(appUrl, IpcChannel.addKnownTeam, handlers.addKnownTeam);
  handleFromApp(appUrl, IpcChannel.renameTeam, handlers.renameTeam);
  handleFromApp(appUrl, IpcChannel.nameTeamMember, handlers.nameTeamMember);
}

export function broadcastSharing(controller: SharingController): void {
  broadcast(IpcEvent.onSharingChanged, controller.snapshot());
}
