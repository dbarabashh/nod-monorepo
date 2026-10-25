import type { ReactNode } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Icon,
  List,
  ListRow,
  Text,
} from '../../components/ui/index.ts';
import { messageOf } from '../../lib/message-of.ts';
import { stopSyncing, useSync } from '../../lib/sync/sync.ts';
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
