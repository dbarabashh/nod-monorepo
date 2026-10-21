import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
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

const sheets = themed((colors) => ({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[4],
    borderWidth: size.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  media: {
    alignItems: 'center',
    justifyContent: 'center',
    width: control.heightSm,
    height: control.heightSm,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  body: { flex: 1, gap: space[0.5], minWidth: 0 },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: space[2],
  },
  meta: { fontVariant: ['tabular-nums'] },
  detail: { gap: space[1], marginTop: space[2] },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space[2],
  },
}));

export function Card({ style, ...props }: ViewProps) {
  const styles = sheets[useScheme()];
  return <View style={[styles.root, style]} {...props} />;
}

export function CardMedia({ icon }: { icon: IconName }) {
  const styles = sheets[useScheme()];
  return (
    <View style={styles.media}>
      <Icon name={icon} color={useColors().textMuted} />
    </View>
  );
}

export function CardBody({ children }: { children: ReactNode }) {
  return <View style={sheets[useScheme()].body}>{children}</View>;
}

export function CardHeading({ children }: { children: ReactNode }) {
  return <View style={sheets[useScheme()].heading}>{children}</View>;
}

export function CardTitle({ children }: { children: string }) {
  return (
    <Text weight="medium" accessibilityRole="header">
      {children}
    </Text>
  );
}

export function CardText({ children }: { children: string }) {
  return (
    <Text tone="muted" selectable>
      {children}
    </Text>
  );
}

export function CardMeta({
  variant = 'default',
  children,
}: {
  variant?: 'default' | 'strong' | 'danger';
  children: string;
}) {
  return (
    <Text
      variant="sm"
      tone={
        variant === 'strong'
          ? 'default'
          : variant === 'danger'
            ? 'danger'
            : 'muted'
      }
      style={sheets[useScheme()].meta}
    >
      {children}
    </Text>
  );
}

export function CardDetail({ children }: { children: ReactNode }) {
  return <View style={sheets[useScheme()].detail}>{children}</View>;
}

export function CardActions({ children }: { children: ReactNode }) {
  return <View style={sheets[useScheme()].actions}>{children}</View>;
}
