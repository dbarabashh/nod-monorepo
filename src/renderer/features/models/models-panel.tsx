import { useEffect } from 'react';
import type { ModelInfo } from '../../../shared/ipc.ts';
import { Button, EmptyState } from '../../components/ui/index.ts';
import {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  listModels,
  onModelsChanged,
} from './api.ts';
import { useAsync } from '../../lib/use-async.ts';
import { ModelRow } from './components/model-row.tsx';
import {
  firstSpeechDownload,
  speechReadiness,
} from '../../lib/speech-ready.ts';
import './models.css';

const speechNote = {
  ready: null,
  downloading:
    'Recording works once the speech model has downloaded. It keeps downloading while Nod is open.',
  missing:
    'Nod can’t record without a speech model: audio is never kept, so it has to be transcribed as it is heard.',
};

// Once per app run, so going back and forth in onboarding doesn't restart a
// download the user paused or deleted.
let autoDownloaded = false;

export function ModelsPanel({
  kind,
  autoDownload = false,
}: {
  kind: ModelInfo['kind'];
  autoDownload?: boolean;
}) {
  const { state, retry } = useAsync(listModels, onModelsChanged);
  const models = state.status === 'ready' ? state.value : null;

  useEffect(() => {
    if (!autoDownload || kind !== 'speech' || !models || autoDownloaded) {
      return;
    }
    autoDownloaded = true;
    const id = firstSpeechDownload(models);
    if (id) {
      void downloadModel(id);
    }
  }, [autoDownload, kind, models]);

  if (state.status === 'loading') {
    return <p className="models__note">Checking models…</p>;
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        icon="download"
        title="Couldn't check the speech models"
        action={<Button onClick={retry}>Try again</Button>}
      />
    );
  }

  const note =
    kind === 'speech' ? speechNote[speechReadiness(state.value)] : null;

  return (
    <div className="models">
      {note && <p className="models__note">{note}</p>}
      {state.value
        .filter((model) => model.kind === kind)
        .map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            onDownload={() => void downloadModel(model.id)}
            onCancel={() => void cancelModelDownload(model.id)}
            onDelete={() => void deleteModel(model.id)}
          />
        ))}
    </div>
  );
}
