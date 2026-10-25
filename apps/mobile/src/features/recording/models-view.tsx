import { useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { modelSize } from '@nod/core/models';
import { Badge, Button, Progress, Text } from '../../components/ui/index.ts';
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  modelEntries,
  subscribeModels,
  type ModelEntry,
} from '../../lib/recording/models.ts';
import { radius, space, themed, useScheme } from '../../theme/index.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, gap: space[6], padding: space[6] },
  section: { gap: space[3] },
  model: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
}));

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function ModelRow({ entry, inUse }: { entry: ModelEntry; inUse: boolean }) {
  const styles = sheets[useScheme()];
  const { model, state } = entry;
  return (
    <View style={styles.model}>
      <View style={styles.row}>
        <Text weight="semibold">{model.name}</Text>
        {model.id === modelEntries()[0]?.model.id && (
          <Badge variant="accent">Recommended</Badge>
        )}
      </View>
      <Text variant="sm" tone="muted">
        {`${model.description} ${model.languages} · ${megabytes(modelSize(model))}`}
      </Text>
      <Text variant="sm" tone="muted">
        {`License: ${model.license}`}
      </Text>
      {state.status === 'downloading' && (
        <>
          <Progress
            value={state.progress}
            label={`Downloading ${model.name}`}
          />
          <View style={styles.actions}>
            <Button
              variant="outline"
              size="sm"
              onPress={() => cancelDownload(model.id)}
            >
              Cancel
            </Button>
          </View>
        </>
      )}
      {state.status === 'checking' && (
        <Text variant="sm" tone="muted">
          Checking the download…
        </Text>
      )}
      {state.status === 'failed' && (
        <Text variant="sm" tone="danger">
          {state.error}
        </Text>
      )}
      {(state.status === 'missing' || state.status === 'failed') && (
        <View style={styles.actions}>
          <Button
            variant="primary"
            size="sm"
            icon="download"
            onPress={() => void downloadModel(model.id)}
          >
            Download
          </Button>
        </View>
      )}
      {state.status === 'ready' && !inUse && (
        <Text variant="sm" tone="muted">
          On this phone. Recording uses the model above while it is here.
        </Text>
      )}
      {state.status === 'ready' && (
        <View style={styles.actions}>
          <Badge variant={inUse ? 'success' : 'default'} dot={inUse}>
            {inUse ? 'Records with this' : 'Not in use'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => deleteModel(model.id)}
          >
            Delete
          </Button>
        </View>
      )}
    </View>
  );
}

export function ModelsView() {
  const styles = sheets[useScheme()];
  const models = useSyncExternalStore(subscribeModels, modelEntries);
  const inUse = models.find((entry) => entry.state.status === 'ready')?.model
    .id;
  const ready = inUse !== undefined;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.section}>
        <Text tone="muted">
          Nod transcribes on this phone with the same speech engine as your
          computer. Audio never leaves the phone and is never stored.
        </Text>
        {!ready && (
          <Text tone="muted">
            Download a model to record. It stays on this phone and works
            offline.
          </Text>
        )}
      </View>
      {models.map((entry) => (
        <ModelRow
          key={entry.model.id}
          entry={entry}
          inUse={entry.model.id === inUse}
        />
      ))}
    </ScrollView>
  );
}
