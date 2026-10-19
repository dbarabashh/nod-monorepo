export type AudioBudget = {
  admit: (samples: number) => boolean;
};

// A renderer can only send audio about as fast as it is captured; anything
// far beyond real time is a stuck loop or an attack on main's memory.
export function createAudioBudget(options: {
  now: () => number;
  samplesPerSecond: number;
  burstSeconds: number;
}): AudioBudget {
  const { now, samplesPerSecond, burstSeconds } = options;
  const capacity = samplesPerSecond * burstSeconds;
  let available = capacity;
  let checkedAt = now();
  return {
    admit: (samples) => {
      const time = now();
      available = Math.min(
        capacity,
        available + (Math.max(0, time - checkedAt) / 1000) * samplesPerSecond,
      );
      checkedAt = time;
      if (samples > available) {
        return false;
      }
      available -= samples;
      return true;
    },
  };
}
