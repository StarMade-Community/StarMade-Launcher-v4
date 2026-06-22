// ─── Shared types for the remote connection backend framework ─────────────────
//
// Backends (StarMote, Azure VM, …) all implement IRemoteBackend so the IPC
// layer can route connect / disconnect / command calls without knowing the
// underlying transport.

export type RemoteBackendType = 'starmote' | 'azure-vm' | 'docker';

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
  | 'ssh_command_failed'
  // Docker codes
  | 'docker_unavailable'
  | 'docker_connect_failed'
  | 'docker_container_missing'
  | 'docker_command_failed';

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
  /** screen/tmux session name to target when injecting admin commands. */
  screenSessionName?: string;
  /** Absolute path to the StarMade server root on the remote host (e.g. /home/user/Servers/SOE). Used to locate the log file. */
  serverRootPath?: string;
  // ── Docker ─────────────────────────────────────────────────────────────────
  /**
   * Docker daemon host the local `docker` CLI should target via `-H`.
   * Examples: `ssh://user@host`, `tcp://203.0.113.10:2375`. Empty/undefined
   * targets the local Docker socket.
   */
  dockerHost?: string;
  /** Name or id of the container running the StarMade server. */
  dockerContainer?: string;
}

// ─── Runtime metrics ───────────────────────────────────────────────────────────

export type ServerMetricsSource = 'local' | 'docker' | 'ssh' | 'unavailable';

/** Point-in-time resource usage sample for a running server (local or remote). */
export interface ServerMetricsSample {
  ok: boolean;
  /** Epoch milliseconds the sample was taken. */
  timestamp: number;
  source: ServerMetricsSource;
  /**
   * CPU usage as a percentage. For process samples this is percent of a single
   * core (so a value > 100 means more than one core's worth of work). For SSH
   * host samples it is the host's overall CPU utilisation (0–100).
   */
  cpuPercent?: number;
  /** Number of logical cores available on the host, used to normalise cpuPercent. */
  cpuCores?: number;
  /** Resident memory used, in bytes. */
  memoryBytes?: number;
  /** Memory ceiling (container limit or host total), in bytes, when known. */
  memoryLimitBytes?: number;
  /** Memory used as a percentage of the limit, when known. */
  memoryPercent?: number;
  /** Cumulative bytes received over the network (docker only), when known. */
  netRxBytes?: number;
  /** Cumulative bytes transmitted over the network (docker only), when known. */
  netTxBytes?: number;
  /** Number of OS threads/processes (docker only), when known. */
  pids?: number;
  /** Process/container uptime in milliseconds, when known. */
  uptimeMs?: number;
  /** Human-readable label describing what the sample measures. */
  scopeLabel?: string;
  /** Populated when ok === false. */
  error?: string;
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
