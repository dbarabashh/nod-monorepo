import type { UpdateState } from '../../../../shared/ipc.ts';

export function describeUpdate(
  state: UpdateState,
  formatTime: (at: number) => string,
): string {
  switch (state.status) {
    case 'unavailable':
      return state.reason;
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return `Downloading Nod ${state.version}…`;
    case 'ready':
      return `Nod ${state.version} is downloaded. It’s installed when Nod restarts.`;
    case 'available':
      return `Nod ${state.version} is out. Download it from the release page and install it over this version.`;
    case 'idle':
      if (state.error !== null) {
        return state.error;
      }
      return state.checkedAt === null
        ? `This is Nod ${state.current}.`
        : `Nod ${state.current} is the latest version. Checked at ${formatTime(state.checkedAt)}.`;
  }
}

export function updateToShow(state: UpdateState): string | null {
  return state.status === 'ready' || state.status === 'available'
    ? state.version
    : null;
}
