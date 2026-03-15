import { describe, expect, it } from 'vitest';

import type { ManagedItem, ServerLifecycleState } from '../../types';
import {
  buildDatabaseEntityListSql,
  formatDatabaseEntityType,
  getDefaultRemoteFileAccessPort,
  isServerUpdateSupported,
  matchesDatabaseSectorLoadFilter,
  normalizeRemoteConnectHost,
  resolveDefaultRemoteConnectHost,
  resolveDefaultRemoteFileAccessHost,
  shouldAutoLoadDatabaseEntities,
} from '../../utils/serverPanel';

const baseServer: ManagedItem = {
  id: 'server-1',
  name: 'Test Server',
  version: '0.203.175',
  type: 'release',
  icon: 'server',
  path: '/tmp/server',
  lastPlayed: 'Never',
  port: '4242',
  isRemote: false,
};

describe('serverPanel helpers', () => {
  it('normalizes wildcard bind hosts to loopback for remote connect defaults', () => {
    expect(normalizeRemoteConnectHost('all')).toBe('127.0.0.1');
    expect(normalizeRemoteConnectHost('0.0.0.0')).toBe('127.0.0.1');
    expect(normalizeRemoteConnectHost('::')).toBe('127.0.0.1');
  });

  it('prefers live local listen host when deriving a default connect host', () => {
    expect(resolveDefaultRemoteConnectHost(baseServer, '192.168.1.55')).toBe('192.168.1.55');
    expect(resolveDefaultRemoteConnectHost(baseServer, 'all')).toBe('127.0.0.1');
  });

  it('prefers saved remote profile host for remote servers', () => {
    const remoteServer: ManagedItem = {
      ...baseServer,
      isRemote: true,
      serverIp: 'play.example.com',
      path: '',
    };

    expect(resolveDefaultRemoteConnectHost(remoteServer, 'all')).toBe('play.example.com');
  });

  it('auto-loads database entities only once per running server while on the database tab', () => {
    const lifecycleState: ServerLifecycleState = 'running';
    const loadedIds = new Set<string>();

    expect(shouldAutoLoadDatabaseEntities({
      activeTab: 'database',
      databaseIsExecuting: false,
      lifecycleState,
      serverId: 'server-1',
      autoLoadedServerIds: loadedIds,
    })).toBe(true);

    loadedIds.add('server-1');

    expect(shouldAutoLoadDatabaseEntities({
      activeTab: 'database',
      databaseIsExecuting: false,
      lifecycleState,
      serverId: 'server-1',
      autoLoadedServerIds: loadedIds,
    })).toBe(false);

    expect(shouldAutoLoadDatabaseEntities({
      activeTab: 'control',
      databaseIsExecuting: false,
      lifecycleState,
      serverId: 'server-1',
      autoLoadedServerIds: new Set<string>(),
    })).toBe(false);

    expect(shouldAutoLoadDatabaseEntities({
      activeTab: 'database',
      databaseIsExecuting: false,
      lifecycleState: 'stopped',
      serverId: 'server-1',
      autoLoadedServerIds: new Set<string>(),
    })).toBe(false);
  });

  it('matches database entities against loaded/unloaded/all sector filters', () => {
    expect(matchesDatabaseSectorLoadFilter(true, 'all')).toBe(true);
    expect(matchesDatabaseSectorLoadFilter(false, 'all')).toBe(true);
    expect(matchesDatabaseSectorLoadFilter(true, 'loaded')).toBe(true);
    expect(matchesDatabaseSectorLoadFilter(false, 'loaded')).toBe(false);
    expect(matchesDatabaseSectorLoadFilter(true, 'unloaded')).toBe(false);
    expect(matchesDatabaseSectorLoadFilter(false, 'unloaded')).toBe(true);
  });

  it('builds the entity query with sector load-state metadata for all sectors', () => {
    const sql = buildDatabaseEntityListSql();

    expect(sql).toContain('LEFT JOIN SECTORS');
    expect(sql).toContain('AS SECTOR_LOADED');
    expect(sql).not.toContain('WHERE s.TRANSIENT = FALSE');
  });

  it('formats known StarMade entity type codes for display', () => {
    expect(formatDatabaseEntityType('1')).toBe('Shop');
    expect(formatDatabaseEntityType('2')).toBe('Station');
    expect(formatDatabaseEntityType('5')).toBe('Ship');
    expect(formatDatabaseEntityType('8')).toBe('Planet Icon');
  });

  it('falls back gracefully for unknown or non-numeric entity type values', () => {
    expect(formatDatabaseEntityType('99')).toBe('Type 99');
    expect(formatDatabaseEntityType('NPC')).toBe('NPC');
    expect(formatDatabaseEntityType('   ')).toBe('Unknown');
  });

  it('provides sensible default ports for FTP/SFTP planning fields', () => {
    expect(getDefaultRemoteFileAccessPort('sftp')).toBe('22');
    expect(getDefaultRemoteFileAccessPort('ftp')).toBe('21');
    expect(getDefaultRemoteFileAccessPort('none')).toBe('');
  });

  it('resolves the remote file-access host from explicit metadata or the remote server host', () => {
    expect(resolveDefaultRemoteFileAccessHost({ ...baseServer, remoteFileAccessHost: 'files.example.com' }, '127.0.0.1')).toBe('files.example.com');
    expect(resolveDefaultRemoteFileAccessHost({ ...baseServer, serverIp: 'game.example.com' }, '127.0.0.1')).toBe('game.example.com');
    expect(resolveDefaultRemoteFileAccessHost(baseServer, '127.0.0.1')).toBe('127.0.0.1');
  });

  it('disables update support for remote server profiles', () => {
    expect(isServerUpdateSupported(baseServer)).toBe(true);
    expect(isServerUpdateSupported({ ...baseServer, isRemote: true, path: '' })).toBe(false);
    expect(isServerUpdateSupported(null)).toBe(false);
  });
});

