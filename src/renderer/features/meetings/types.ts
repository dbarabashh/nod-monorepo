export type MeetingStatus = 'recording' | 'processing' | 'ready';

export type Meeting = {
  id: string;
  title: string;
  startedAt: Date;
  durationSeconds: number;
  status: MeetingStatus;
};
