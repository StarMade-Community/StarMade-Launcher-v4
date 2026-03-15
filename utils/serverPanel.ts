import type { ManagedItem, ServerLifecycleState } from '../types';

export type DatabaseSectorLoadFilter = 'all' | 'loaded' | 'unloaded';
export type RemoteFileAccessProtocol = 'none' | 'ftp' | 'sftp';

const WILDCARD_HOSTS = new Set([
  'all',
  '*',
  '0.0.0.0',
  '::',
  '::0',
  '0:0:0:0:0:0:0:0',
]);

export function normalizeRemoteConnectHost(host: string | null | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return WILDCARD_HOSTS.has(trimmed.toLowerCase()) ? '127.0.0.1' : trimmed;
}

export function resolveDefaultRemoteConnectHost(server: ManagedItem | null | undefined, listenIp: string | null | undefined): string {
  const normalizedProfileHost = normalizeRemoteConnectHost(server?.serverIp);
  const normalizedListenHost = normalizeRemoteConnectHost(listenIp);

  if (server?.isRemote) {
    return normalizedProfileHost ?? normalizedListenHost ?? '127.0.0.1';
  }

  return normalizedListenHost ?? normalizedProfileHost ?? '127.0.0.1';
}

export function shouldAutoLoadDatabaseEntities(options: {
  activeTab: string;
  databaseIsExecuting: boolean;
  lifecycleState: ServerLifecycleState;
  serverId?: string | null;
  autoLoadedServerIds: Set<string>;
}): boolean {
  const { activeTab, databaseIsExecuting, lifecycleState, serverId, autoLoadedServerIds } = options;
  return (
    activeTab === 'database'
    && lifecycleState === 'running'
    && !!serverId
    && !databaseIsExecuting
    && !autoLoadedServerIds.has(serverId)
  );
}

export function matchesDatabaseSectorLoadFilter(sectorLoaded: boolean, filter: DatabaseSectorLoadFilter): boolean {
  if (filter === 'loaded') return sectorLoaded;
  if (filter === 'unloaded') return !sectorLoaded;
  return true;
}

export function isRemoteCommandActionEnabled(options: {
  isRemoteServer: boolean;
  remoteState?: string;
  isRemoteReady?: boolean;
}): boolean {
  const { isRemoteServer, remoteState, isRemoteReady } = options;
  if (!isRemoteServer) return true;
  return isRemoteReady === true || remoteState === 'ready';
}

export function buildDatabaseEntityListSql(): string {
  return (
    'SELECT e.ID, e.UID, e.NAME, e.TYPE, e.FACTION, e.X, e.Y, e.Z, ' +
    'CASE WHEN s.TRANSIENT = FALSE THEN TRUE ELSE FALSE END AS SECTOR_LOADED ' +
    'FROM ENTITIES e ' +
    'LEFT JOIN SECTORS s ON s.X = e.X AND s.Y = e.Y AND s.Z = e.Z ' +
    'ORDER BY e.X, e.Y, e.Z, e.NAME'
  );
}

const ENTITY_TYPE_LABEL_BY_CODE: Record<number, string> = {
  1: 'Shop',
  2: 'Station',
  3: 'Asteroid',
  4: 'Planet Segment',
  5: 'Ship',
  6: 'Asteroid (Managed)',
  7: 'Space Creature',
  8: 'Planet Icon',
};

/**
 * Convert StarMade entity TYPE values into human-readable labels for UI display.
 */
export function formatDatabaseEntityType(typeValue: string): string {
  const numericCode = Number.parseInt(typeValue, 10);
  if (!Number.isFinite(numericCode)) {
    const trimmed = typeValue.trim();
    return trimmed || 'Unknown';
  }

  return ENTITY_TYPE_LABEL_BY_CODE[numericCode] ?? `Type ${numericCode}`;
}

export function getDefaultRemoteFileAccessPort(protocol: RemoteFileAccessProtocol): string {
  if (protocol === 'sftp') return '22';
  if (protocol === 'ftp') return '21';
  return '';
}

export function resolveDefaultRemoteFileAccessHost(server: ManagedItem | null | undefined, fallbackHost: string): string {
  return server?.remoteFileAccessHost?.trim()
    || normalizeRemoteConnectHost(server?.serverIp)
    || fallbackHost;
}

export function isServerUpdateSupported(server: ManagedItem | null | undefined): boolean {
  return !!server && !server.isRemote;
}

