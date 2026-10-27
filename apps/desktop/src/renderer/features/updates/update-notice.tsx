import { Button } from '../../components/ui/index.ts';
import { useAction } from '../../lib/use-action.ts';
import { installUpdate, openUpdatePage } from './api.ts';
import { updateToShow } from './lib/describe.ts';
import { useUpdate } from './use-update.ts';
import './updates.css';

export function UpdateNotice() {
  const { state } = useUpdate();
  const { busy, error, run } = useAction();
  if (state.status !== 'ready') {
    return null;
  }
  const update = state.value;
  const version = updateToShow(update);
  if (version === null) {
    return null;
  }

  return (
    <section className="update-notice" aria-label="Update">
      <p className="update-notice__text" role="status">
        Nod {version} is {update.status === 'ready' ? 'ready' : 'out'}.
      </p>
      {update.status === 'ready' ? (
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => run(installUpdate)}
        >
          Restart to update
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => run(openUpdatePage)}>
          Download
        </Button>
      )}
      {error && (
        <p className="update-notice__text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
