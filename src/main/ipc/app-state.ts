import { IpcChannel } from '../../shared/ipc.ts';
import type { AppStateStore } from '../app-state/store.ts';
import { handleFromApp } from '../security/sender.ts';

export function registerAppStateIpc(
  appUrl: string,
  store: AppStateStore,
): void {
  handleFromApp(appUrl, IpcChannel.getAppState, store.read);
  handleFromApp(appUrl, IpcChannel.completeOnboarding, () =>
    store.update({ onboardingCompleted: true }),
  );
  handleFromApp(appUrl, IpcChannel.setSuggestMeetings, (enabled) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Expected on or off');
    }
    return store.update({ suggestMeetings: enabled });
  });
  handleFromApp(appUrl, IpcChannel.clearQuietMeetingApps, () =>
    store.update({ quietMeetingApps: [] }),
  );
}
