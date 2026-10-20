import { Button } from '../../../components/ui/index.ts';
import type { AppState } from '../../../../shared/ipc.ts';
import { useAction } from '../../../lib/use-action.ts';
import { useAsync } from '../../../lib/use-async.ts';
import {
  clearQuietMeetingApps,
  getAppState,
  setSuggestMeetings,
} from '../api.ts';

export function SuggestMeetingsSetting() {
  const { state, setState, retry } = useAsync(getAppState);
  const { busy, error, run } = useAction();

  const save = (change: () => Promise<AppState>) =>
    run(async () => setState({ status: 'ready', value: await change() }));

  if (state.status === 'loading') {
    return null;
  }
  if (state.status === 'error') {
    return (
      <section className="suggest-meetings" aria-label="Meeting detection">
        <p className="suggest-meetings__note" role="alert">
          This setting couldn’t be loaded.
        </p>
        <div>
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      </section>
    );
  }
  const settings = state.value;

  return (
    <section className="suggest-meetings" aria-label="Meeting detection">
      <label className="suggest-meetings__option">
        <input
          type="checkbox"
          checked={settings.suggestMeetings}
          disabled={busy}
          onChange={(event) => {
            const enabled = event.target.checked;
            save(() => setSuggestMeetings(enabled));
          }}
        />
        Suggest taking notes when a meeting starts
      </label>
      <p className="suggest-meetings__note">
        When Zoom, Teams, a call in your browser or another call app starts
        using the microphone, Nod offers to take notes. It only notices which
        app uses the microphone; it never looks at your screen. On a Mac this
        needs macOS 14.4 or later.
      </p>
      {settings.quietMeetingApps.length > 0 && (
        <div className="suggest-meetings__quiet">
          <p className="suggest-meetings__note">
            {settings.quietMeetingApps.length === 1
              ? '1 app is never suggested.'
              : `${settings.quietMeetingApps.length} apps are never suggested.`}
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => save(clearQuietMeetingApps)}
          >
            Suggest for all apps
          </Button>
        </div>
      )}
      {error && (
        <p className="suggest-meetings__note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
