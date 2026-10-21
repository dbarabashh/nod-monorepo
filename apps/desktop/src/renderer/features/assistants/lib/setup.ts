import type { McpState } from '../../../../shared/ipc.ts';

export type SetupKind = 'program' | 'address';

export function setupText(
  kind: SetupKind,
  state: Pick<McpState, 'command' | 'args' | 'port' | 'url'>,
  key: string,
): string {
  const server =
    kind === 'program'
      ? {
          command: state.command,
          args: state.args,
          env: { NOD_MCP_KEY: key, NOD_MCP_PORT: String(state.port) },
        }
      : {
          type: 'http',
          url: state.url,
          headers: { Authorization: `Bearer ${key}` },
        };
  return JSON.stringify({ mcpServers: { nod: server } }, null, 2);
}
