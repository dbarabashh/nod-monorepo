import { meetingPath, sharesPath } from './layout.ts';
import { RequestRefused, type Transport } from './transport.ts';

// Takes this device's files out of a vault it leaves: its meetings and its
// shares list. Deletions stay for devices that haven't seen them, so the
// caller passes the ids it still holds. A place from before sharing never
// held a shares list and refuses its path; that is no failure to leave.
export async function removePublishedFiles(
  transport: Transport,
  deviceId: string,
  meetingIds: string[],
): Promise<void> {
  for (const id of meetingIds) {
    await transport.remove(meetingPath(deviceId, id));
  }
  try {
    await transport.remove(sharesPath(deviceId));
  } catch (failure) {
    if (!(failure instanceof RequestRefused && failure.status === 400)) {
      throw failure;
    }
  }
}
