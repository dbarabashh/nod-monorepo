import type { MeetingSummary } from '../../../shared/ipc.ts';

export type MeetingStatus = MeetingSummary['status'];

export type Meeting = {
  id: string;
  title: string;
  startedAt: Date;
  durationSeconds: number;
  status: MeetingStatus;
  contentVersion: string;
};
