import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import {
  createLiveActivity,
  type LiveActivityEnvironment,
  type LiveActivityLayout,
} from 'expo-widgets';

export type ActivityPalette = {
  bg: string;
  text: string;
  muted: string;
  live: string;
};

// A widget runs on its own and can't import the theme, so the tokens it
// needs come in with its props.
export type RecordingActivityProps = {
  since: number;
  light: ActivityPalette;
  dark: ActivityPalette;
  gap: number;
  inset: number;
  iconSize: number;
};

function RecordingActivity(
  props: RecordingActivityProps,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  'widget';
  const palette = environment.colorScheme === 'dark' ? props.dark : props.light;
  const island = props.dark;
  const stale = environment.isStale === true;
  const title = stale ? 'Recording stopped' : 'Recording';
  const detail = stale
    ? 'Open Nod to check this meeting'
    : 'On this phone · audio never stored';
  const since = new Date(props.since);
  const timer = (colors: ActivityPalette) =>
    stale ? (
      <Text
        modifiers={[
          font({ textStyle: 'headline' }),
          foregroundStyle(colors.muted),
        ]}
      >
        Stopped
      </Text>
    ) : (
      <Text
        date={since}
        dateStyle="timer"
        modifiers={[
          font({ textStyle: 'headline' }),
          monospacedDigit(),
          foregroundStyle(colors.text),
        ]}
      />
    );
  const wave = (colors: ActivityPalette) => (
    <Image
      systemName="waveform"
      size={props.iconSize}
      color={stale ? colors.muted : colors.live}
    />
  );

  return {
    banner: (
      <HStack
        spacing={props.gap}
        modifiers={[
          padding({ all: props.inset }),
          activityBackgroundTint(palette.bg),
        ]}
      >
        {wave(palette)}
        <VStack alignment="leading">
          <Text
            modifiers={[
              font({ textStyle: 'headline' }),
              foregroundStyle(palette.text),
              lineLimit(1),
            ]}
          >
            {title}
          </Text>
          <Text
            modifiers={[
              font({ textStyle: 'subheadline' }),
              foregroundStyle(palette.muted),
              lineLimit(1),
            ]}
          >
            {detail}
          </Text>
        </VStack>
        <Spacer />
        {timer(palette)}
      </HStack>
    ),
    compactLeading: wave(island),
    compactTrailing: timer(island),
    minimal: wave(island),
    expandedLeading: wave(island),
    expandedCenter: (
      <Text
        modifiers={[
          font({ textStyle: 'headline' }),
          foregroundStyle(island.text),
        ]}
      >
        {title}
      </Text>
    ),
    expandedTrailing: timer(island),
    expandedBottom: (
      <Text
        modifiers={[
          font({ textStyle: 'subheadline' }),
          foregroundStyle(island.muted),
        ]}
      >
        {detail}
      </Text>
    ),
  };
}

export default createLiveActivity('RecordingActivity', RecordingActivity);
