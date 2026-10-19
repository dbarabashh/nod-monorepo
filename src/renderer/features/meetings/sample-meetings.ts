import type { Meeting } from './types.ts';

function at(daysAgo: number, hour: number, minute: number, now: Date): Date {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysAgo,
    hour,
    minute,
  );
}

export function sampleMeetings(now: Date): Meeting[] {
  return [
    {
      id: 'm1',
      title: 'Product sync',
      startedAt: at(0, 10, 0, now),
      durationSeconds: 47 * 60,
      status: 'recording',
    },
    {
      id: 'm2',
      title: 'Design review: onboarding',
      startedAt: at(0, 8, 30, now),
      durationSeconds: 32 * 60,
      status: 'processing',
    },
    {
      id: 'm3',
      title: 'Customer call',
      startedAt: at(1, 16, 0, now),
      durationSeconds: 58 * 60,
      status: 'ready',
    },
    {
      id: 'm4',
      title: 'Hiring debrief',
      startedAt: at(1, 11, 15, now),
      durationSeconds: 25 * 60,
      status: 'ready',
    },
    {
      id: 'm5',
      title: 'Sprint planning',
      startedAt: at(3, 9, 0, now),
      durationSeconds: 75 * 60,
      status: 'ready',
    },
    {
      id: 'm6',
      title: 'Voice note',
      startedAt: at(4, 19, 40, now),
      durationSeconds: 3 * 60,
      status: 'ready',
    },
    {
      id: 'm7',
      title: 'Quarterly roadmap',
      startedAt: at(9, 14, 0, now),
      durationSeconds: 2 * 3600,
      status: 'ready',
    },
  ];
}
