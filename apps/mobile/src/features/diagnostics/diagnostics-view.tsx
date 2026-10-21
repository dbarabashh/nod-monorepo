import { useState } from 'react';
import { ScrollView } from 'react-native';
import { checkNativeAutomerge } from '@nod/automerge-native/react-native/diagnostics';
import {
  Badge,
  Button,
  List,
  ListRow,
  Text,
} from '../../components/ui/index.ts';
import { space, themed, useScheme } from '../../theme/index.ts';

type Result = { name: string; ok: boolean };

const sheets = themed((colors) => ({
  screen: { backgroundColor: colors.bg },
  content: { gap: space[4], padding: space[4] },
}));

export function DiagnosticsView() {
  const styles = sheets[useScheme()];
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    try {
      setResults(checkNativeAutomerge());
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const passed = results?.filter((result) => result.ok).length ?? 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text tone="muted">
        Runs the Automerge compatibility scenarios on this device’s native
        backend and compares them with what the desktop app writes.
      </Text>
      <Button variant="primary" onPress={run}>
        Run Automerge check
      </Button>
      {error !== null && <Text tone="danger">{error}</Text>}
      {results !== null && (
        <>
          <Text weight="semibold" testID="automerge-summary">
            {`${passed} of ${results.length} match the desktop app`}
          </Text>
          <List>
            {results.map((result) => (
              <ListRow
                key={result.name}
                title={result.name}
                trailing={
                  <Badge variant={result.ok ? 'success' : 'danger'} dot>
                    {result.ok ? 'Match' : 'Differs'}
                  </Badge>
                }
              />
            ))}
          </List>
        </>
      )}
    </ScrollView>
  );
}
