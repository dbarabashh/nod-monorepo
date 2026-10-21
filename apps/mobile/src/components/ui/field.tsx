import { createContext, use, useState, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import {
  control,
  radius,
  size,
  space,
  text,
  themed,
  useColors,
  useScheme,
} from '../../theme/index.ts';
import { Text } from './text.tsx';

type FieldContext = { label: string; description?: string; invalid: boolean };

const FieldContext = createContext<FieldContext | null>(null);

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

const sheets = themed((colors) => ({
  field: { gap: space[1] },
  input: {
    minHeight: control.heightMd,
    paddingHorizontal: control.paddingMd,
    borderWidth: size.borderWidth,
    borderColor: colors.field,
    borderRadius: radius.field,
    backgroundColor: colors.field,
    color: colors.text,
    ...text.md,
  },
  multiline: {
    minHeight: control.heightLg * 2,
    paddingVertical: space[2],
    textAlignVertical: 'top',
  },
  focused: {
    borderColor: colors.fieldPressed,
    backgroundColor: colors.fieldPressed,
  },
  invalid: { borderColor: colors.danger },
  disabled: { color: colors.textDisabled },
}));

export function Field({ label, hint, error, children }: FieldProps) {
  const styles = sheets[useScheme()];
  return (
    <FieldContext
      value={{
        label,
        description: error ?? hint,
        invalid: error !== undefined,
      }}
    >
      <View style={styles.field}>
        <Text variant="sm" weight="medium" aria-hidden>
          {label}
        </Text>
        {children}
        {hint !== undefined && error === undefined && (
          <Text variant="sm" tone="muted" aria-hidden>
            {hint}
          </Text>
        )}
        {error !== undefined && (
          <Text variant="sm" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
      </View>
    </FieldContext>
  );
}

type InputProps = TextInputProps & { invalid?: boolean };

export function Input({
  invalid,
  editable = true,
  multiline,
  onFocus,
  onBlur,
  style,
  ...props
}: InputProps) {
  const styles = sheets[useScheme()];
  const colors = useColors();
  const field = use(FieldContext);
  const [focused, setFocused] = useState(false);
  const isInvalid = invalid ?? field?.invalid ?? false;

  return (
    <TextInput
      accessibilityLabel={field?.label}
      accessibilityHint={field?.description}
      editable={editable}
      multiline={multiline}
      placeholderTextColor={colors.textMuted}
      selectionColor={colors.accent}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.input,
        multiline === true && styles.multiline,
        focused && styles.focused,
        isInvalid && styles.invalid,
        !editable && styles.disabled,
        style,
      ]}
      {...props}
    />
  );
}
