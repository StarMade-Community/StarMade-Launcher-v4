// ─── Shared types for the remote connection backend framework ─────────────────
//
// Backends (StarMote, Azure VM, …) all implement IRemoteBackend so the IPC
// layer can route connect / disconnect / command calls without knowing the
// underlying transport.

export type RemoteBackendType = 'starmote' | 'azure-vm';

export type RemoteConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'ready'
  | 'error';

export type RemoteReasonCode =
  // StarMote success / progress codes
  | 'connected'
  | 'authenticating'
  | 'ready'
  // StarMote failure codes
  | 'auth_failed'
  | 'timeout'
  | 'connect_failed'
  | 'socket_error'
  | 'protocol_timeout'
  | 'registry_unavailable'
  | 'not_ready'
  | 'invalid_command'
  | 'send_failed'
  | 'closed'
  | 'disconnected'
  | 'replaced'
  // Azure VM / SSH codes
  | 'ssh_connect_failed'
  | 'ssh_command_failed';

/** Uniform connection status emitted by every backend. */
export interface RemoteConnectionStatus {
  serverId: string;
  backend: RemoteBackendType;
  connected: boolean;
  state?: RemoteConnectionState;
  isReady?: boolean;
  host?: string;
  port?: number;
  username?: string;
  connectedAt?: string;
  error?: string;
  reasonCode?: RemoteReasonCode;
}

/** Uniform runtime output line emitted by every backend. */
export interface RemoteRuntimeEvent {
  version: 1;
  serverId: string;
  line: string;
  /** Origin of the line – backends add their own source tags. */
  source: 'framed-packet' | 'text-fallback' | 'ssh-stdout' | 'ssh-stderr';
  commandId?: number;
}

/** Options passed to IRemoteBackend.connect(). */
export interface RemoteConnectOptions {
  serverId: string;
  backend: RemoteBackendType;
  host: string;
  /** Game port (StarMote) or informational for other backends. */
  port: number;
  username?: string;
  clientVersion?: string;
  activeAccountId?: string;
  authToken?: string;
  // ── Azure VM / SSH ───────────────────────────────────────────────────────
  sshPort?: number;
  /** Path to SSH private key file. Mutually exclusive with sshPassword. */
  sshKeyPath?: string;
  /** SSH password. Used when no key is provided. Stored only in memory. */
  sshPassword?: string;
}

export interface RemoteConnectResult {
  success: boolean;
  status?: RemoteConnectionStatus;
  error?: string;
}

export interface RemoteCommandResult {
  success: boolean;
  status?: RemoteConnectionStatus;
  error?: string;
  reasonCode?: RemoteReasonCode;
}

/** Contract that every remote connection backend must satisfy. */
export interface IRemoteBackend {
  connect(options: RemoteConnectOptions): Promise<RemoteConnectResult>;
  disconnect(serverId: string): RemoteConnectResult;
  sendAdminCommand(payload: { serverId: string; command: string }): Promise<RemoteCommandResult>;
  getStatusFor(serverId: string): RemoteConnectionStatus;
  getStatuses(): RemoteConnectionStatus[];
}
