import type { ReactNode } from 'react';
import { View } from 'react-native';
import {
  control,
  radius,
  size,
  space,
  themed,
  useColors,
  useScheme,
} from '../../theme/index.ts';
import { Icon, type IconName } from './icon.tsx';
import { Text } from './text.tsx';

type EmptyStateProps = {
  icon?: IconName;
  title: string;
  description?: string;
  children?: ReactNode;
};

const sheets = themed((colors) => ({
  root: {
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[12],
    paddingHorizontal: space[6],
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: control.heightLg,
    height: control.heightLg,
    marginBottom: space[1],
    borderRadius: radius.lg,
    backgroundColor: colors.field,
  },
  description: { maxWidth: size.measureNarrow, textAlign: 'center' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space[2],
    marginTop: space[2],
  },
}));

export function EmptyState({
  icon,
  title,
  description,
  children,
}: EmptyStateProps) {
  const styles = sheets[useScheme()];
  const colors = useColors();
  return (
    <View style={styles.root}>
      {icon !== undefined && (
        <View style={styles.icon}>
          <Icon name={icon} size="lg" color={colors.textMuted} />
        </View>
      )}
      <Text variant="lg" weight="bold" accessibilityRole="header">
        {title}
      </Text>
      {description !== undefined && (
        <Text tone="muted" style={styles.description}>
          {description}
        </Text>
      )}
      {children !== undefined && <View style={styles.actions}>{children}</View>}
    </View>
  );
}
