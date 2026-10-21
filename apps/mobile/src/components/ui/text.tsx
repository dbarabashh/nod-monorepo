import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from 'react-native';
import { text, themed, useScheme, weight } from '../../theme/index.ts';

export type TextVariant = keyof typeof text;
export type TextTone = 'default' | 'muted' | 'disabled' | 'danger' | 'accent';

type TextProps = NativeTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: keyof typeof weight;
};

const sheets = themed((colors) => ({
  sm: text.sm,
  rowMeta: text.rowMeta,
  md: text.md,
  rowTitle: text.rowTitle,
  lg: text.lg,
  xl: text.xl,
  default: { color: colors.text },
  muted: { color: colors.textMuted },
  disabled: { color: colors.textDisabled },
  danger: { color: colors.danger },
  accent: { color: colors.toneAccentFg },
  regular: { fontWeight: weight.regular },
  medium: { fontWeight: weight.medium },
  semibold: { fontWeight: weight.semibold },
  bold: { fontWeight: weight.bold },
}));

export function Text({
  variant = 'md',
  tone = 'default',
  weight: fontWeight = variant === 'xl' ? 'bold' : 'regular',
  style,
  ...props
}: TextProps) {
  const styles = sheets[useScheme()];
  return (
    <NativeText
      style={[styles[variant], styles[tone], styles[fontWeight], style]}
      {...props}
    />
  );
}
