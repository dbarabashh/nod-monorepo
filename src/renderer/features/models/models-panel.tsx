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
import './models.css';

export function ModelsPanel() {
  const { state, retry } = useAsync(listModels, onModelsChanged);

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

  return (
    <div className="models">
      {state.value.map((model) => (
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
