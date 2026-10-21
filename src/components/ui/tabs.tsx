import { Pressable, View } from 'react-native';
import { control, size, space, themed, useScheme } from '../../theme/index.ts';
import { Text } from './text.tsx';

type Tab<Value extends string> = { value: Value; label: string };

type TabsProps<Value extends string> = {
  tabs: readonly Tab<Value>[];
  value: Value;
  onChange: (value: Value) => void;
};

const sheets = themed((colors) => ({
  list: {
    flexDirection: 'row',
    gap: space[1],
    borderBottomWidth: size.borderWidth,
    borderBottomColor: colors.border,
  },
  tab: {
    justifyContent: 'center',
    minHeight: control.minHit,
    marginBottom: -size.borderWidth,
    paddingHorizontal: space[3],
    borderBottomWidth: size.focusRingWidth,
    borderBottomColor: colors.border,
  },
  selected: { borderBottomColor: colors.accent },
}));

export function Tabs<Value extends string>({
  tabs,
  value,
  onChange,
}: TabsProps<Value>) {
  const styles = sheets[useScheme()];
  return (
    <View accessibilityRole="tablist" style={styles.list}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.value)}
            style={[styles.tab, selected && styles.selected]}
          >
            {({ pressed }) => (
              <Text
                weight="medium"
                tone={selected || pressed ? 'default' : 'muted'}
              >
                {tab.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
