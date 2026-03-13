import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import PageContainer from '../../common/PageContainer';
import { useData } from '../../../contexts/DataContext';
import { useApp } from '../../../contexts/AppContext';
import type { ManagedItem, ServerLifecycleState, ServerLogLevel } from '../../../types';

interface ServerPanelProps {
  serverId?: string;
  serverName?: string;
}

type ServerPanelTab = 'control' | 'actions' | 'logs' | 'configuration' | 'files' | 'database';
type LogFilter = 'all' | 'errors' | 'warnings' | 'info' | 'debug';
type DashboardWidgetId = 'status' | 'serverInfo' | 'connection' | 'players' | 'controls';
type ServerActionId = 'start' | 'stop' | 'restart' | 'update';

interface LogEntry {
  timestamp: string;
  level: ServerLogLevel;
  message: string;
}

interface DashboardGroup {
  id: string;
  title: string;
  widgetIds: DashboardWidgetId[];
}

interface DashboardLayout {
  groups: DashboardGroup[];
  hiddenWidgetIds: DashboardWidgetId[];
  quickActionIds: ServerActionId[];
}

interface DraggedWidget {
  widgetId: DashboardWidgetId;
  sourceGroupId: string;
}

interface DraggedQuickAction {
  actionId: ServerActionId;
}

const LOG_BUFFER_CAP = 1200;
const DASHBOARD_STORE_KEY = 'serverPanelDashboardLayoutsV1';

const ALL_WIDGETS: Array<{ id: DashboardWidgetId; label: string }> = [
  { id: 'status', label: 'Server Status' },
  { id: 'serverInfo', label: 'Server Info' },
  { id: 'connection', label: 'Connection Info' },
  { id: 'players', label: 'Players' },
  { id: 'controls', label: 'Server Controls' },
];

const tabItems: { id: ServerPanelTab; label: string }[] = [
  { id: 'control', label: 'Control Panel' },
  { id: 'actions', label: 'Actions' },
  { id: 'logs', label: 'Logs' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'files', label: 'Files' },
  { id: 'database', label: 'Database' },
];

const sectionShellClass = 'rounded-lg border border-white/10 bg-black/20 p-4';

const createDefaultDashboardLayout = (): DashboardLayout => ({
  groups: [
    { id: 'main', title: 'Main', widgetIds: ['status', 'serverInfo', 'connection', 'controls'] },
    { id: 'players', title: 'Players', widgetIds: ['players'] },
  ],
  hiddenWidgetIds: [],
  quickActionIds: ['start', 'stop', 'restart', 'update'],
});

const isServerActionId = (value: unknown): value is ServerActionId => (
  value === 'start' ||
  value === 'stop' ||
  value === 'restart' ||
  value === 'update'
);

const isDashboardWidgetId = (value: unknown): value is DashboardWidgetId => (
  value === 'status' ||
  value === 'serverInfo' ||
  value === 'connection' ||
  value === 'players' ||
  value === 'controls'
);

const cloneLayout = (layout: DashboardLayout): DashboardLayout => ({
  groups: layout.groups.map((group) => ({ ...group, widgetIds: [...group.widgetIds] })),
  hiddenWidgetIds: [...layout.hiddenWidgetIds],
  quickActionIds: [...layout.quickActionIds],
});

const normalizeLayout = (raw: unknown): DashboardLayout => {
  const fallback = createDefaultDashboardLayout();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;

  const root = raw as { groups?: unknown; hiddenWidgetIds?: unknown; quickActionIds?: unknown };
  const seen = new Set<DashboardWidgetId>();
  const groups: DashboardGroup[] = [];

  if (Array.isArray(root.groups)) {
    for (const entry of root.groups) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const candidate = entry as { id?: unknown; title?: unknown; widgetIds?: unknown };
      if (typeof candidate.id !== 'string' || !candidate.id.trim()) continue;

      const title = typeof candidate.title === 'string' && candidate.title.trim()
        ? candidate.title.trim()
        : 'Group';

      const widgetIds: DashboardWidgetId[] = [];
      if (Array.isArray(candidate.widgetIds)) {
        for (const widgetId of candidate.widgetIds) {
          if (isDashboardWidgetId(widgetId) && !seen.has(widgetId)) {
            widgetIds.push(widgetId);
            seen.add(widgetId);
          }
        }
      }

      groups.push({ id: candidate.id, title, widgetIds });
    }
  }

  if (groups.length === 0) {
    return fallback;
  }

  const hiddenWidgetIds: DashboardWidgetId[] = [];
  if (Array.isArray(root.hiddenWidgetIds)) {
    for (const widgetId of root.hiddenWidgetIds) {
      if (isDashboardWidgetId(widgetId) && !seen.has(widgetId)) {
        hiddenWidgetIds.push(widgetId);
        seen.add(widgetId);
      }
    }
  }

  for (const widget of ALL_WIDGETS) {
    if (!seen.has(widget.id)) {
      hiddenWidgetIds.push(widget.id);
      seen.add(widget.id);
    }
  }

  const quickActionIds: ServerActionId[] = [];
  if (Array.isArray(root.quickActionIds)) {
    for (const actionId of root.quickActionIds) {
      if (isServerActionId(actionId) && !quickActionIds.includes(actionId)) {
        quickActionIds.push(actionId);
      }
    }
  }

  return {
    groups,
    hiddenWidgetIds,
    quickActionIds: quickActionIds.length > 0 ? quickActionIds : fallback.quickActionIds,
  };
};

const normalizeLogLevel = (level: string): ServerLogLevel => {
  const normalized = level.toUpperCase();
  if (normalized === 'INFO') return 'INFO';
  if (normalized === 'WARNING' || normalized === 'WARN') return 'WARNING';
  if (normalized === 'ERROR') return 'ERROR';
  if (normalized === 'FATAL') return 'FATAL';
  if (normalized === 'DEBUG') return 'DEBUG';
  if (level === 'stdout') return 'stdout';
  if (level === 'stderr') return 'stderr';
  return 'INFO';
};

const formatUptime = (uptimeMs?: number): string => {
  if (!uptimeMs || uptimeMs <= 0) return '00:00:00';
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const createGroupId = (): string => `group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

interface ServerActionDefinition {
  id: ServerActionId;
  label: string;
  description: string;
  detail: string;
  enabled: boolean;
  emphasis?: 'default' | 'accent' | 'danger';
  onClick: () => void;
}

const ServerPanel: React.FC<ServerPanelProps> = ({ serverId, serverName }) => {
  const [activeTab, setActiveTab] = useState<ServerPanelTab>('control');
  const [filter, setFilter] = useState<LogFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lifecycleState, setLifecycleState] = useState<ServerLifecycleState>('stopped');
  const [runtimePid, setRuntimePid] = useState<number | undefined>(undefined);
  const [runtimeUptimeMs, setRuntimeUptimeMs] = useState<number | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(createDefaultDashboardLayout);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [isLayoutEditMode, setIsLayoutEditMode] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('main');
  const [newGroupName, setNewGroupName] = useState('');
  const [draggedWidget, setDraggedWidget] = useState<DraggedWidget | null>(null);
  const [draggedQuickAction, setDraggedQuickAction] = useState<DraggedQuickAction | null>(null);
  const [widgetDropTarget, setWidgetDropTarget] = useState<string | null>(null);
  const [quickActionDropTarget, setQuickActionDropTarget] = useState<number | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const { navigate } = useApp();
  const {
    servers,
    versions,
    activeAccount,
    selectedServer,
    selectedServerId,
    setSelectedServerId,
    downloadStatuses,
  } = useData();

  useEffect(() => {
    if (serverId && serverId !== selectedServerId) {
      setSelectedServerId(serverId);
    }
  }, [serverId, selectedServerId, setSelectedServerId]);

  const effectiveServer = useMemo<ManagedItem | null>(() => {
    if (serverId) {
      return servers.find((server) => server.id === serverId) ?? selectedServer;
    }
    return selectedServer;
  }, [serverId, servers, selectedServer]);

  const effectiveServerName = serverName || effectiveServer?.name || 'Server';
  const hasGameApi = typeof window !== 'undefined' && !!window.launcher?.game;
  const hasDownloadApi = typeof window !== 'undefined' && !!window.launcher?.download;
  const hasStoreApi = typeof window !== 'undefined' && !!window.launcher?.store;

  const serverDownloadStatus = effectiveServer ? downloadStatuses[effectiveServer.id] : undefined;
  const isUpdating = serverDownloadStatus?.state === 'checksums' || serverDownloadStatus?.state === 'downloading';

  const refreshRuntimeStatus = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) {
      setLifecycleState('stopped');
      setRuntimePid(undefined);
      setRuntimeUptimeMs(undefined);
      return;
    }

    try {
      const status = await window.launcher.game.status(effectiveServer.id);
      setRuntimePid(status.pid);
      setRuntimeUptimeMs(status.uptime);
      setLifecycleState((prev) => {
        if (status.running) return 'running';
        if (prev === 'starting' || prev === 'stopping') return prev;
        return 'stopped';
      });
    } catch (error) {
      console.error('[ServerPanel] Failed to refresh server status:', error);
      setLifecycleState('error');
      setActionError('Failed to query server status.');
    }
  }, [effectiveServer, hasGameApi]);

  useEffect(() => {
    void refreshRuntimeStatus();
    const interval = window.setInterval(() => {
      void refreshRuntimeStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    setLogs([]);
    setActionError(null);
    setLogPath(null);
  }, [effectiveServer?.id]);

  useEffect(() => {
    if (!effectiveServer || !hasGameApi) return;

    window.launcher.game.getLogPath(effectiveServer.id).then(setLogPath).catch(() => {
      setLogPath(null);
    });

    return window.launcher.game.onLog((data) => {
      if (data.installationId !== effectiveServer.id) return;

      const entry: LogEntry = {
        timestamp: new Date().toLocaleTimeString(),
        level: normalizeLogLevel(data.level),
        message: data.message,
      };

      setLogs((prev) => {
        const next = [...prev, entry];
        if (next.length <= LOG_BUFFER_CAP) return next;
        return next.slice(next.length - LOG_BUFFER_CAP);
      });
    });
  }, [effectiveServer, hasGameApi]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    if (!effectiveServer) {
      setDashboardLayout(createDefaultDashboardLayout());
      setDashboardLoaded(true);
      return;
    }

    let cancelled = false;

    const loadLayout = async () => {
      const serverKey = effectiveServer.id;
      const fallback = createDefaultDashboardLayout();

      try {
        let mapRaw: unknown = null;

        if (hasStoreApi) {
          mapRaw = await window.launcher.store.get(DASHBOARD_STORE_KEY);
        } else if (typeof window !== 'undefined') {
          const json = window.localStorage.getItem(DASHBOARD_STORE_KEY);
          mapRaw = json ? JSON.parse(json) : null;
        }

        if (cancelled) return;

        if (!mapRaw || typeof mapRaw !== 'object' || Array.isArray(mapRaw)) {
          setDashboardLayout(fallback);
          setDashboardLoaded(true);
          return;
        }

        const map = mapRaw as Record<string, unknown>;
        const normalized = normalizeLayout(map[serverKey]);
        setDashboardLayout(normalized);
        setDashboardLoaded(true);
      } catch (error) {
        console.warn('[ServerPanel] Failed to load dashboard layout:', error);
        if (!cancelled) {
          setDashboardLayout(fallback);
          setDashboardLoaded(true);
        }
      }
    };

    setDashboardLoaded(false);
    void loadLayout();

    return () => {
      cancelled = true;
    };
  }, [effectiveServer?.id, hasStoreApi]);

  useEffect(() => {
    if (!effectiveServer || !dashboardLoaded) return;

    const persistLayout = async () => {
      const serverKey = effectiveServer.id;
      const layoutToSave = cloneLayout(dashboardLayout);

      try {
        let existingMap: Record<string, unknown> = {};

        if (hasStoreApi) {
          const current = await window.launcher.store.get(DASHBOARD_STORE_KEY);
          if (current && typeof current === 'object' && !Array.isArray(current)) {
            existingMap = { ...(current as Record<string, unknown>) };
          }
          existingMap[serverKey] = layoutToSave;
          await window.launcher.store.set(DASHBOARD_STORE_KEY, existingMap);
        } else if (typeof window !== 'undefined') {
          const currentText = window.localStorage.getItem(DASHBOARD_STORE_KEY);
          if (currentText) {
            const parsed = JSON.parse(currentText) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              existingMap = { ...(parsed as Record<string, unknown>) };
            }
          }
          existingMap[serverKey] = layoutToSave;
          window.localStorage.setItem(DASHBOARD_STORE_KEY, JSON.stringify(existingMap));
        }
      } catch (error) {
        console.warn('[ServerPanel] Failed to save dashboard layout:', error);
      }
    };

    void persistLayout();
  }, [dashboardLayout, dashboardLoaded, effectiveServer?.id, hasStoreApi]);

  useEffect(() => {
    if (dashboardLayout.groups.some((group) => group.id === selectedGroupId)) return;
    setSelectedGroupId(dashboardLayout.groups[0]?.id ?? '');
  }, [dashboardLayout.groups, selectedGroupId]);

  useEffect(() => {
    if (isLayoutEditMode) return;
    setDraggedWidget(null);
    setDraggedQuickAction(null);
    setWidgetDropTarget(null);
    setQuickActionDropTarget(null);
  }, [isLayoutEditMode]);

  const resolveBuildPath = useCallback((server: ManagedItem): string | undefined => {
    if (server.buildPath) return server.buildPath;
    return versions.find((version) => version.id === server.version && version.type === server.type)?.buildPath;
  }, [versions]);

  const startServer = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) return;

    setActionError(null);
    setLifecycleState('starting');
    const result = await window.launcher.game.launch({
      installationId: effectiveServer.id,
      installationPath: effectiveServer.path,
      starMadeVersion: effectiveServer.version,
      minMemory: effectiveServer.minMemory ?? 1024,
      maxMemory: effectiveServer.maxMemory ?? 2048,
      jvmArgs: effectiveServer.jvmArgs ?? '',
      customJavaPath: effectiveServer.customJavaPath,
      isServer: true,
      serverPort: Number(effectiveServer.port) || 4242,
      activeAccountId: activeAccount?.id,
    });

    if (!result.success) {
      setLifecycleState('error');
      setActionError(result.error ?? 'Failed to start server.');
      return;
    }

    setLifecycleState('running');
    void refreshRuntimeStatus();
  }, [effectiveServer, hasGameApi, activeAccount?.id, refreshRuntimeStatus]);

  const stopServer = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) return;

    setActionError(null);
    setLifecycleState('stopping');
    const result = await window.launcher.game.stop(effectiveServer.id);

    if (!result.success) {
      setLifecycleState('error');
      setActionError('Failed to stop server.');
      return;
    }

    setLifecycleState('stopped');
    setRuntimePid(undefined);
    setRuntimeUptimeMs(undefined);
  }, [effectiveServer, hasGameApi]);

  const restartServer = useCallback(async () => {
    await stopServer();
    await startServer();
  }, [startServer, stopServer]);

  const updateServer = useCallback(async () => {
    if (!effectiveServer || !hasDownloadApi) return;

    const buildPath = resolveBuildPath(effectiveServer);
    if (!buildPath) {
      setActionError('Cannot update server: build path is unknown for the selected version.');
      return;
    }

    setActionError(null);
    try {
      await window.launcher.download.start(effectiveServer.id, buildPath, effectiveServer.path);
    } catch (error) {
      setActionError(`Failed to start update: ${String(error)}`);
    }
  }, [effectiveServer, hasDownloadApi, resolveBuildPath]);

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    if (filter === 'errors') return log.level === 'ERROR' || log.level === 'FATAL';
    if (filter === 'warnings') return log.level === 'WARNING';
    if (filter === 'info') return log.level === 'INFO' || log.level === 'stdout';
    if (filter === 'debug') return log.level === 'DEBUG';
    return true;
  });

  const canStart = !!effectiveServer && !isUpdating && lifecycleState !== 'running' && lifecycleState !== 'starting' && lifecycleState !== 'stopping';
  const canStop = !!effectiveServer && !isUpdating && (lifecycleState === 'running' || lifecycleState === 'starting');
  const canRestart = !!effectiveServer && !isUpdating && lifecycleState === 'running';
  const canUpdate = !!effectiveServer && !isUpdating && lifecycleState !== 'running' && lifecycleState !== 'starting' && lifecycleState !== 'stopping';

  const getLogLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'ERROR':
        return 'text-red-400';
      case 'WARNING':
        return 'text-yellow-400';
      case 'INFO':
      case 'stdout':
        return 'text-blue-300';
      case 'stderr':
      case 'DEBUG':
        return 'text-gray-400';
      default:
        return 'text-gray-300';
    }
  };

  const getLifecycleColor = (state: ServerLifecycleState) => {
    if (state === 'running') return 'text-green-400';
    if (state === 'starting') return 'text-blue-300';
    if (state === 'stopping') return 'text-yellow-300';
    if (state === 'error') return 'text-red-400';
    return 'text-gray-300';
  };


  const moveWidget = useCallback((widgetId: DashboardWidgetId, sourceGroupId: string, targetGroupId: string, targetIndex: number) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const sourceGroup = next.groups.find((group) => group.id === sourceGroupId);
      const targetGroup = next.groups.find((group) => group.id === targetGroupId);
      if (!sourceGroup || !targetGroup) return prev;

      sourceGroup.widgetIds = sourceGroup.widgetIds.filter((id) => id !== widgetId);
      next.hiddenWidgetIds = next.hiddenWidgetIds.filter((id) => id !== widgetId);

      const clampedIndex = Math.max(0, Math.min(targetIndex, targetGroup.widgetIds.length));
      targetGroup.widgetIds.splice(clampedIndex, 0, widgetId);

      return next;
    });
  }, []);

  const removeWidgetToHidden = useCallback((widgetId: DashboardWidgetId, groupId: string) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) return prev;

      group.widgetIds = group.widgetIds.filter((id) => id !== widgetId);
      if (!next.hiddenWidgetIds.includes(widgetId)) {
        next.hiddenWidgetIds.push(widgetId);
      }

      return next;
    });
  }, []);

  const addHiddenWidgetToGroup = useCallback((widgetId: DashboardWidgetId, groupId: string) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) return prev;

      if (group.widgetIds.includes(widgetId)) return prev;
      next.hiddenWidgetIds = next.hiddenWidgetIds.filter((id) => id !== widgetId);
      group.widgetIds.push(widgetId);
      return next;
    });
  }, []);

  const createGroup = useCallback(() => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const title = newGroupName.trim() || `Group ${next.groups.length + 1}`;
      const id = createGroupId();
      next.groups.push({ id, title, widgetIds: [] });
      setSelectedGroupId(id);
      setNewGroupName('');
      return next;
    });
  }, [newGroupName]);

  const renameGroup = useCallback((groupId: string, title: string) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) return prev;
      group.title = title;
      return next;
    });
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setDashboardLayout((prev) => {
      if (prev.groups.length <= 1) return prev;

      const next = cloneLayout(prev);
      const index = next.groups.findIndex((candidate) => candidate.id === groupId);
      if (index < 0) return prev;

      const [removed] = next.groups.splice(index, 1);
      for (const widgetId of removed.widgetIds) {
        if (!next.hiddenWidgetIds.includes(widgetId)) {
          next.hiddenWidgetIds.push(widgetId);
        }
      }

      return next;
    });
  }, []);

  const reorderGroup = useCallback((groupId: string, direction: -1 | 1) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const index = next.groups.findIndex((group) => group.id === groupId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= next.groups.length) {
        return prev;
      }

      const [group] = next.groups.splice(index, 1);
      next.groups.splice(targetIndex, 0, group);
      return next;
    });
  }, []);

  const resetDashboardLayout = useCallback(() => {
    setDashboardLayout(createDefaultDashboardLayout());
    setSelectedGroupId('main');
  }, []);

  const hiddenWidgets = useMemo(
    () => ALL_WIDGETS.filter((widget) => dashboardLayout.hiddenWidgetIds.includes(widget.id)),
    [dashboardLayout.hiddenWidgetIds],
  );

  const serverActions = useMemo<ServerActionDefinition[]>(() => ([
    {
      id: 'start',
      label: 'Start Server',
      description: 'Launch the selected StarMade server using its current install and Java settings.',
      detail: lifecycleState === 'running' ? 'Server is already online.' : 'Starts the dedicated server process.',
      enabled: canStart,
      emphasis: 'accent',
      onClick: () => { void startServer(); },
    },
    {
      id: 'stop',
      label: 'Stop Server',
      description: 'Gracefully stop the currently running dedicated server process.',
      detail: lifecycleState === 'stopped' ? 'Server is currently offline.' : 'Sends a termination request to the server process.',
      enabled: canStop,
      emphasis: 'danger',
      onClick: () => { void stopServer(); },
    },
    {
      id: 'restart',
      label: 'Restart Server',
      description: 'Stop and then start the server again with the current configuration.',
      detail: 'Useful after config changes or when you want a clean runtime reset.',
      enabled: canRestart,
      onClick: () => { void restartServer(); },
    },
    {
      id: 'update',
      label: isUpdating ? `Updating (${serverDownloadStatus?.percent ?? 0}%)` : 'Update Server',
      description: 'Download and verify the selected StarMade server version into this server path.',
      detail: isUpdating
        ? `Download state: ${serverDownloadStatus?.state ?? 'downloading'}`
        : 'Checks the current version manifest and updates local files.',
      enabled: canUpdate,
      onClick: () => { void updateServer(); },
    },
  ]), [
    canRestart,
    canStart,
    canStop,
    canUpdate,
    isUpdating,
    lifecycleState,
    restartServer,
    serverDownloadStatus?.percent,
    serverDownloadStatus?.state,
    startServer,
    stopServer,
    updateServer,
  ]);

  const quickActions = useMemo(
    () => dashboardLayout.quickActionIds
      .map((actionId) => serverActions.find((action) => action.id === actionId))
      .filter((action): action is ServerActionDefinition => !!action),
    [dashboardLayout.quickActionIds, serverActions],
  );

  const updateQuickActions = useCallback((updater: (prev: ServerActionId[]) => ServerActionId[]) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      next.quickActionIds = updater(next.quickActionIds);
      return next;
    });
  }, []);

  const toggleQuickAction = useCallback((actionId: ServerActionId) => {
    updateQuickActions((prev) => (
      prev.includes(actionId)
        ? prev.filter((id) => id !== actionId)
        : [...prev, actionId]
    ));
  }, [updateQuickActions]);

  const reorderQuickAction = useCallback((actionId: ServerActionId, direction: -1 | 1) => {
    updateQuickActions((prev) => {
      const index = prev.indexOf(actionId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }

      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, [updateQuickActions]);

  const moveQuickActionToIndex = useCallback((actionId: ServerActionId, targetIndex: number) => {
    updateQuickActions((prev) => {
      const currentIndex = prev.indexOf(actionId);
      if (currentIndex < 0) return prev;

      const clampedTargetIndex = Math.max(0, Math.min(targetIndex, prev.length));
      const next = [...prev];
      const [moved] = next.splice(currentIndex, 1);
      const adjustedTargetIndex = currentIndex < clampedTargetIndex
        ? clampedTargetIndex - 1
        : clampedTargetIndex;
      next.splice(Math.max(0, Math.min(adjustedTargetIndex, next.length)), 0, moved);
      return next;
    });
  }, [updateQuickActions]);

  const handleClearLogs = () => setLogs([]);

  const handleOpenLogFolder = async () => {
    if (!effectiveServer || !hasGameApi) return;
    await window.launcher.game.openLogLocation(effectiveServer.path).catch((error) => {
      setActionError(`Failed to open log folder: ${String(error)}`);
    });
  };

  const handleExportLogs = () => {
    const logText = filteredLogs
      .map((log) => `[${log.timestamp}] [${log.level}] ${log.message}`)
      .join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `starmade-server-${(effectiveServer?.name ?? 'server').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderDragHandle = (label: string) => (
    <span
      className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400"
      title={label}
      aria-hidden="true"
    >
      <span className="text-xs leading-none text-gray-300">⋮⋮</span>
      Drag
    </span>
  );

  if (!effectiveServer) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/20 bg-black/20 p-8 text-center">
          <div>
            <h3 className="mb-2 text-2xl font-semibold text-white">No Server Selected</h3>
            <p className="mb-4 max-w-xl text-gray-400">
              Create a server in the Installations page, or select one from the server list to open the control panel.
            </p>
            <button
              onClick={() => navigate('Installations', { initialTab: 'servers' })}
              className="rounded-md border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-gray-100 transition-colors hover:bg-black/40"
            >
              Open Server List
            </button>
          </div>
        </div>
      </PageContainer>
    );
  }

  const renderStatusWidget = () => (
    <div className={`${sectionShellClass} grid grid-cols-1 gap-4 lg:grid-cols-[1fr_3fr]`}>
      <div className="text-2xl font-semibold text-gray-300">Server Status:</div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-gray-300">
        <p className="mb-3">Lifecycle: <span className={`font-semibold uppercase ${getLifecycleColor(lifecycleState)}`}>{lifecycleState}</span></p>
        <p className="mb-3">Server Version: <span className="text-white">{effectiveServer.version}</span></p>
        <p className="mb-3">Server Uptime: <span className="text-white">{formatUptime(runtimeUptimeMs)}</span></p>
        <p className="mb-3">PID: <span className="text-white">{runtimePid ?? '-'}</span></p>
        <p>Update State: <span className="text-white">{serverDownloadStatus?.state ?? 'idle'}</span></p>
      </div>
    </div>
  );

  const renderServerInfoWidget = () => (
    <div className={sectionShellClass}>
      <p className="mb-4 text-lg font-semibold text-gray-200">Server Info</p>
      <div className="space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-36 text-gray-300">Server Name:</span>
          <input
            value={effectiveServerName}
            readOnly
            className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-36 text-gray-300">Install Path:</span>
          <input
            value={effectiveServer.path || 'Not configured'}
            readOnly
            className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-36 text-gray-300">Server ID:</span>
          <input
            value={effectiveServer.id}
            readOnly
            className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
        </label>
      </div>
    </div>
  );

  const renderConnectionWidget = () => (
    <div className={sectionShellClass}>
      <p className="mb-4 text-lg font-semibold text-gray-200">Connection Info</p>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 text-gray-300">Bind Address:</span>
            <input
              value="0.0.0.0 (default)"
              readOnly
              className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
            />
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 text-gray-300">Server Port:</span>
            <input
              value={effectiveServer.port || '4242'}
              readOnly
              className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
            />
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 text-gray-300">Max Players:</span>
            <input type="range" min={0} max={200} value={0} disabled className="w-full cursor-not-allowed accent-starmade-accent opacity-60" />
          </label>
        </div>

        <div className="space-y-3 rounded-md border border-white/10 bg-black/20 p-3 text-sm text-gray-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={false} disabled className="h-4 w-4 rounded" />
            <span>Public Server</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={false} disabled className="h-4 w-4 rounded" />
            <span>Use Authentication</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={false} disabled className="h-4 w-4 rounded" />
            <span>Require Authentication</span>
          </label>
        </div>
      </div>
    </div>
  );

  const renderPlayersWidget = () => (
    <div className={`${sectionShellClass} min-h-[260px]`}>
      <p className="mb-3 text-lg font-semibold text-gray-200">Players</p>
      <div className="h-full min-h-[180px] overflow-y-auto rounded-md border border-white/10 bg-black/25 p-3 font-mono text-sm text-blue-300">
        Player listing will appear here when server player-state events are wired.
      </div>
    </div>
  );

  const getActionButtonClassName = (action: ServerActionDefinition) => {
    if (!action.enabled) {
      return 'border-white/5 bg-black/15 text-gray-500 cursor-not-allowed';
    }
    if (action.emphasis === 'danger') {
      return 'border-red-500/40 bg-red-950/30 text-red-100 hover:bg-red-950/45';
    }
    if (action.emphasis === 'accent') {
      return 'border-starmade-accent/40 bg-starmade-accent/20 text-white hover:bg-starmade-accent/30';
    }
    return 'border-white/15 bg-black/30 text-gray-100 hover:bg-black/40';
  };

  const renderActionGrid = (
    actions: ServerActionDefinition[],
    options?: { showQuickToggle?: boolean; showQuickOrdering?: boolean; enableQuickDrag?: boolean; emptyMessage?: string },
  ) => {
    if (actions.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-white/15 bg-black/20 p-4 text-sm text-gray-400">
          {options?.emptyMessage ?? 'No actions available.'}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {options?.enableQuickDrag && isLayoutEditMode && renderQuickActionDropZone(0, 'md:col-span-2 xl:col-span-4')}
        {actions.map((action) => {
          const isPinned = dashboardLayout.quickActionIds.includes(action.id);
          const quickActionIndex = dashboardLayout.quickActionIds.indexOf(action.id);
          return (
            <React.Fragment key={action.id}>
              <div
                draggable={!!options?.enableQuickDrag && isLayoutEditMode && isPinned}
                onDragStart={() => {
                  if (!options?.enableQuickDrag || !isLayoutEditMode || !isPinned) return;
                  setDraggedQuickAction({ actionId: action.id });
                  setQuickActionDropTarget(quickActionIndex);
                }}
                onDragEnd={() => {
                  setDraggedQuickAction(null);
                  setQuickActionDropTarget(null);
                }}
                className={`rounded-lg border p-4 transition-all ${
                  draggedQuickAction?.actionId === action.id
                    ? 'border-starmade-accent/50 bg-starmade-accent/10 opacity-60 shadow-[0_0_0_1px_rgba(34,123,134,0.25)]'
                    : 'border-white/10 bg-black/20 hover:border-white/20'
                } ${options?.enableQuickDrag && isLayoutEditMode && isPinned ? 'cursor-move' : ''}`}
              >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    {options?.enableQuickDrag && isLayoutEditMode && isPinned && renderDragHandle(`Drag ${action.label}`)}
                    <h4 className="text-base font-semibold text-white">{action.label}</h4>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">{action.description}</p>
                </div>
                {options?.showQuickToggle && isLayoutEditMode && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      onClick={() => toggleQuickAction(action.id)}
                      className={`rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                        isPinned
                          ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white hover:bg-starmade-accent/30'
                          : 'border-white/15 bg-black/25 text-gray-300 hover:bg-black/40'
                      }`}
                    >
                      {isPinned ? 'On Dashboard' : 'Add to Dashboard'}
                    </button>

                    {options.showQuickOrdering && isPinned && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => reorderQuickAction(action.id, -1)}
                          disabled={quickActionIndex <= 0}
                          className="rounded border border-white/15 bg-black/25 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-300 transition-colors hover:bg-black/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          onClick={() => reorderQuickAction(action.id, 1)}
                          disabled={quickActionIndex < 0 || quickActionIndex >= dashboardLayout.quickActionIds.length - 1}
                          className="rounded border border-white/15 bg-black/25 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-300 transition-colors hover:bg-black/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Down
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="mb-4 text-xs text-gray-500">{action.detail}</p>

              <button
                onClick={action.onClick}
                disabled={!action.enabled}
                className={`w-full rounded-md border px-4 py-3 text-sm font-semibold transition-colors ${getActionButtonClassName(action)}`}
              >
                {action.label}
              </button>
              </div>
              {options?.enableQuickDrag && isLayoutEditMode && renderQuickActionDropZone(quickActionIndex + 1, 'md:col-span-2 xl:col-span-4')}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const handleQuickActionDrop = useCallback((targetIndex: number) => {
    if (!draggedQuickAction) return;
    moveQuickActionToIndex(draggedQuickAction.actionId, targetIndex);
    setDraggedQuickAction(null);
    setQuickActionDropTarget(null);
  }, [draggedQuickAction, moveQuickActionToIndex]);

  const renderQuickActionDropZone = (targetIndex: number, className = '') => (
    draggedQuickAction ? (
      <div
        key={`quick-action-drop-${targetIndex}-${className}`}
        onDragEnter={() => setQuickActionDropTarget(targetIndex)}
        onDragOver={(event) => {
          event.preventDefault();
          setQuickActionDropTarget(targetIndex);
        }}
        onDragLeave={() => {
          if (quickActionDropTarget === targetIndex) {
            setQuickActionDropTarget(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleQuickActionDrop(targetIndex);
        }}
        className={`h-3 rounded border border-dashed transition-colors ${
          quickActionDropTarget === targetIndex
            ? 'border-starmade-accent bg-starmade-accent/20 shadow-[0_0_0_1px_rgba(34,123,134,0.35)]'
            : 'border-starmade-accent/60 bg-starmade-accent/10'
        } ${className}`}
      />
    ) : null
  );

  const renderControlsWidget = () => (
    <div className={sectionShellClass}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold text-gray-200">Quick Actions</p>
        <span className="text-xs uppercase tracking-wider text-gray-500">
          {quickActions.length} pinned{isLayoutEditMode ? ' · edit mode' : ''}
        </span>
      </div>
      {renderActionGrid(quickActions, {
        showQuickToggle: isLayoutEditMode,
        showQuickOrdering: isLayoutEditMode,
        enableQuickDrag: isLayoutEditMode,
        emptyMessage: 'Add actions from the Actions tab to show quick controls here.',
      })}
    </div>
  );

  const renderWidgetBody = (widgetId: DashboardWidgetId) => {
    if (widgetId === 'status') return renderStatusWidget();
    if (widgetId === 'serverInfo') return renderServerInfoWidget();
    if (widgetId === 'connection') return renderConnectionWidget();
    if (widgetId === 'players') return renderPlayersWidget();
    return renderControlsWidget();
  };

  const handleWidgetDrop = (targetGroupId: string, targetIndex: number) => {
    if (!draggedWidget) return;
    moveWidget(draggedWidget.widgetId, draggedWidget.sourceGroupId, targetGroupId, targetIndex);
    setDraggedWidget(null);
    setWidgetDropTarget(null);
  };

  const renderDropZone = (targetGroupId: string, targetIndex: number) => (
    isLayoutEditMode ? (
    <div
      key={`${targetGroupId}-drop-${targetIndex}`}
      onDragEnter={() => {
        if (!draggedWidget) return;
        setWidgetDropTarget(`${targetGroupId}:${targetIndex}`);
      }}
      onDragOver={(event) => {
        if (!draggedWidget) return;
        event.preventDefault();
        setWidgetDropTarget(`${targetGroupId}:${targetIndex}`);
      }}
      onDragLeave={() => {
        if (widgetDropTarget === `${targetGroupId}:${targetIndex}`) {
          setWidgetDropTarget(null);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        handleWidgetDrop(targetGroupId, targetIndex);
      }}
      className={`h-3 rounded border border-dashed transition-colors ${
        widgetDropTarget === `${targetGroupId}:${targetIndex}`
          ? 'border-starmade-accent bg-starmade-accent/20 shadow-[0_0_0_1px_rgba(34,123,134,0.35)]'
          : draggedWidget
            ? 'border-white/20 bg-white/5 hover:border-starmade-accent/70'
            : 'border-white/10 hover:border-starmade-accent/40'
      }`}
    />
    ) : null
  );

  const renderDashboardGroup = (group: DashboardGroup, groupIndex: number) => (
    <div key={group.id} className="rounded-lg border border-white/10 bg-black/10 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isLayoutEditMode ? (
          <>
            <input
              value={group.title}
              onChange={(event) => renameGroup(group.id, event.target.value)}
              className="min-w-[160px] flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-gray-200"
            />
            <button
              onClick={() => reorderGroup(group.id, -1)}
              disabled={groupIndex === 0}
              className="rounded border border-white/15 bg-black/25 px-2 py-1 text-xs font-semibold text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Up
            </button>
            <button
              onClick={() => reorderGroup(group.id, 1)}
              disabled={groupIndex === dashboardLayout.groups.length - 1}
              className="rounded border border-white/15 bg-black/25 px-2 py-1 text-xs font-semibold text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Down
            </button>
            <button
              onClick={() => deleteGroup(group.id)}
              disabled={dashboardLayout.groups.length <= 1}
              className="rounded border border-red-500/40 bg-red-950/30 px-2 py-1 text-xs font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </>
        ) : (
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">{group.title}</h3>
        )}
      </div>

      <div className="space-y-2">
        {renderDropZone(group.id, 0)}
        {group.widgetIds.map((widgetId, index) => {
          const widgetLabel = ALL_WIDGETS.find((widget) => widget.id === widgetId)?.label ?? widgetId;
          return (
            <React.Fragment key={`${group.id}-${widgetId}`}>
              <div
                draggable={isLayoutEditMode}
                onDragStart={() => {
                  if (!isLayoutEditMode) return;
                  setDraggedWidget({ widgetId, sourceGroupId: group.id });
                }}
                onDragEnd={() => {
                  setDraggedWidget(null);
                  setWidgetDropTarget(null);
                }}
                className={`rounded-lg border p-2 transition-all ${
                  draggedWidget?.widgetId === widgetId && draggedWidget.sourceGroupId === group.id
                    ? 'border-starmade-accent/50 bg-starmade-accent/10 opacity-60 shadow-[0_0_0_1px_rgba(34,123,134,0.25)]'
                    : 'border-white/10 bg-black/15 hover:border-white/20'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isLayoutEditMode && renderDragHandle(`Drag ${widgetLabel}`)}
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{widgetLabel}</p>
                  </div>
                  {isLayoutEditMode && (
                    <button
                      onClick={() => removeWidgetToHidden(widgetId, group.id)}
                      className="rounded border border-white/15 bg-black/30 px-2 py-0.5 text-xs text-gray-300 hover:bg-black/45"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {renderWidgetBody(widgetId)}
              </div>
              {renderDropZone(group.id, index + 1)}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );

  const renderControlPanel = () => {
    const usesDefaultGrid = dashboardLayout.groups.length === 2
      && dashboardLayout.groups[0]?.id === 'main'
      && dashboardLayout.groups[1]?.id === 'players';

    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        {actionError && (
          <div className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
            {actionError}
          </div>
        )}

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Dashboard Layout</h3>
              <p className="mt-1 text-xs text-gray-500">
                {isLayoutEditMode
                  ? 'Drag widgets, rename groups, and pin quick actions while edit mode is enabled.'
                  : 'Enable edit mode to customize your monitoring dashboard.'}
              </p>
            </div>

            <button
              onClick={() => setIsLayoutEditMode((prev) => !prev)}
              className={`rounded border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                isLayoutEditMode
                  ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white hover:bg-starmade-accent/30'
                  : 'border-white/15 bg-black/30 text-gray-200 hover:bg-black/45'
              }`}
            >
              {isLayoutEditMode ? 'Done Editing' : 'Edit Layout'}
            </button>
          </div>

          {isLayoutEditMode && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selectedGroupId}
                  onChange={(event) => setSelectedGroupId(event.target.value)}
                  className="rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-gray-200"
                >
                  {dashboardLayout.groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.title}</option>
                  ))}
                </select>

                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="New group name"
                  className="rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-gray-200"
                />
                <button
                  onClick={createGroup}
                  className="rounded border border-white/15 bg-black/30 px-2 py-1 text-sm font-semibold text-gray-200 hover:bg-black/45"
                >
                  Add Group
                </button>
                <button
                  onClick={resetDashboardLayout}
                  className="rounded border border-white/15 bg-black/30 px-2 py-1 text-sm font-semibold text-gray-200 hover:bg-black/45"
                >
                  Reset Default
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {hiddenWidgets.length === 0 ? (
                  <p className="text-xs text-gray-400">All widgets are visible.</p>
                ) : (
                  hiddenWidgets.map((widget) => (
                    <button
                      key={widget.id}
                      onClick={() => addHiddenWidgetToGroup(widget.id, selectedGroupId)}
                      disabled={!selectedGroupId}
                      className="rounded border border-white/15 bg-black/25 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add {widget.label}
                    </button>
                  ))
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500">Tip: drag widgets to reorder or move them between groups.</p>
            </>
          )}
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto pr-1 ${
            usesDefaultGrid
              ? 'grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]'
              : 'grid grid-cols-1 gap-4 xl:grid-cols-2'
          }`}
        >
          {dashboardLayout.groups.map((group, index) => renderDashboardGroup(group, index))}
        </div>
      </div>
    );
  };

  const renderActionsTab = () => (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {actionError && (
        <div className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Server Actions</h3>
            <p className="text-sm text-gray-400">
              Launch actions, runtime controls, and update operations for {effectiveServerName}. Enable layout edit mode from the Control tab to pin and reorder quick actions.
            </p>
          </div>
          <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs uppercase tracking-wider text-gray-400">
            {dashboardLayout.quickActionIds.length} dashboard action{dashboardLayout.quickActionIds.length === 1 ? '' : 's'}{isLayoutEditMode ? ' · edit mode' : ''}
          </div>
        </div>

        {!isLayoutEditMode && (
          <div className="mb-4 rounded-lg border border-dashed border-white/15 bg-black/15 p-3 text-sm text-gray-400">
            Layout edit mode is off. You can still run actions here, but pinning and dashboard reordering are hidden until edit mode is enabled from the Control tab.
          </div>
        )}

        {isLayoutEditMode && dashboardLayout.quickActionIds.length > 0 && (
          <div className="mb-4 rounded-lg border border-white/10 bg-black/15 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Dashboard action order</h4>
              <p className="text-xs text-gray-500">Drag to reorder pinned actions without changing the full catalog below.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {renderQuickActionDropZone(0, 'w-full')}
              {quickActions.map((action, index) => (
                <React.Fragment key={`quick-order-${action.id}`}>
                  <div
                    draggable={isLayoutEditMode}
                    onDragStart={() => {
                      if (!isLayoutEditMode) return;
                      setDraggedQuickAction({ actionId: action.id });
                      setQuickActionDropTarget(index);
                    }}
                    onDragEnd={() => {
                      setDraggedQuickAction(null);
                      setQuickActionDropTarget(null);
                    }}
                    className={`flex cursor-move items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-all ${
                      draggedQuickAction?.actionId === action.id
                        ? 'border-starmade-accent/50 bg-starmade-accent/10 text-gray-200 opacity-60 shadow-[0_0_0_1px_rgba(34,123,134,0.25)]'
                        : 'border-white/10 bg-black/25 text-gray-300 hover:border-white/20'
                    }`}
                  >
                    {renderDragHandle(`Drag ${action.label}`)}
                    <span className="font-semibold text-white">{index + 1}. {action.label}</span>
                    <button
                      onClick={() => reorderQuickAction(action.id, -1)}
                      disabled={index === 0}
                      className="rounded border border-white/15 bg-black/25 px-2 py-0.5 font-semibold uppercase tracking-wider transition-colors hover:bg-black/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Up
                    </button>
                    <button
                      onClick={() => reorderQuickAction(action.id, 1)}
                      disabled={index === quickActions.length - 1}
                      className="rounded border border-white/15 bg-black/25 px-2 py-0.5 font-semibold uppercase tracking-wider transition-colors hover:bg-black/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Down
                    </button>
                  </div>
                  {renderQuickActionDropZone(index + 1, 'w-full')}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {renderActionGrid(serverActions, {
          showQuickToggle: isLayoutEditMode,
          showQuickOrdering: isLayoutEditMode,
        })}
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-black/20">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-white">Server Logs</h3>
          <p className="text-sm text-gray-400">{effectiveServerName}{logPath ? ` - ${logPath}` : ''}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 text-sm">
            {(['all', 'info', 'warnings', 'errors', 'debug'] as LogFilter[]).map((option) => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                className={`rounded px-3 py-1 capitalize transition-colors ${
                  filter === option ? 'bg-starmade-accent text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-slate-700"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 font-mono text-sm">
        <div className="space-y-1">
          {filteredLogs.length === 0 && (
            <p className="text-gray-500">No log lines yet for this server.</p>
          )}
          {filteredLogs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="flex gap-3 rounded px-2 py-1 hover:bg-white/5">
              <span className="flex-shrink-0 text-gray-500">{log.timestamp}</span>
              <span className={`flex-shrink-0 font-semibold ${getLogLevelColor(log.level)}`}>[{log.level}]</span>
              <span className="break-all text-gray-300">{log.message}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-4 py-3">
        <p className="text-sm text-gray-400">{filteredLogs.length} / {LOG_BUFFER_CAP} buffered log entries</p>
        <div className="flex gap-2">
          <button onClick={handleClearLogs} className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-slate-600">
            Clear
          </button>
          <button onClick={() => { void handleOpenLogFolder(); }} className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-slate-600">
            Open Folder
          </button>
          <button onClick={handleExportLogs} className="rounded-md bg-starmade-accent px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-starmade-accent/80">
            Export
          </button>
        </div>
      </div>
    </div>
  );

  const renderPlaceholderTab = (title: string, description: string) => (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/20 bg-black/20 p-6 text-center">
      <div>
        <h3 className="mb-2 text-xl font-semibold text-white">{title}</h3>
        <p className="max-w-xl text-gray-400">{description}</p>
      </div>
    </div>
  );

  const renderActiveTab = () => {
    if (activeTab === 'control') return renderControlPanel();
    if (activeTab === 'logs') return renderLogs();
    if (activeTab === 'actions') {
      return renderActionsTab();
    }
    if (activeTab === 'configuration') {
      return renderPlaceholderTab(
        'Configuration',
        'Configuration file editing will be connected after we map exact game config paths.'
      );
    }
    if (activeTab === 'files') {
      return renderPlaceholderTab(
        'Files',
        'Server file browser placeholder. We will hook this tab to the server directory tree in a later pass.'
      );
    }
    return renderPlaceholderTab(
      'Database',
      'Database tools placeholder. This area is reserved for universe/player data operations later.'
    );
  };

  return (
    <PageContainer>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'border-starmade-accent bg-starmade-accent/20 text-white'
                  : 'border-white/10 bg-black/20 text-gray-300 hover:bg-black/35'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1">{renderActiveTab()}</div>
      </div>
    </PageContainer>
  );
};

export default ServerPanel;

