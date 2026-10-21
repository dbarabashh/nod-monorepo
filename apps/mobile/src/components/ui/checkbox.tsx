import { Pressable, View, type PressableProps } from 'react-native';
import {
  control,
  icon,
  radius,
  size,
  themed,
  useColors,
  useScheme,
} from '../../theme/index.ts';
import { Icon } from './icon.tsx';

type CheckboxProps = Omit<
  PressableProps,
  'children' | 'onPress' | 'disabled' | 'style'
> & {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

const sheets = themed((colors) => ({
  hit: {
    alignItems: 'center',
    justifyContent: 'center',
    width: control.minHit,
    height: control.minHit,
  },
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    width: size.checkbox,
    height: size.checkbox,
    borderWidth: size.borderWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.xs,
    backgroundColor: colors.surface,
  },
  pressed: { borderColor: colors.textMuted },
  on: { borderColor: colors.accent, backgroundColor: colors.accent },
  onPressed: {
    borderColor: colors.accentPressed,
    backgroundColor: colors.accentPressed,
  },
  disabled: { borderColor: colors.border, backgroundColor: colors.field },
  bar: {
    width: icon.sm,
    height: size.borderWidth * 2,
    backgroundColor: colors.onAccent,
  },
  barDisabled: { backgroundColor: colors.textDisabled },
}));

export function Checkbox({
  label,
  checked,
  mixed = false,
  disabled = false,
  onChange,
  accessibilityState,
  ...props
}: CheckboxProps) {
  const styles = sheets[useScheme()];
  const colors = useColors();
  const on = checked || mixed;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(mixed || !checked)}
      style={styles.hit}
      {...props}
      accessibilityState={{
        ...accessibilityState,
        checked: mixed ? 'mixed' : checked,
        disabled,
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.box,
            pressed && styles.pressed,
            on && styles.on,
            on && pressed && styles.onPressed,
            disabled && styles.disabled,
          ]}
        >
          {mixed ? (
            <View style={[styles.bar, disabled && styles.barDisabled]} />
          ) : (
            checked && (
              <Icon
                name="check"
                size="sm"
                color={disabled ? colors.textDisabled : colors.onAccent}
              />
            )
          )}
        </View>
      )}
    </Pressable>
  );
}
