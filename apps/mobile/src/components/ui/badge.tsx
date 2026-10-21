import { View, type ViewProps } from 'react-native';
import { radius, size, space, themed, useScheme } from '../../theme/index.ts';
import { Text } from './text.tsx';

export type BadgeVariant =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

type BadgeProps = Omit<ViewProps, 'children'> & {
  variant?: BadgeVariant;
  dot?: boolean;
  children: string;
};

const sheets = themed((colors) => ({
  root: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  dot: {
    width: size.dotSize,
    height: size.dotSize,
    borderRadius: radius.full,
  },
  defaultDot: { backgroundColor: colors.textMuted },
  accentDot: { backgroundColor: colors.toneAccentFg },
  successDot: { backgroundColor: colors.toneSuccessFg },
  warningDot: { backgroundColor: colors.toneWarningFg },
  dangerDot: { backgroundColor: colors.toneDangerFg },
  default: { color: colors.textMuted },
  accent: { color: colors.toneAccentFg },
  success: { color: colors.toneSuccessFg },
  warning: { color: colors.toneWarningFg },
  danger: { color: colors.toneDangerFg },
}));

export function Badge({
  variant = 'default',
  dot = false,
  children,
  style,
  ...props
}: BadgeProps) {
  const styles = sheets[useScheme()];
  return (
    <View style={[styles.root, style]} {...props}>
      {dot && <View style={[styles.dot, styles[`${variant}Dot`]]} />}
      <Text variant="sm" numberOfLines={1} style={styles[variant]}>
        {children}
      </Text>
    </View>
  );
}
