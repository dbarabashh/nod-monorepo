import type { MeetingSummary } from '../../../shared/ipc.ts';

export type MeetingStatus = MeetingSummary['status'];

export type Meeting = {
  id: string;
  title: string;
  startedAt: Date;
  durationSeconds: number;
  folder: string | null;
  status: MeetingStatus;
  contentVersion: string;
};
