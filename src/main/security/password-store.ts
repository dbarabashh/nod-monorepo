// Chromium picks Linux's secret store from the desktop name. Desktops it
// knows get libsecret or KWallet; any other one, such as a tiling window
// manager, silently falls back to a key built into Chromium, which the app
// refuses. Those desktops are pointed at libsecret, which reaches any
// running Secret Service (GNOME Keyring, KeePassXC, KWallet).
const knownDesktops = [
  'gnome',
  'unity',
  'xfce',
  'cinnamon',
  'pantheon',
  'deepin',
  'ukui',
  'kde',
  'lxqt',
  'budgie',
];

export function linuxPasswordStore(env: {
  XDG_CURRENT_DESKTOP?: string;
}): 'gnome-libsecret' | null {
  const desktops = (env.XDG_CURRENT_DESKTOP ?? '')
    .toLowerCase()
    .split(':')
    .map((name) => name.trim());
  return desktops.some((name) =>
    knownDesktops.some((known) => name.includes(known)),
  )
    ? null
    : 'gnome-libsecret';
}
