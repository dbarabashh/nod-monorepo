import { View } from 'react-native';
import { useRecordingLevel } from '../../../lib/recording/recording.ts';
import { radius, space, themed, useScheme } from '../../../theme/index.ts';

const restingHeights = [0.375, 1, 0.5625];
const quietestHeight = 0.25;

const sheets = themed((colors) => ({
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[0.5],
    height: space[4],
  },
  bar: {
    width: space[0.5],
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.textMuted,
  },
  live: { backgroundColor: colors.toneSuccessFg },
}));

export function LevelBars({ live }: { live: boolean }) {
  const styles = sheets[useScheme()];
  const level = useRecordingLevel(live);
  return (
    <View
      style={styles.bars}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {restingHeights.map((scale, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            live && styles.live,
            {
              transform: [
                {
                  scaleY: live
                    ? Math.max(quietestHeight, level * scale)
                    : scale,
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}
