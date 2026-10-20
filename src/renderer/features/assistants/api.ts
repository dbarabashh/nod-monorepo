import type { McpConnection, McpScope, McpState } from '../../../shared/ipc.ts';

export function getMcpState(): Promise<McpState> {
  return window.api.getMcpState();
}

export function onMcpChanged(callback: (state: McpState) => void): () => void {
  return window.api.onMcpChanged(callback);
}

export function setMcpEnabled(enabled: boolean): Promise<void> {
  return window.api.setMcpEnabled(enabled);
}

export function addMcpClient(
  name: string,
  scopes: McpScope[],
): Promise<McpConnection> {
  return window.api.addMcpClient(name, scopes);
}

export function revokeMcpClient(id: string): Promise<void> {
  return window.api.revokeMcpClient(id);
}

export function copyMcpSetup(text: string): Promise<void> {
  return window.api.copyMcpSetup(text);
}
