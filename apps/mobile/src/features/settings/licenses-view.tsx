import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Icon, ListRow, Text } from '../../components/ui/index.ts';
import { radius, space, themed, useScheme } from '../../theme/index.ts';
import notices from './third-party-notices.json';

const texts = new Map(Object.entries(notices.texts));

type Entry = (typeof notices.entries)[number];

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { gap: space[1], padding: space[4] },
  intro: { paddingHorizontal: space[3], paddingBottom: space[3] },
  license: {
    gap: space[2],
    marginBottom: space[2],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
}));

function keyOf(entry: Entry): string {
  return `${entry.name}@${entry.version}`;
}

function LicenseRow({ entry }: { entry: Entry }) {
  const styles = sheets[useScheme()];
  const [open, setOpen] = useState(false);
  const body = entry.text === null ? null : (texts.get(entry.text) ?? null);
  return (
    <View>
      <ListRow
        title={entry.name}
        meta={
          entry.version === 'bundled'
            ? entry.license
            : `${entry.version} · ${entry.license}`
        }
        trailing={<Icon name={open ? 'chevron-down' : 'chevron-right'} />}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
      />
      {open && (
        <View style={styles.license}>
          {entry.copyright.length > 0 && (
            <Text variant="sm" selectable>
              {entry.copyright.join('\n')}
            </Text>
          )}
          <Text variant="sm" tone="muted" selectable>
            {body ??
              `No license file ships with this component; its metadata names ${entry.license}.`}
          </Text>
        </View>
      )}
    </View>
  );
}

export function LicensesView() {
  const styles = sheets[useScheme()];
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={notices.entries}
      keyExtractor={keyOf}
      ListHeaderComponent={
        <Text variant="sm" tone="muted" style={styles.intro}>
          {notices.title}
        </Text>
      }
      renderItem={({ item }) => <LicenseRow entry={item} />}
    />
  );
}
