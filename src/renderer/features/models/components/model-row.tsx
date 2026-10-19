import { useId, type ReactNode } from 'react';
import type { ModelError, ModelInfo } from '../../../../shared/ipc.ts';
import {
  Badge,
  Button,
  Card,
  CardActions,
  CardBody,
  CardDetail,
  CardHeading,
  CardMeta,
  CardText,
  CardTitle,
  Progress,
} from '../../../components/ui/index.ts';
import { formatBytes } from '../lib/format-bytes.ts';

type ModelRowProps = {
  model: ModelInfo;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

const errorText: Record<ModelError, string> = {
  network: "Couldn't download the model. Check your connection and try again.",
  'disk-full': "There isn't enough free disk space for this model.",
  'not-writable': "The model couldn't be saved on this computer.",
  checksum: 'The download was damaged on the way. Try again.',
};

export function ModelRow({
  model,
  onDownload,
  onCancel,
  onDelete,
}: ModelRowProps) {
  const titleId = useId();
  const progress = `${formatBytes(model.downloadedBytes)} of ${formatBytes(model.sizeBytes)}`;
  const deleteButton = (
    <Button variant="ghost" onClick={onDelete}>
      Delete
    </Button>
  );

  let status: ReactNode = null;
  let actions: ReactNode;
  switch (model.status) {
    case 'available':
      actions = (
        <Button
          variant={model.recommended ? 'primary' : 'default'}
          onClick={onDownload}
        >
          {model.error ? 'Try again' : 'Download'}
        </Button>
      );
      break;
    case 'downloading':
      status = (
        <CardDetail>
          <Progress
            value={model.downloadedBytes}
            max={model.sizeBytes}
            aria-label={`${model.name} download`}
          />
          <CardMeta>Downloading {progress}</CardMeta>
        </CardDetail>
      );
      actions = (
        <Button variant="outline" onClick={onCancel}>
          Pause
        </Button>
      );
      break;
    case 'paused':
      status = <CardMeta>Paused at {progress}</CardMeta>;
      actions = (
        <>
          <Button variant="primary" onClick={onDownload}>
            Resume
          </Button>
          {deleteButton}
        </>
      );
      break;
    case 'downloaded':
      status = <CardMeta>Downloaded</CardMeta>;
      actions = deleteButton;
      break;
  }

  return (
    <Card aria-labelledby={titleId}>
      <CardBody>
        <CardHeading>
          <CardTitle id={titleId}>{model.name}</CardTitle>
          {model.recommended && <Badge variant="accent">Recommended</Badge>}
        </CardHeading>
        <CardText>{model.description}</CardText>
        <CardMeta>
          {formatBytes(model.sizeBytes)} · {model.languages} · {model.license}
        </CardMeta>
        {status}
        {model.error && (
          <CardMeta variant="danger" role="alert">
            {errorText[model.error]}
          </CardMeta>
        )}
      </CardBody>
      <CardActions>{actions}</CardActions>
    </Card>
  );
}
