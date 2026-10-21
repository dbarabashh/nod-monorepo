import { handleMessages, type ToolResult } from '@nod/core/mcp';
import { meetingName, type Meeting } from '@nod/core/meetings';
import {
  mcpActivityLimit,
  type McpActivity,
  type McpConnection,
  type McpScope,
  type McpState,
} from '../../shared/ipc.ts';
import {
  clientForKey,
  clientForKeyId,
  newClient,
  type McpClient,
} from './auth.ts';
import { createMcpHttpServer, mcpPath } from './http-server.ts';
import type { McpSettings, McpSettingsFile } from './settings-file.ts';

const activityNames = 5;
const lastUsedSaveMs = 60_000;
// Generous for an assistant at work, but a runaway loop or a stolen key can't
// keep the main process busy searching.
const callsPerWindow = 60;
const callWindowMs = 60_000;
const namedTools = new Set(['get_meeting', 'search_meetings']);

const notices = {
  'set-aside':
    'The saved settings for AI assistants couldn’t be opened and were set aside. Turn the connection on and connect your assistants again.',
  unavailable:
    'Secure storage isn’t available, so AI assistants stay off until Nod restarts with the system keyring unlocked.',
};

export type McpService = ReturnType<typeof createMcpService>;

export function createMcpService(options: {
  file: McpSettingsFile;
  port: number;
  version: string;
  stdio: { command: string; args: string[]; note: string | null };
  meetings: () => readonly Meeting[];
  now: () => number;
  onChange: () => void;
}) {
  let settings: McpSettings = { enabled: false, clients: [] };
  let server: ReturnType<typeof createMcpHttpServer> | null = null;
  let problem: string | null = null;
  const revoking = new Set<string>();
  const activity: McpActivity[] = [];
  const windows = new Map<string, { start: number; count: number }>();
  let lastUsedSavedAt = 0;
  let saving: Promise<void> = Promise.resolve();
  // Turning on and off runs one step at a time, so a quick double toggle
  // can't leave a server listening while settings say it is off.
  let switching: Promise<void> = Promise.resolve();

  // Taking access away (turning off, disconnecting) holds from the moment it
  // is asked for: until a save carrying it lands, it overrides whatever else
  // changes in memory and goes into every save, even after a failed one.
  // The request to turn off still waiting to be saved, numbered so a save
  // that began before a later on-and-off can't mark the later one done.
  let turningOff: number | null = null;
  let offRequests = 0;

  function withRemovals(current: McpSettings, onDisk: boolean): McpSettings {
    return {
      enabled: turningOff !== null ? false : current.enabled,
      clients: onDisk
        ? current.clients.filter((client) => !revoking.has(client.id))
        : current.clients,
    };
  }

  // Every change is a function of the settings as they are when its turn to
  // be saved comes, so changes made meanwhile (another assistant added or
  // disconnected) are never written over. What grants access takes effect
  // once saved.
  function update(
    change: (current: McpSettings) => McpSettings,
    saved: () => void = () => {},
  ): Promise<void> {
    const run = saving.then(async () => {
      const off = turningOff;
      const removed = [...revoking];
      await options.file.save(withRemovals(change(settings), true));
      const next = withRemovals(change(settings), false);
      settings = {
        ...next,
        clients: next.clients.filter((client) => !removed.includes(client.id)),
      };
      for (const id of removed) {
        revoking.delete(id);
      }
      if (off !== null && turningOff === off) {
        turningOff = null;
      }
      saved();
    });
    saving = run.catch(() => undefined);
    return run.finally(() => apply());
  }

  function admit(client: McpClient): boolean {
    const at = options.now();
    const window = windows.get(client.id);
    if (!window || at - window.start >= callWindowMs) {
      windows.set(client.id, { start: at, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= callsPerWindow;
  }

  function used(client: McpClient, tool: string, result: ToolResult) {
    const at = options.now();
    settings = {
      ...settings,
      clients: settings.clients.map((candidate) =>
        candidate.id === client.id
          ? { ...candidate, lastUsedAt: at }
          : candidate,
      ),
    };
    const names = namedTools.has(tool)
      ? options
          .meetings()
          .filter((meeting) => result.meetingIds.includes(meeting.id))
          .slice(0, activityNames)
          .map(meetingName)
      : [];
    activity.unshift({ at, client: client.name, tool, meetings: names });
    activity.length = Math.min(activity.length, mcpActivityLimit);
    if (at - lastUsedSavedAt >= lastUsedSaveMs) {
      lastUsedSavedAt = at;
      void update((current) => current).catch(() => undefined);
    }
    options.onChange();
  }

  function current(client: McpClient | null): McpClient | null {
    return client && !revoking.has(client.id) ? client : null;
  }

  async function start() {
    const instance = createMcpHttpServer({
      port: options.port,
      now: options.now,
      // Looked up on every request, so a disconnected key stops at once.
      byKey: (key) => current(clientForKey(settings.clients, key)),
      byKeyId: (keyId) => current(clientForKeyId(settings.clients, keyId)),
      handle: (client, message) =>
        handleMessages(message, {
          scopes: client.scopes,
          meetings: options.meetings,
          serverVersion: options.version,
          admitCall: () => admit(client),
          onToolCall: (tool, result) => used(client, tool, result),
        }),
    });
    try {
      await instance.listen();
      server = instance;
      problem = null;
    } catch (error) {
      problem =
        error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
          ? `Another program is using port ${options.port}.`
          : 'The connection for AI assistants couldn’t start.';
    }
  }

  function apply(): Promise<void> {
    switching = switching.then(async () => {
      if (settings.enabled && !server) {
        await start();
      } else if (!settings.enabled && server) {
        const running = server;
        server = null;
        await running.close();
      }
      options.onChange();
    });
    return switching;
  }

  return {
    load: async () => {
      const loaded = await options.file.load();
      settings = loaded.settings;
      problem = loaded.problem === null ? null : notices[loaded.problem];
      await apply();
    },
    state: (): McpState => ({
      enabled: settings.enabled,
      status: server ? 'running' : settings.enabled ? 'failed' : 'off',
      problem,
      port: options.port,
      url: `http://127.0.0.1:${options.port}${mcpPath}`,
      command: options.stdio.command,
      args: options.stdio.args,
      setupNote: options.stdio.note,
      clients: settings.clients.map(({ keyHash: _hash, ...client }) => ({
        ...client,
        revoking: revoking.has(client.id),
      })),
      activity,
    }),
    setEnabled: async (enabled: boolean) => {
      turningOff = enabled ? null : (offRequests += 1);
      if (!enabled) {
        settings = { ...settings, enabled: false };
        problem = null;
        void apply();
      }
      try {
        await update(
          (current) => ({ ...current, enabled }),
          () => {
            problem = null;
          },
        );
      } catch (error) {
        throw enabled
          ? error
          : new Error(
              'The connection is off, but that couldn’t be saved yet. If Nod restarts before it is, the connection comes back on.',
            );
      }
    },
    addClient: async (
      name: string,
      scopes: McpScope[],
    ): Promise<McpConnection> => {
      const { client, key } = newClient(name, scopes, options.now());
      await update((current) =>
        current.clients.some((candidate) => candidate.id === client.id)
          ? current
          : { ...current, clients: [...current.clients, client] },
      );
      const { keyHash: _hash, ...info } = client;
      return { key, client: { ...info, revoking: false } };
    },
    // Refused at once and listed until a save carries the removal, so a failed
    // save can be retried instead of the key quietly working after a restart.
    revokeClient: async (id: string) => {
      revoking.add(id);
      windows.delete(id);
      options.onChange();
      try {
        await update((current) => current);
      } finally {
        options.onChange();
      }
    },
    stop: async () => {
      turningOff = offRequests += 1;
      settings = { ...settings, enabled: false };
      await apply();
    },
  };
}
