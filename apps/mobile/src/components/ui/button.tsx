import {
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  control,
  radius,
  size,
  space,
  themed,
  useColors,
  useScheme,
  weight,
  type Colors,
} from '../../theme/index.ts';
import { Icon, type IconName } from './icon.tsx';
import { Text } from './text.tsx';

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'danger'
  | 'outline'
  | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = Omit<
  PressableProps,
  'children' | 'style' | 'disabled' | 'accessibilityLabel'
> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
} & (
    | { children: string; icon?: IconName; accessibilityLabel?: string }
    | { children?: undefined; icon: IconName; accessibilityLabel: string }
  );

const sheets = themed((colors) => ({
  hit: {
    justifyContent: 'center',
    minWidth: control.minHit,
    minHeight: control.minHit,
  },
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1.5],
    borderWidth: size.borderWidth,
    borderRadius: radius.control,
  },
  sm: { minHeight: control.heightSm, paddingHorizontal: control.paddingSm },
  md: { minHeight: control.heightMd, paddingHorizontal: control.paddingMd },
  lg: { minHeight: control.heightLg, paddingHorizontal: control.paddingLg },
  smSquare: {
    alignSelf: 'center',
    width: control.heightSm,
    paddingHorizontal: 0,
  },
  mdSquare: {
    alignSelf: 'center',
    width: control.heightMd,
    paddingHorizontal: 0,
  },
  lgSquare: {
    alignSelf: 'center',
    width: control.heightLg,
    paddingHorizontal: 0,
  },
  default: { backgroundColor: colors.field, borderColor: colors.field },
  defaultPressed: {
    backgroundColor: colors.fieldPressed,
    borderColor: colors.fieldPressed,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryPressed: {
    backgroundColor: colors.accentPressed,
    borderColor: colors.accentPressed,
  },
  danger: {
    backgroundColor: colors.toneDangerBg,
    borderColor: colors.toneDangerBg,
  },
  dangerPressed: {},
  outline: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  outlinePressed: { backgroundColor: colors.field },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  ghostPressed: { backgroundColor: colors.field, borderColor: colors.field },
  defaultDisabled: {
    backgroundColor: colors.surfacePressed,
    borderColor: colors.surfacePressed,
  },
  primaryDisabled: {
    backgroundColor: colors.surfacePressed,
    borderColor: colors.surfacePressed,
  },
  dangerDisabled: {
    backgroundColor: colors.surfacePressed,
    borderColor: colors.surfacePressed,
  },
  outlineDisabled: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  ghostDisabled: {},
  label: { fontWeight: weight.medium },
  outlineLabel: { fontWeight: weight.regular },
}));

const foreground: Record<ButtonVariant, keyof Colors> = {
  default: 'text',
  primary: 'onAccent',
  danger: 'toneDangerFg',
  outline: 'text',
  ghost: 'text',
};

export function Button({
  variant = 'default',
  size: buttonSize = 'md',
  icon,
  children,
  disabled = false,
  accessibilityState,
  style,
  ...props
}: ButtonProps) {
  const styles = sheets[useScheme()];
  const colors = useColors();
  const square = children === undefined;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[styles.hit, style]}
      {...props}
      accessibilityState={{ ...accessibilityState, disabled }}
    >
      {({ pressed }) => {
        const fg =
          colors[
            disabled
              ? 'textDisabled'
              : variant === 'danger' && pressed
                ? 'dangerPressed'
                : foreground[variant]
          ];
        return (
          <View
            style={[
              styles.root,
              styles[buttonSize],
              square && styles[`${buttonSize}Square`],
              styles[variant],
              pressed && styles[`${variant}Pressed`],
              disabled && styles[`${variant}Disabled`],
            ]}
          >
            {icon && <Icon name={icon} color={fg} />}
            {children !== undefined && (
              <Text
                variant={buttonSize === 'lg' ? 'lg' : 'md'}
                numberOfLines={1}
                style={[
                  styles.label,
                  variant === 'outline' && styles.outlineLabel,
                  { color: fg },
                ]}
              >
                {children}
              </Text>
            )}
          </View>
        );
      }}
    </Pressable>
  );
}
