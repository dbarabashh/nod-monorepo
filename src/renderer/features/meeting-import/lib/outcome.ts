import type { MeetingImportResult } from '../../../../shared/ipc.ts';
import { meetingCount } from '../../../lib/meeting-count.ts';

type Imported = Extract<MeetingImportResult, { status: 'imported' }>;

export function importOutcome(result: Imported): string {
  const { added, present, failed, skipped } = result;
  const parts = [
    added > 0
      ? `Imported ${meetingCount(added)}.`
      : present + failed + skipped > 0
        ? 'No new meetings were imported.'
        : 'The file has no meetings in it.',
  ];
  if (present > 0) {
    parts.push(
      `${meetingCount(present)} ${present === 1 ? 'was' : 'were'} already here.`,
    );
  }
  if (skipped > 0) {
    parts.push(
      `${meetingCount(skipped)} in the file couldn’t be read and ${skipped === 1 ? 'was' : 'were'} left out.`,
    );
  }
  if (failed > 0) {
    parts.push(
      `${meetingCount(failed)} couldn’t be saved. Import the file again to try them again.`,
    );
  }
  return parts.join(' ');
}
