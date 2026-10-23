// What a meeting's menu needs to offer "Share with…": the people to pick
// from and the call that shares, handed down by the app shell so the
// meetings feature never imports sharing.
export type ShareTargets = {
  peers: Array<{ identity: string; code: string }>;
  share: (meetingId: string, peer: string) => Promise<void>;
};
