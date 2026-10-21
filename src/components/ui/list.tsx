import type { ReactNode } from 'react';
import {
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  control,
  radius,
  space,
  themed,
  useScheme,
} from '../../theme/index.ts';
import { Text } from './text.tsx';

type ListRowProps = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

const sheets = themed((colors) => ({
  list: { gap: space[0] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  leading: { alignItems: 'center', justifyContent: 'center' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minWidth: 0,
    minHeight: control.minHit,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  selected: { backgroundColor: colors.surfaceSelected },
  body: { flex: 1, minWidth: 0, gap: space[0.5] },
  trailing: { flexShrink: 0, alignItems: 'flex-end' },
}));

export function List({ style, ...props }: ViewProps) {
  return (
    <View
      accessibilityRole="list"
      style={[sheets[useScheme()].list, style]}
      {...props}
    />
  );
}

export function ListRow({
  title,
  meta,
  leading,
  trailing,
  selected = false,
  style,
  accessibilityState,
  ...props
}: ListRowProps) {
  const styles = sheets[useScheme()];
  return (
    <View style={styles.item}>
      {leading !== undefined && <View style={styles.leading}>{leading}</View>}
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.row,
          selected && styles.selected,
          pressed && styles.pressed,
          style,
        ]}
        {...props}
        accessibilityState={{ ...accessibilityState, selected }}
      >
        <View style={styles.body}>
          <Text variant="rowTitle" weight="medium" numberOfLines={1}>
            {title}
          </Text>
          {meta !== undefined && (
            <Text variant="rowMeta" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
        {trailing !== undefined && (
          <View style={styles.trailing}>{trailing}</View>
        )}
      </Pressable>
    </View>
  );
}
