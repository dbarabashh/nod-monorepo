import { Button } from '../../components/ui/index.ts';
import type { AppState } from '../../../shared/ipc.ts';
import { clockFormat } from '../../lib/formats.ts';
import { useAction } from '../../lib/use-action.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  checkForUpdatesNow,
  getAppState,
  installUpdate,
  isLinux,
  openUpdatePage,
  setCheckForUpdates,
  setTestUpdates,
} from './api.ts';
import { describeUpdate } from './lib/describe.ts';
import { useUpdate } from './use-update.ts';
import './updates.css';

export function UpdatesPanel() {
  const { state, retry } = useUpdate();
  const settings = useAsync(getAppState);
  const { busy, error, run } = useAction();

  if (state.status === 'loading') {
    return null;
  }
  if (state.status === 'error') {
    return (
      <section className="updates" aria-label="Updates">
        <p className="updates__note" role="alert">
          Updates couldn’t be loaded.
        </p>
        <div>
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      </section>
    );
  }
  const update = state.value;
  const save = (change: () => Promise<AppState>) =>
    run(async () =>
      settings.setState({ status: 'ready', value: await change() }),
    );

  return (
    <section className="updates" aria-label="Updates">
      <p className="updates__status" role="status">
        {describeUpdate(update, (at) => clockFormat.format(at))}
      </p>
      {update.status !== 'unavailable' && (
        <div className="updates__actions">
          {update.status === 'ready' ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => run(installUpdate)}
            >
              Restart to update
            </Button>
          ) : update.status === 'available' ? (
            <Button disabled={busy} onClick={() => run(openUpdatePage)}>
              Open release page
            </Button>
          ) : (
            <Button
              disabled={
                busy ||
                update.status === 'checking' ||
                update.status === 'downloading'
              }
              onClick={() => run(checkForUpdatesNow)}
            >
              Check now
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="updates__note" role="alert">
          {error}
        </p>
      )}
      {update.status !== 'unavailable' && settings.state.status === 'ready' && (
        <label className="updates__option">
          <input
            type="checkbox"
            checked={settings.state.value.checkForUpdates}
            disabled={busy}
            onChange={(event) => {
              const enabled = event.target.checked;
              save(() => setCheckForUpdates(enabled));
            }}
          />
          Check for updates automatically
        </label>
      )}
      {update.status !== 'unavailable' && settings.state.status === 'ready' && (
        <label className="updates__option">
          <input
            type="checkbox"
            checked={settings.state.value.testUpdates}
            disabled={busy}
            onChange={(event) => {
              const enabled = event.target.checked;
              save(() => setTestUpdates(enabled));
            }}
          />
          Get test versions before they’re released
        </label>
      )}
      <p className="updates__note">
        Nod asks the project’s release page on GitHub whether a newer version is
        out. The request carries no account and nothing about your meetings,
        only what any download tells the server, such as your network address.
        {update.status !== 'unavailable' &&
          (isLinux()
            ? ' On Linux, Nod tells you about a new version, and you install it like the first one.'
            : ' Updates download in the background and install when Nod restarts, never while you record.')}
        {update.status !== 'unavailable' &&
          ' Test versions are the next release before everyone gets it; to find them, Nod also asks GitHub’s API for the list of releases.'}
      </p>
    </section>
  );
}
