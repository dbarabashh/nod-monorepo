export type DisplayCaptureGate = {
  open: () => void;
  pass: () => boolean;
};

export function createDisplayCaptureGate(
  now: () => number,
  windowMs: number,
): DisplayCaptureGate {
  let openUntil = 0;
  return {
    open: () => {
      openUntil = now() + windowMs;
    },
    pass: () => {
      const open = now() < openUntil;
      openUntil = 0;
      return open;
    },
  };
}
