import { View } from 'react-native';
import { radius, size, themed, useScheme } from '../../theme/index.ts';

type ProgressProps = {
  value: number;
  label: string;
};

const sheets = themed((colors) => ({
  track: {
    width: '100%',
    height: size.meterHeight,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
}));

export function Progress({ value, label }: ProgressProps) {
  const styles = sheets[useScheme()];
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}
