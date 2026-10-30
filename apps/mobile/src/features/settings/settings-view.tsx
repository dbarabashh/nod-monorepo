import type { ReactNode } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Checkbox,
  Icon,
  List,
  ListRow,
  Progress,
  Text,
} from '../../components/ui/index.ts';
import { messageOf } from '../../lib/message-of.ts';
import { stopSyncing, useSync } from '../../lib/sync/sync.ts';
import { isBusy, knownUpdate } from '../../lib/updates/schedule.ts';
import {
  checkForUpdate,
  installUpdate,
  setAutomaticChecks,
  useUpdates,
  type UpdatesView,
} from '../../lib/updates/updates.ts';
import { radius, space, themed, useScheme } from '../../theme/index.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { gap: space[6], padding: space[4] },
  section: { gap: space[2] },
  heading: { paddingHorizontal: space[3] },
  vault: {
    gap: space[0.5],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  stop: { alignSelf: 'flex-start' },
}));

function confirmStop() {
  Alert.alert(
    'Stop syncing on this phone?',
    'Its meetings stay here. The copies it put on the relay are removed, and it stops getting meetings from your other devices. You can pair it again later.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop syncing',
        style: 'destructive',
        onPress: () => {
          stopSyncing().catch((failure: unknown) =>
            Alert.alert('Couldn’t stop syncing', messageOf(failure)),
          );
        },
      },
    ],
  );
}

function updateStatus({ automatic, state }: UpdatesView): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for a new version…';
    case 'installing':
      return 'Android’s installer is open.';
    case 'current':
      return 'This is the newest version.';
    case 'available':
      return `Nod ${state.update.version} is available.`;
    case 'downloading':
      return `Downloading Nod ${state.update.version}…`;
    case 'failed':
      return state.message;
    default:
      return automatic
        ? 'Nod looks for a new version on GitHub every six hours.'
        : 'Nod doesn’t look for new versions on its own.';
  }
}

function UpdatesSection() {
  const styles = sheets[useScheme()];
  const updates = useUpdates();
  const { state } = updates;
  if (state.status === 'unavailable') {
    return null;
  }
  const pending = knownUpdate(state);
  const working = isBusy(state);
  return (
    <Section title="Updates">
      <View style={styles.vault}>
        <Text selectable>{`Nod ${updates.version}`}</Text>
        <Text variant="sm" tone="muted" accessibilityLiveRegion="polite">
          {updateStatus(updates)}
        </Text>
        {state.status === 'downloading' && (
          <Progress
            value={state.progress}
            label={`Downloading Nod ${state.update.version}`}
          />
        )}
      </View>
      {pending === null ? (
        <Button
          variant="ghost"
          size="sm"
          style={styles.stop}
          disabled={working}
          onPress={() => void checkForUpdate()}
        >
          Check now
        </Button>
      ) : (
        <Button
          size="sm"
          style={styles.stop}
          disabled={working}
          onPress={() => void installUpdate(pending)}
        >
          {`Install Nod ${pending.version}`}
        </Button>
      )}
      <List>
        <ListRow
          title="Check for updates automatically"
          trailing={
            <Checkbox
              label="Check for updates automatically"
              checked={updates.automatic}
              onChange={(automatic) => void setAutomaticChecks(automatic)}
            />
          }
          onPress={() => void setAutomaticChecks(!updates.automatic)}
        />
      </List>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = sheets[useScheme()];
  return (
    <View style={styles.section}>
      <Text
        variant="sm"
        tone="muted"
        weight="medium"
        accessibilityRole="header"
        style={styles.heading}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function SettingsView() {
  const styles = sheets[useScheme()];
  const router = useRouter();
  const sync = useSync();
  const paired =
    sync.status === 'ready' && sync.sync.status === 'paired' ? sync.sync : null;
  const chevron = <Icon name="chevron-right" />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Section title="Recording">
        <List>
          <ListRow
            title="Speech model"
            trailing={chevron}
            onPress={() => router.push('/models')}
          />
        </List>
      </Section>
      {paired !== null && (
        <Section title="Sync">
          <View style={styles.vault}>
            <Text selectable>{`Vault code ${paired.vaultCode}`}</Text>
            <Text variant="sm" tone="muted" selectable>
              {paired.relayHost}
            </Text>
          </View>
          <Button
            variant="ghost"
            size="sm"
            style={styles.stop}
            onPress={confirmStop}
          >
            Stop syncing on this phone
          </Button>
        </Section>
      )}
      <UpdatesSection />
      <Section title="About">
        <List>
          <ListRow
            title="Open-source licenses"
            trailing={chevron}
            onPress={() => router.push('/licenses')}
          />
        </List>
      </Section>
      {__DEV__ && (
        <Section title="Developer">
          <List>
            <ListRow
              title="Diagnostics"
              trailing={chevron}
              onPress={() => router.push('/diagnostics')}
            />
          </List>
        </Section>
      )}
    </ScrollView>
  );
}
