export type MeetingApp = {
  key: string;
  name: string;
  kind: 'call' | 'browser';
};

type Known = MeetingApp & {
  bundles: string[];
  binaries: string[];
};

// Each system names the process that records differently: macOS by bundle id,
// often a helper's (com.google.Chrome.helper), Windows by executable path and
// Linux by the binary or the name the audio server was given.
const known: Known[] = [
  {
    key: 'zoom',
    name: 'Zoom',
    kind: 'call',
    bundles: ['us.zoom'],
    binaries: ['zoom', 'zoom.us', 'cpthost', 'zoom voiceengine'],
  },
  {
    key: 'teams',
    name: 'Microsoft Teams',
    kind: 'call',
    bundles: ['com.microsoft.teams', 'com.microsoft.teams2'],
    binaries: ['teams', 'ms-teams', 'msteams', 'teams-for-linux'],
  },
  {
    key: 'slack',
    name: 'Slack',
    kind: 'call',
    bundles: ['com.tinyspeck.slackmacgap'],
    binaries: ['slack'],
  },
  {
    key: 'discord',
    name: 'Discord',
    kind: 'call',
    bundles: ['com.hnc.discord'],
    binaries: ['discord'],
  },
  {
    key: 'facetime',
    name: 'FaceTime',
    kind: 'call',
    // FaceTime calls record through the system's conferencing service.
    bundles: ['com.apple.facetime', 'com.apple.avconferenced'],
    binaries: [],
  },
  {
    key: 'webex',
    name: 'Webex',
    kind: 'call',
    bundles: ['com.cisco.webexmeetingsapp', 'cisco-systems.spark'],
    binaries: ['webex', 'ciscocollabhost', 'webexmta'],
  },
  {
    key: 'chrome',
    name: 'Chrome',
    kind: 'browser',
    bundles: ['com.google.chrome'],
    binaries: [
      'chrome',
      'google-chrome',
      'google chrome',
      'chromium',
      'chromium-browser',
      'webrtc voiceengine',
    ],
  },
  {
    key: 'edge',
    name: 'Edge',
    kind: 'browser',
    bundles: ['com.microsoft.edgemac'],
    binaries: ['msedge', 'microsoft-edge', 'microsoft edge'],
  },
  {
    key: 'firefox',
    name: 'Firefox',
    kind: 'browser',
    bundles: ['org.mozilla.firefox'],
    binaries: ['firefox', 'firefox-bin'],
  },
  {
    key: 'safari',
    name: 'Safari',
    kind: 'browser',
    // Safari records through WebKit's shared media process.
    bundles: ['com.apple.safari', 'com.apple.webkit.gpu'],
    binaries: [],
  },
  {
    key: 'arc',
    name: 'Arc',
    kind: 'browser',
    bundles: ['company.thebrowser.browser'],
    binaries: ['arc'],
  },
  {
    key: 'brave',
    name: 'Brave',
    kind: 'browser',
    bundles: ['com.brave.browser'],
    binaries: ['brave', 'brave-browser'],
  },
  {
    key: 'opera',
    name: 'Opera',
    kind: 'browser',
    bundles: ['com.operasoftware.opera'],
    binaries: ['opera'],
  },
  {
    key: 'vivaldi',
    name: 'Vivaldi',
    kind: 'browser',
    bundles: ['com.vivaldi.vivaldi'],
    binaries: ['vivaldi', 'vivaldi-bin'],
  },
];

// A Windows Store app is named by its package family (MSTeams_8wekyb3d8bbwe),
// a desktop one by its executable path.
function baseName(identifier: string): string {
  const last = identifier.split(/[\\/#]/).at(-1) ?? identifier;
  return last.replace(/\.exe$/, '').replace(/_[a-z0-9]{13}$/, '');
}

// A recorder, dictation or a voice memo uses the microphone too; only apps
// people hold calls in count, so those never suggest taking notes.
export function meetingApp(identifier: string): MeetingApp | null {
  const id = identifier.trim().toLowerCase();
  if (id === '') {
    return null;
  }
  const base = baseName(id);
  const app = known.find(
    (candidate) =>
      candidate.bundles.some(
        (bundle) => id === bundle || id.startsWith(`${bundle}.`),
      ) || candidate.binaries.includes(base),
  );
  return app ? { key: app.key, name: app.name, kind: app.kind } : null;
}

export function recordingTitle(app: MeetingApp): string {
  return app.kind === 'browser' ? 'Meeting' : `${app.name} meeting`;
}
