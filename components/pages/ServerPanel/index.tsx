import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import PageContainer from '../../common/PageContainer';
import ConfigPanel, { type ConfigPanelModel } from '../../common/ConfigPanel';
import { useData } from '../../../contexts/DataContext';
import { useApp } from '../../../contexts/AppContext';
import type { ManagedItem, ServerLifecycleState, ServerLogLevel } from '../../../types';

interface ServerPanelProps {
  serverId?: string;
  serverName?: string;
}

type ServerPanelTab = 'control' | 'logs' | 'configuration' | 'files' | 'database';
const CONFIG_EDITOR_TABS = [
  { id: 'server-cfg', label: 'server.cfg' },
  { id: 'game-config-xml', label: 'GameConfig.xml' },
] as const;

type ConfigEditorTab = (typeof CONFIG_EDITOR_TABS)[number]['id'];
type LogFilter = 'errors' | 'warnings' | 'info' | 'debug';
type DashboardWidgetId = 'status' | 'serverInfo' | 'connection' | 'players' | 'controls';
type ServerActionId = 'start' | 'stop' | 'restart' | 'update';

interface LogEntry {
  timestamp: string;
  level: ServerLogLevel;
  message: string;
}

interface LogFileItem {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  modifiedMs: number;
  categoryId: string;
  categoryLabel: string;
}

interface LogCategory {
  id: string;
  label: string;
  files: LogFileItem[];
}

interface InstallationFileEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedMs: number;
}

interface DashboardGroup {
  id: string;
  title: string;
  widgetIds: DashboardWidgetId[];
  height?: number;
  collapsed?: boolean;
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
const DASHBOARD_STORE_KEY = 'serverPanelDashboardLayoutsV2';
const MIN_GROUP_HEIGHT = 260;
const MAX_GROUP_HEIGHT = 1200;

const WIDGET_HEIGHT_WEIGHT: Record<DashboardWidgetId, number> = {
  status: 120,
  serverInfo: 110,
  connection: 110,
  players: 110,
  controls: 160,
};

const ALL_WIDGETS: Array<{ id: DashboardWidgetId; label: string }> = [
  { id: 'status', label: 'Server Status' },
  { id: 'serverInfo', label: 'Server Info' },
  { id: 'connection', label: 'Connection Info' },
  { id: 'players', label: 'Players' },
  { id: 'controls', label: 'Server Controls' },
];

const tabItems: { id: ServerPanelTab; label: string }[] = [
  { id: 'control', label: 'Dashboard' },
  { id: 'logs', label: 'Logs' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'files', label: 'Files' },
  { id: 'database', label: 'Database' },
];

const LOG_FILTER_OPTIONS: LogFilter[] = ['info', 'warnings', 'errors', 'debug'];

const createDefaultDashboardLayout = (): DashboardLayout => ({
  groups: [
    { id: 'main', title: 'Main', widgetIds: ['status', 'serverInfo', 'connection', 'controls'], height: 760 },
    { id: 'players', title: 'Players', widgetIds: ['players'], height: 360 },
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
  groups: layout.groups.map((group) => ({
    ...group,
    widgetIds: [...group.widgetIds],
    height: group.height,
    collapsed: group.collapsed,
  })),
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
      const candidate = entry as { id?: unknown; title?: unknown; widgetIds?: unknown; height?: unknown; collapsed?: unknown };
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

      const height = typeof candidate.height === 'number' && Number.isFinite(candidate.height)
        ? Math.max(MIN_GROUP_HEIGHT, Math.min(Math.round(candidate.height), MAX_GROUP_HEIGHT))
        : undefined;
      const collapsed = typeof candidate.collapsed === 'boolean' ? candidate.collapsed : undefined;
      groups.push({ id: candidate.id, title, widgetIds, height, collapsed });
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

const parseLogLine = (rawLine: string): LogEntry => {
  const trimmed = rawLine.trimEnd();
  const timestamped = trimmed.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s*(.*)$/);
  if (timestamped) {
    return {
      timestamp: timestamped[1],
      level: normalizeLogLevel(timestamped[2]),
      message: timestamped[3] || '',
    };
  }

  const streamTagged = trimmed.match(/^\[(STDOUT|STDERR|INFO|WARNING|ERROR|FATAL|DEBUG)\]\s*(.*)$/i);
  if (streamTagged) {
    return {
      timestamp: '--:--:--',
      level: normalizeLogLevel(streamTagged[1]),
      message: streamTagged[2] || '',
    };
  }

  return {
    timestamp: '--:--:--',
    level: 'INFO',
    message: trimmed,
  };
};

const formatLogFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatLogModifiedTime = (modifiedMs: number): string => {
  if (!Number.isFinite(modifiedMs) || modifiedMs <= 0) return 'Unknown';
  return new Date(modifiedMs).toLocaleString();
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

const parseCfgBoolean = (raw: string | null, fallback: boolean): boolean => {
  if (raw === null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
};

type ServerConfigFieldType = 'string' | 'number' | 'boolean';
type ServerConfigCategory = 'networking' | 'security' | 'performance' | 'advanced';

interface ServerConfigField {
  key: string;
  label: string;
  description: string;
  category: ServerConfigCategory;
  type: ServerConfigFieldType;
  defaultValue: string;
  min?: number;
  max?: number;
  guidance?: string;
}

interface ServerConfigEntry {
  key: string;
  value: string;
  comment: string | null;
}

type ConfigFieldValidation = import('../../common/ConfigPanel').ConfigFieldValidation;

type GameConfigFieldType = 'string' | 'number' | 'boolean';
type GameConfigCategory = 'economy' | 'environment' | 'limits' | 'other';

interface GameConfigFieldMeta {
  label: string;
  description: string;
  category: GameConfigCategory;
  type?: GameConfigFieldType;
  min?: number;
  max?: number;
  guidance?: string;
}

interface GameConfigField {
  path: string;
  label: string;
  description: string;
  category: GameConfigCategory;
  type: GameConfigFieldType;
  defaultValue: string;
  min?: number;
  max?: number;
  guidance?: string;
}

interface GameConfigListColumn {
  key: string;
  label: string;
  type: GameConfigFieldType;
}

interface GameConfigListRow {
  index: number;
  fieldPaths: Record<string, string>;
}

interface GameConfigListSection {
  key: string;
  label: string;
  description: string;
  category: GameConfigCategory;
  columns: GameConfigListColumn[];
  rows: GameConfigListRow[];
}

const GAME_CONFIG_CATEGORY_LABELS: Record<GameConfigCategory, string> = {
  economy: 'Economy',
  environment: 'Environment',
  limits: 'Limits',
  other: 'Other',
};

const GAME_CONFIG_CATEGORY_ORDER: GameConfigCategory[] = ['economy', 'environment', 'limits', 'other'];

const DASHBOARD_SERVER_CFG_QUICK_KEYS = [
  'MAX_CLIENTS',
  'SERVER_LISTEN_IP',
  'ANNOUNCE_SERVER_TO_SERVERLIST',
  'USE_WHITELIST',
];

const DASHBOARD_GAME_CONFIG_QUICK_PATHS = [
  'GameConfig/StartingGear/Credits',
  'GameConfig/SunHeatDamage/SunDamageMin',
  'GameConfig/SunHeatDamage/SunDamageMax',
  'GameConfig/SunHeatDamage/SunDamageDelayInSecs',
];

const GAME_CONFIG_FIELD_META: Record<string, GameConfigFieldMeta> = {
  'GameConfig/StartingGear/Credits': {
    label: 'Starting Credits',
    description: 'Credits granted to a new character on spawn.',
    category: 'economy',
    type: 'number',
    min: 0,
  },
  'GameConfig/SunHeatDamage/DamagePerBlock': {
    label: 'Sun Heat Damage Per Block',
    description: 'Damage applied per block when sun heat damage triggers.',
    category: 'environment',
    type: 'number',
    min: 0,
  },
  'GameConfig/SunHeatDamage/MaxDelayBetweenHits': {
    label: 'Max Delay Between Sun Hits',
    description: 'Maximum random delay between consecutive sun heat damage hits.',
    category: 'environment',
    type: 'number',
    min: 0,
  },
  'GameConfig/SunHeatDamage/SunDamageRadius': {
    label: 'Sun Damage Radius',
    description: 'Radius around the entity where sun damage applies.',
    category: 'environment',
    type: 'number',
    min: 0,
  },
  'GameConfig/SunHeatDamage/SunDamageDelayInSecs': {
    label: 'Sun Damage Delay (sec)',
    description: 'Time delay before repeated sun heat damage is applied.',
    category: 'environment',
    type: 'number',
    min: 0,
  },
  'GameConfig/SunHeatDamage/SunDamageMin': {
    label: 'Minimum Sun Damage',
    description: 'Lower bound for randomized sun heat damage.',
    category: 'environment',
    type: 'number',
    min: 0,
  },
  'GameConfig/SunHeatDamage/SunDamageMax': {
    label: 'Maximum Sun Damage',
    description: 'Upper bound for randomized sun heat damage.',
    category: 'environment',
    type: 'number',
    min: 0,
  },
};

const parseGameConfigFieldType = (rawValue: string): GameConfigFieldType => {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'false') return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return 'number';
  return 'string';
};

const humanizeGameConfigSegment = (segment: string): string => segment
  .replace(/\[\d+\]/g, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .trim()
  .split(/\s+/)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const shouldHideGameConfigPath = (path: string): boolean => (
  path.includes('[')
  || path.startsWith('GameConfig/StartingGear/Block')
  || path.startsWith('GameConfig/StartingGear/Tool')
  || path.startsWith('GameConfig/StartingGear/Helmet')
  || path.startsWith('GameConfig/StartingGear/Flashlight')
  || path.startsWith('GameConfig/StartingGear/Logbook')
  || path.startsWith('GameConfig/StartingGear/Blueprint')
  || path.startsWith('GameConfig/StartingGear/BuildInhibiter')
);

const inferGameConfigCategory = (path: string): GameConfigCategory => {
  const secondSegment = path.split('/')[1]?.toLowerCase() ?? '';
  if (secondSegment === 'startinggear') return 'economy';
  if (secondSegment.includes('sun') || secondSegment.includes('heat')) return 'environment';
  if (secondSegment.includes('limit') || secondSegment.includes('maxdimension')) return 'limits';
  return 'other';
};

const parseGameConfigXmlDocument = (xmlContent: string): Document => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML content.');
  }
  return doc;
};

const findElementByGameConfigPath = (doc: Document, path: string): Element | null => {
  const root = doc.documentElement;
  if (!root) return null;

  const segments = path.split('/');
  if (segments.length === 0 || segments[0] !== root.tagName) return null;

  let current: Element | null = root;
  for (let i = 1; i < segments.length; i += 1) {
    if (!current) return null;
    const match = segments[i].match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!match) return null;

    const tagName = match[1];
    const requestedIndex = Number.parseInt(match[2] ?? '1', 10);
    const siblings = Array.from(current.children).filter((child) => child.tagName === tagName);
    current = siblings[requestedIndex - 1] ?? null;
  }

  return current;
};

const hasOnlyLeafChildren = (element: Element): boolean => {
  const children = Array.from(element.children);
  if (children.length === 0) return false;
  return children.every((child) => child.children.length === 0);
};

const extractGameConfigListSections = (xmlContent: string): GameConfigListSection[] => {
  const doc = parseGameConfigXmlDocument(xmlContent);
  const root = doc.documentElement;
  if (!root) return [];

  const sections = new Map<string, GameConfigListSection>();

  const walk = (element: Element, parentPath: string) => {
    const childElements = Array.from(element.children);
    if (childElements.length === 0) return;

    const groupedChildren = childElements.reduce<Record<string, Element[]>>((acc, child) => {
      const next = acc[child.tagName] ?? [];
      next.push(child);
      acc[child.tagName] = next;
      return acc;
    }, {});

    for (const [tagName, siblings] of Object.entries(groupedChildren)) {
      const isRowSet = siblings.length > 1 && siblings.every((sibling) => hasOnlyLeafChildren(sibling));
      if (isRowSet) {
        const sectionKey = `${parentPath}/${tagName}`;
        const columns: GameConfigListColumn[] = [];
        const columnIndex = new Map<string, number>();

        for (const sibling of siblings) {
          for (const child of Array.from(sibling.children)) {
            if (!columnIndex.has(child.tagName)) {
              columnIndex.set(child.tagName, columns.length);
              columns.push({
                key: child.tagName,
                label: humanizeGameConfigSegment(child.tagName),
                type: parseGameConfigFieldType((child.textContent ?? '').trim()),
              });
            }
          }
        }

        const rows: GameConfigListRow[] = siblings.map((sibling, siblingIndex) => {
          const childByTag = new Map(Array.from(sibling.children).map((child) => [child.tagName, child]));
          const fieldPaths: Record<string, string> = {};

          for (const column of columns) {
            const rowPath = `${parentPath}/${tagName}[${siblingIndex + 1}]/${column.key}`;
            fieldPaths[column.key] = rowPath;

            const child = childByTag.get(column.key);
            if (child) {
              const childType = parseGameConfigFieldType((child.textContent ?? '').trim());
              if (column.type !== childType) {
                column.type = 'string';
              }
            }
          }

          return {
            index: siblingIndex + 1,
            fieldPaths,
          };
        });

        sections.set(sectionKey, {
          key: sectionKey,
          label: humanizeGameConfigSegment(tagName),
          description: `Repeated ${humanizeGameConfigSegment(tagName)} entries at ${parentPath}.`,
          category: inferGameConfigCategory(sectionKey),
          columns,
          rows,
        });
      }
    }

    const siblingCounts = childElements.reduce<Record<string, number>>((acc, child) => {
      acc[child.tagName] = (acc[child.tagName] ?? 0) + 1;
      return acc;
    }, {});

    const siblingSeen: Record<string, number> = {};
    for (const child of childElements) {
      siblingSeen[child.tagName] = (siblingSeen[child.tagName] ?? 0) + 1;
      const index = siblingSeen[child.tagName];
      const includeIndex = (siblingCounts[child.tagName] ?? 0) > 1;
      const segment = includeIndex ? `${child.tagName}[${index}]` : child.tagName;
      walk(child, `${parentPath}/${segment}`);
    }
  };

  walk(root, root.tagName);

  return Array.from(sections.values()).sort((a, b) => {
    const categoryDiff = GAME_CONFIG_CATEGORY_ORDER.indexOf(a.category) - GAME_CONFIG_CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.label.localeCompare(b.label);
  });
};

const extractGameConfigFields = (xmlContent: string): { fields: GameConfigField[]; values: Record<string, string> } => {
  const doc = parseGameConfigXmlDocument(xmlContent);
  const root = doc.documentElement;
  if (!root) return { fields: [], values: {} };

  const values: Record<string, string> = {};
  const fields: GameConfigField[] = [];

  const walk = (element: Element, parentPath: string) => {
    const childElements = Array.from(element.children);
    if (childElements.length === 0) {
      const path = parentPath;
      const rawValue = (element.textContent ?? '').trim();
      values[path] = rawValue;

      if (shouldHideGameConfigPath(path)) return;

      const explicitMeta = GAME_CONFIG_FIELD_META[path];
      const inferredType = parseGameConfigFieldType(rawValue);
      const type = explicitMeta?.type ?? inferredType;

      fields.push({
        path,
        label: explicitMeta?.label ?? humanizeGameConfigSegment(path.split('/').pop() ?? path),
        description: explicitMeta?.description ?? `GameConfig path: ${path}`,
        category: explicitMeta?.category ?? inferGameConfigCategory(path),
        type,
        defaultValue: rawValue,
        min: explicitMeta?.min,
        max: explicitMeta?.max,
        guidance: explicitMeta?.guidance,
      });
      return;
    }

    const siblingCounts = childElements.reduce<Record<string, number>>((acc, child) => {
      acc[child.tagName] = (acc[child.tagName] ?? 0) + 1;
      return acc;
    }, {});

    const siblingSeen: Record<string, number> = {};
    for (const child of childElements) {
      siblingSeen[child.tagName] = (siblingSeen[child.tagName] ?? 0) + 1;
      const index = siblingSeen[child.tagName];
      const includeIndex = (siblingCounts[child.tagName] ?? 0) > 1;
      const segment = includeIndex ? `${child.tagName}[${index}]` : child.tagName;
      walk(child, `${parentPath}/${segment}`);
    }
  };

  walk(root, root.tagName);

  fields.sort((a, b) => {
    const categoryDiff = GAME_CONFIG_CATEGORY_ORDER.indexOf(a.category) - GAME_CONFIG_CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.label.localeCompare(b.label);
  });

  return { fields, values };
};

const getGameConfigFieldValidation = (field: GameConfigField, rawValue: string): ConfigFieldValidation => {
  const trimmed = rawValue.trim();

  if (field.type === 'number') {
    if (!trimmed) {
      return { error: 'A numeric value is required.', warning: null };
    }

    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) {
      return { error: 'Enter a valid number.', warning: null };
    }

    if (field.min !== undefined && parsed < field.min) {
      return { error: null, warning: `Value is below minimum and will be clamped to ${field.min}.` };
    }

    if (field.max !== undefined && parsed > field.max) {
      return { error: null, warning: `Value is above maximum and will be clamped to ${field.max}.` };
    }

    if (field.path === 'GameConfig/SunHeatDamage/SunDamageMax') {
      const minValue = Number.parseFloat(field.defaultValue);
      if (Number.isFinite(minValue) && parsed < minValue) {
        return { error: null, warning: 'Sun damage max is lower than its loaded value; verify this is intended.' };
      }
    }
  }

  if (field.type === 'string' && !trimmed) {
    return { error: null, warning: 'Empty value may be rejected by the game parser.' };
  }

  return { error: null, warning: null };
};

const CONFIG_CATEGORY_LABELS: Record<ServerConfigCategory, string> = {
  networking: 'Networking',
  security: 'Security',
  performance: 'Performance',
  advanced: 'Advanced',
};

const CONFIG_CATEGORY_ORDER: ServerConfigCategory[] = ['networking', 'security', 'performance', 'advanced'];

const SERVER_CONFIG_FIELDS: ServerConfigField[] = [
  {
    key: 'MAX_CLIENTS',
    label: 'Max Players',
    description: 'Maximum number of clients allowed on this server.',
    category: 'networking',
    type: 'number',
    defaultValue: '32',
    min: 0,
  },
  {
    key: 'SERVER_LISTEN_IP',
    label: 'Bind Address',
    description: 'IP/interface to bind the server to. Use all to listen on every interface.',
    category: 'networking',
    type: 'string',
    defaultValue: 'all',
  },
  {
    key: 'ANNOUNCE_SERVER_TO_SERVERLIST',
    label: 'Public Server',
    description: 'Announce this server to the public StarMade server list.',
    category: 'networking',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'USE_STARMADE_AUTHENTICATION',
    label: 'Use Authentication',
    description: 'Allow StarMade account authentication for connections.',
    category: 'security',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'REQUIRE_STARMADE_AUTHENTICATION',
    label: 'Require Authentication',
    description: 'Require authenticated StarMade accounts to join.',
    category: 'security',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'USE_WHITELIST',
    label: 'Use Whitelist',
    description: 'Only allow players listed in whitelist.txt.',
    category: 'security',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'SECTOR_AUTOSAVE_SEC',
    label: 'Autosave Interval (sec)',
    description: 'How often sectors are autosaved. Use -1 to disable.',
    category: 'performance',
    type: 'number',
    defaultValue: '300',
    min: -1,
    guidance: 'Very low intervals can increase disk activity; -1 disables autosave and is risky without manual backups.',
  },
  {
    key: 'THRUST_SPEED_LIMIT',
    label: 'Thrust Speed Limit',
    description: 'Maximum ship speed in m/s.',
    category: 'performance',
    type: 'number',
    defaultValue: '75',
    min: 0,
  },
  {
    key: 'SOCKET_BUFFER_SIZE',
    label: 'Socket Buffer Size',
    description: 'Incoming/outgoing socket buffer size in bytes.',
    category: 'networking',
    type: 'number',
    defaultValue: '65536',
    min: 1024,
  },
  {
    key: 'USE_UDP',
    label: 'Use UDP',
    description: 'Use UDP for networking instead of TCP.',
    category: 'networking',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'TCP_NODELAY',
    label: 'TCP No Delay',
    description: 'Disable Nagle buffering for lower latency.',
    category: 'networking',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'NT_SPAM_PROTECT_ACTIVE',
    label: 'Spam Protection Enabled',
    description: 'Enable connection spam protection logic.',
    category: 'security',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'NT_SPAM_PROTECT_TIME_MS',
    label: 'Spam Protect Window (ms)',
    description: 'Time window used by spam protection.',
    category: 'security',
    type: 'number',
    defaultValue: '30000',
    min: 0,
  },
  {
    key: 'NT_SPAM_PROTECT_MAX_ATTEMPTS',
    label: 'Spam Protect Max Attempts',
    description: 'Maximum connection attempts allowed per window.',
    category: 'security',
    type: 'number',
    defaultValue: '30',
    min: 0,
  },
  {
    key: 'SECTOR_INACTIVE_TIMEOUT',
    label: 'Sector Inactive Timeout (sec)',
    description: 'Time before sectors go inactive (-1 disables).',
    category: 'performance',
    type: 'number',
    defaultValue: '20',
    min: -1,
  },
  {
    key: 'SECTOR_INACTIVE_CLEANUP_TIMEOUT',
    label: 'Sector Cleanup Timeout (sec)',
    description: 'Time before inactive sectors are removed from memory (-1 disables).',
    category: 'performance',
    type: 'number',
    defaultValue: '10',
    min: -1,
  },
  {
    key: 'MAX_SIMULTANEOUS_EXPLOSIONS',
    label: 'Max Simultaneous Explosions',
    description: 'Threaded explosion concurrency cap.',
    category: 'performance',
    type: 'number',
    defaultValue: '10',
    min: 1,
  },
  {
    key: 'CHUNK_REQUEST_THREAD_POOL_SIZE_TOTAL',
    label: 'Chunk Thread Pool (Total)',
    description: 'Total thread count for chunk requests.',
    category: 'performance',
    type: 'number',
    defaultValue: '10',
    min: 1,
    guidance: 'Setting this too high can increase CPU contention and frame-time spikes.',
  },
  {
    key: 'CHUNK_REQUEST_THREAD_POOL_SIZE_CPU',
    label: 'Chunk Thread Pool (CPU)',
    description: 'CPU generation threads used for chunk work.',
    category: 'performance',
    type: 'number',
    defaultValue: '2',
    min: 1,
    guidance: 'Keep near available core count minus one to avoid heavy CPU spikes.',
  },
];

const SERVER_CONFIG_DEFAULTS: Record<string, string> = Object.fromEntries(
  SERVER_CONFIG_FIELDS.map((field) => [field.key, field.defaultValue]),
);

const SERVER_CONFIG_FIELD_KEYS = new Set(SERVER_CONFIG_FIELDS.map((field) => field.key));

const inferServerConfigFieldType = (rawValue: string): ServerConfigFieldType => {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'false') return 'boolean';
  if (/^-?\d+$/.test(normalized)) return 'number';
  return 'string';
};

const humanizeServerConfigKey = (key: string): string => key
  .toLowerCase()
  .split('_')
  .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
  .join(' ');

const getConfigFieldValidation = (field: ServerConfigField, rawValue: string): ConfigFieldValidation => {
  const trimmed = rawValue.trim();

  if (field.type === 'number') {
    if (!trimmed) {
      return { error: 'A numeric value is required.', warning: null };
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      return { error: 'Enter a whole number.', warning: null };
    }

    if (field.min !== undefined && parsed < field.min) {
      return { error: null, warning: `Value is below minimum and will be clamped to ${field.min}.` };
    }

    if (field.max !== undefined && parsed > field.max) {
      return { error: null, warning: `Value is above maximum and will be clamped to ${field.max}.` };
    }

    if (field.key === 'SECTOR_AUTOSAVE_SEC' && parsed > 0 && parsed < 30) {
      return { error: null, warning: 'Frequent autosaves can cause stutter on slower disks.' };
    }

    if (field.key === 'SECTOR_AUTOSAVE_SEC' && parsed === -1) {
      return { error: null, warning: 'Autosave disabled. Ensure you have another backup strategy.' };
    }

    if (
      (field.key === 'CHUNK_REQUEST_THREAD_POOL_SIZE_TOTAL' || field.key === 'CHUNK_REQUEST_THREAD_POOL_SIZE_CPU')
      && parsed > 32
    ) {
      return { error: null, warning: 'Very high thread counts can cause severe CPU spikes.' };
    }
  }

  if (field.type === 'string' && !trimmed) {
    return { error: null, warning: `Empty value will fall back to default (${field.defaultValue}).` };
  }

  return { error: null, warning: null };
};

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
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigEditorTab>('server-cfg');
  const [activeLogFilters, setActiveLogFilters] = useState<LogFilter[]>([...LOG_FILTER_OPTIONS]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lifecycleState, setLifecycleState] = useState<ServerLifecycleState>('stopped');
  const [runtimePid, setRuntimePid] = useState<number | undefined>(undefined);
  const [runtimeUptimeMs, setRuntimeUptimeMs] = useState<number | undefined>(undefined);
  const [maxPlayersInput, setMaxPlayersInput] = useState<number>(32);
  const [bindAddressInput, setBindAddressInput] = useState<string>('all');
  const [isPublicServerInput, setIsPublicServerInput] = useState<boolean>(false);
  const [useAuthInput, setUseAuthInput] = useState<boolean>(false);
  const [requireAuthInput, setRequireAuthInput] = useState<boolean>(false);
  const [configFields, setConfigFields] = useState<ServerConfigField[]>(SERVER_CONFIG_FIELDS);
  const [serverConfigValues, setServerConfigValues] = useState<Record<string, string>>(SERVER_CONFIG_DEFAULTS);
  const [configSearchTerm, setConfigSearchTerm] = useState('');
  const [configCategoryFilter, setConfigCategoryFilter] = useState<Set<string>>(new Set());
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [gameConfigXmlText, setGameConfigXmlText] = useState('');
  const [gameConfigFields, setGameConfigFields] = useState<GameConfigField[]>([]);
  const [gameConfigListSections, setGameConfigListSections] = useState<GameConfigListSection[]>([]);
  const [gameConfigValues, setGameConfigValues] = useState<Record<string, string>>({});
  const [gameConfigSavedValues, setGameConfigSavedValues] = useState<Record<string, string>>({});
  const [gameConfigSearchTerm, setGameConfigSearchTerm] = useState('');
  const [gameConfigCategoryFilter, setGameConfigCategoryFilter] = useState<Set<string>>(new Set());
  const [showAdvancedGameConfigLists, setShowAdvancedGameConfigLists] = useState(false);
  const [gameConfigLoadedServerId, setGameConfigLoadedServerId] = useState<string | null>(null);
  const [isGameConfigLoading, setIsGameConfigLoading] = useState(false);
  const [savingGameConfigPath, setSavingGameConfigPath] = useState<string | null>(null);
  const [gameConfigError, setGameConfigError] = useState<string | null>(null);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [isSavingMaxPlayers, setIsSavingMaxPlayers] = useState(false);
  const [isSavingConnectionSettings, setIsSavingConnectionSettings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logCategories, setLogCategories] = useState<LogCategory[]>([]);
  const [selectedLogRelativePath, setSelectedLogRelativePath] = useState<string | null>(null);
  const [selectedLogPathByCategoryId, setSelectedLogPathByCategoryId] = useState<Record<string, string>>({});
  const [isLogListLoading, setIsLogListLoading] = useState(false);
  const [isLogFileLoading, setIsLogFileLoading] = useState(false);
  const [isLogFileTruncated, setIsLogFileTruncated] = useState(false);
  const [logLoadError, setLogLoadError] = useState<string | null>(null);
  const [fileEntriesByDir, setFileEntriesByDir] = useState<Record<string, InstallationFileEntry[]>>({});
  const [expandedFileDirs, setExpandedFileDirs] = useState<string[]>(['']);
  const [openFileTabs, setOpenFileTabs] = useState<string[]>([]);
  const [activeFileTabPath, setActiveFileTabPath] = useState<string | null>(null);
  const [fileContentByPath, setFileContentByPath] = useState<Record<string, string>>({});
  const [savedFileContentByPath, setSavedFileContentByPath] = useState<Record<string, string>>({});
  const [isFileBrowserLoading, setIsFileBrowserLoading] = useState(false);
  const [isFileEditorLoading, setIsFileEditorLoading] = useState(false);
  const [isFileSaving, setIsFileSaving] = useState(false);
  const [fileTabError, setFileTabError] = useState<string | null>(null);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(createDefaultDashboardLayout);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [isLayoutEditMode, setIsLayoutEditMode] = useState(false);
  const [isActionCatalogOpen, setIsActionCatalogOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('main');
  const [newGroupName, setNewGroupName] = useState('');
  const [draggedWidget, setDraggedWidget] = useState<DraggedWidget | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [draggedQuickAction, setDraggedQuickAction] = useState<DraggedQuickAction | null>(null);
  const [widgetDropTarget, setWidgetDropTarget] = useState<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<number | null>(null);
  const [quickActionDropTarget, setQuickActionDropTarget] = useState<number | null>(null);
  const [groupResizeDraft, setGroupResizeDraft] = useState<{ groupId: string; startY: number; startHeight: number } | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const groupContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { navigate } = useApp();
  const {
    servers,
    versions,
    activeAccount,
    selectedServer,
    selectedServerId,
    setSelectedServerId,
    updateServer: updateServerItem,
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
  const effectiveServerIp = effectiveServer?.serverIp?.trim() || '127.0.0.1';
  const fallbackMaxPlayers = Math.max(0, effectiveServer?.maxPlayers ?? 32);
  const hasGameApi = typeof window !== 'undefined' && !!window.launcher?.game;
  const hasDownloadApi = typeof window !== 'undefined' && !!window.launcher?.download;
  const hasStoreApi = typeof window !== 'undefined' && !!window.launcher?.store;

  const serverDownloadStatus = effectiveServer ? downloadStatuses[effectiveServer.id] : undefined;
  const isUpdating = serverDownloadStatus?.state === 'checksums' || serverDownloadStatus?.state === 'downloading';

  const selectedLogCategoryId = useMemo(() => {
    if (!selectedLogRelativePath) return null;
    const category = logCategories.find((item) => item.files.some((file) => file.relativePath === selectedLogRelativePath));
    return category?.id ?? null;
  }, [logCategories, selectedLogRelativePath]);

  const selectedLogCategoryFiles = useMemo(() => {
    if (!selectedLogCategoryId) return [] as LogFileItem[];
    return logCategories.find((category) => category.id === selectedLogCategoryId)?.files ?? [];
  }, [logCategories, selectedLogCategoryId]);

  const selectedLogCategory = useMemo(() => {
    if (!selectedLogCategoryId) return null;
    return logCategories.find((category) => category.id === selectedLogCategoryId) ?? null;
  }, [logCategories, selectedLogCategoryId]);

  const selectedLogRelativePathRef = useRef<string | null>(null);
  const selectedLogPathByCategoryRef = useRef<Record<string, string>>({});

  useEffect(() => {
    selectedLogRelativePathRef.current = selectedLogRelativePath;
  }, [selectedLogRelativePath]);

  useEffect(() => {
    selectedLogPathByCategoryRef.current = selectedLogPathByCategoryId;
  }, [selectedLogPathByCategoryId]);

  const reloadLogCatalog = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) {
      setLogCategories([]);
      setSelectedLogRelativePath(null);
      setSelectedLogPathByCategoryId({});
      setLogPath(null);
      return;
    }

    setIsLogListLoading(true);
    setLogLoadError(null);
    try {
      const catalog = await window.launcher.game.listLogFiles(effectiveServer.path);
      setLogCategories(catalog.categories);

      const knownPaths = new Set(catalog.categories.flatMap((category) => category.files.map((file) => file.relativePath)));
      const fallback = catalog.defaultRelativePath;
      const currentSelection = selectedLogRelativePathRef.current;
      const nextSelected = currentSelection && knownPaths.has(currentSelection)
        ? currentSelection
        : fallback;

      const nextByCategory = { ...selectedLogPathByCategoryRef.current };
      for (const category of catalog.categories) {
        const currentForCategory = nextByCategory[category.id];
        const inCategory = category.files.some((file) => file.relativePath === currentForCategory);
        if (!inCategory && category.files[0]) {
          nextByCategory[category.id] = category.files[0].relativePath;
        }
      }
      setSelectedLogPathByCategoryId(nextByCategory);

      setSelectedLogRelativePath(nextSelected ?? null);
      setLogPath(nextSelected ? `logs/${nextSelected}` : null);
    } catch (error) {
      setLogCategories([]);
      setSelectedLogRelativePath(null);
      setLogPath(null);
      setLogLoadError(`Failed to list logs folder contents: ${String(error)}`);
    } finally {
      setIsLogListLoading(false);
    }
  }, [effectiveServer, hasGameApi]);

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
    setLogCategories([]);
    setSelectedLogRelativePath(null);
    setSelectedLogPathByCategoryId({});
    setIsLogFileTruncated(false);
    setLogLoadError(null);
    setActiveConfigTab('server-cfg');
    setGameConfigXmlText('');
    setGameConfigFields([]);
    setGameConfigListSections([]);
    setGameConfigValues({});
    setGameConfigSavedValues({});
    setGameConfigSearchTerm('');
    setGameConfigCategoryFilter(new Set());
    setShowAdvancedGameConfigLists(false);
    setGameConfigLoadedServerId(null);
    setSavingGameConfigPath(null);
    setGameConfigError(null);
    setFileEntriesByDir({});
    setExpandedFileDirs(['']);
    setOpenFileTabs([]);
    setActiveFileTabPath(null);
    setFileContentByPath({});
    setSavedFileContentByPath({});
    setFileTabError(null);
  }, [effectiveServer?.id]);

  useEffect(() => {
    void reloadLogCatalog();
  }, [reloadLogCatalog]);

  useEffect(() => {
    let cancelled = false;

    if (!effectiveServer || !hasGameApi) {
      setMaxPlayersInput(fallbackMaxPlayers);
      return;
    }

    const loadMaxPlayersFromCfg = async () => {
      try {
        const raw = await window.launcher.game.readServerConfigValue(effectiveServer.path, 'MAX_CLIENTS');
        if (cancelled) return;
        const parsed = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
        if (Number.isFinite(parsed) && parsed >= 0) {
          setMaxPlayersInput(parsed);
          return;
        }
      } catch (error) {
        console.warn('[ServerPanel] Failed to read MAX_CLIENTS from server.cfg:', error);
      }

      if (!cancelled) {
        setMaxPlayersInput(fallbackMaxPlayers);
      }
    };

    void loadMaxPlayersFromCfg();

    return () => {
      cancelled = true;
    };
  }, [effectiveServer, hasGameApi, fallbackMaxPlayers]);

  useEffect(() => {
    let cancelled = false;

    if (!effectiveServer || !hasGameApi) {
      setBindAddressInput(effectiveServerIp || 'all');
      setIsPublicServerInput(false);
      setUseAuthInput(false);
      setRequireAuthInput(false);
      return;
    }

    const loadConnectionConfig = async () => {
      try {
        const [listenIpRaw, publicRaw, useAuthRaw, requireAuthRaw] = await Promise.all([
          window.launcher.game.readServerConfigValue(effectiveServer.path, 'SERVER_LISTEN_IP'),
          window.launcher.game.readServerConfigValue(effectiveServer.path, 'ANNOUNCE_SERVER_TO_SERVERLIST'),
          window.launcher.game.readServerConfigValue(effectiveServer.path, 'USE_STARMADE_AUTHENTICATION'),
          window.launcher.game.readServerConfigValue(effectiveServer.path, 'REQUIRE_STARMADE_AUTHENTICATION'),
        ]);

        if (cancelled) return;

        setBindAddressInput(listenIpRaw?.trim() || 'all');
        setIsPublicServerInput(parseCfgBoolean(publicRaw, false));
        const useAuth = parseCfgBoolean(useAuthRaw, false);
        setUseAuthInput(useAuth);
        setRequireAuthInput(useAuth ? parseCfgBoolean(requireAuthRaw, false) : false);
      } catch (error) {
        console.warn('[ServerPanel] Failed to read server.cfg connection settings:', error);
        if (!cancelled) {
          setBindAddressInput(effectiveServerIp || 'all');
          setIsPublicServerInput(false);
          setUseAuthInput(false);
          setRequireAuthInput(false);
        }
      }
    };

    void loadConnectionConfig();

    return () => {
      cancelled = true;
    };
  }, [effectiveServer, effectiveServerIp, hasGameApi]);

  useEffect(() => {
    let cancelled = false;

    if (!effectiveServer || !hasGameApi) {
      setConfigFields(SERVER_CONFIG_FIELDS);
      setServerConfigValues(SERVER_CONFIG_DEFAULTS);
      return;
    }

    const loadConfigValues = async () => {
      setIsConfigLoading(true);
      try {
        const cfgEntries: ServerConfigEntry[] = await window.launcher.game.listServerConfigValues(effectiveServer.path);

        const discoveredFields: ServerConfigField[] = cfgEntries
          .filter((entry) => !SERVER_CONFIG_FIELD_KEYS.has(entry.key))
          .map((entry) => ({
            key: entry.key,
            label: humanizeServerConfigKey(entry.key),
            description: entry.comment || 'Discovered key from server.cfg.',
            category: 'advanced',
            type: inferServerConfigFieldType(entry.value),
            defaultValue: entry.value,
          }))
          .sort((a, b) => a.key.localeCompare(b.key));

        const nextFields = [...SERVER_CONFIG_FIELDS, ...discoveredFields];
        const valueMap: Record<string, string> = Object.fromEntries(nextFields.map((field) => [field.key, field.defaultValue]));
        for (const entry of cfgEntries) {
          valueMap[entry.key] = entry.value;
        }

        if (cancelled) return;
        setConfigFields(nextFields);
        setServerConfigValues(valueMap);
      } catch (error) {
        console.warn('[ServerPanel] Failed to load configuration values from server.cfg:', error);
        if (!cancelled) {
          setConfigFields(SERVER_CONFIG_FIELDS);
          setServerConfigValues(SERVER_CONFIG_DEFAULTS);
        }
      } finally {
        if (!cancelled) setIsConfigLoading(false);
      }
    };

    void loadConfigValues();

    return () => {
      cancelled = true;
    };
  }, [effectiveServer, hasGameApi]);

  const hydrateGameConfigState = useCallback((xmlContent: string, options?: { keepDrafts?: boolean }) => {
    const parsed = extractGameConfigFields(xmlContent);
    const listSections = extractGameConfigListSections(xmlContent);
    setGameConfigXmlText(xmlContent);
    setGameConfigFields(parsed.fields);
    setGameConfigListSections(listSections);
    setGameConfigValues((prev) => (options?.keepDrafts ? { ...parsed.values, ...prev } : parsed.values));
    setGameConfigSavedValues(parsed.values);
  }, []);

  useEffect(() => {
    if (activeConfigTab !== 'game-config-xml') return;
    if (!effectiveServer || !hasGameApi) return;
    if (gameConfigLoadedServerId === effectiveServer.id) return;

    let cancelled = false;
    setIsGameConfigLoading(true);
    setGameConfigError(null);

    const loadGameConfigXml = async () => {
      try {
        const content = await window.launcher.game.readGameConfigXml(effectiveServer.path);
        if (cancelled) return;

        const next = content ?? '';
        hydrateGameConfigState(next);
        setGameConfigLoadedServerId(effectiveServer.id);
      } catch (error) {
        if (cancelled) return;
        setGameConfigError(`Failed to load GameConfig.xml: ${String(error)}`);
        setGameConfigFields([]);
        setGameConfigListSections([]);
        setGameConfigValues({});
        setGameConfigSavedValues({});
      } finally {
        if (!cancelled) setIsGameConfigLoading(false);
      }
    };

    void loadGameConfigXml();

    return () => {
      cancelled = true;
    };
  }, [activeConfigTab, effectiveServer, gameConfigLoadedServerId, hasGameApi, hydrateGameConfigState]);

  const loadFileDirectory = useCallback(async (relativeDir = '') => {
    if (!effectiveServer || !hasGameApi) return;

    setIsFileBrowserLoading(true);
    try {
      const entries = await window.launcher.game.listInstallationFiles(effectiveServer.path, relativeDir);
      setFileEntriesByDir((prev) => ({ ...prev, [relativeDir]: entries }));
    } catch (error) {
      setFileTabError(`Failed to list files in ${relativeDir || '/'}: ${String(error)}`);
    } finally {
      setIsFileBrowserLoading(false);
    }
  }, [effectiveServer, hasGameApi]);

  useEffect(() => {
    if (activeTab !== 'files') return;
    if (!effectiveServer || !hasGameApi) return;
    if (fileEntriesByDir['']) return;
    void loadFileDirectory('');
  }, [activeTab, effectiveServer, fileEntriesByDir, hasGameApi, loadFileDirectory]);

  const toggleFileDirectory = useCallback((relativeDir: string) => {
    setExpandedFileDirs((prev) => {
      const isExpanded = prev.includes(relativeDir);
      if (isExpanded) {
        return prev.filter((dir) => dir !== relativeDir);
      }
      return [...prev, relativeDir];
    });

    if (!fileEntriesByDir[relativeDir]) {
      void loadFileDirectory(relativeDir);
    }
  }, [fileEntriesByDir, loadFileDirectory]);

  const openFileInTab = useCallback(async (relativePath: string) => {
    if (!effectiveServer || !hasGameApi) return;

    setOpenFileTabs((prev) => (prev.includes(relativePath) ? prev : [...prev, relativePath]));
    setActiveFileTabPath(relativePath);

    if (relativePath in fileContentByPath) return;

    setIsFileEditorLoading(true);
    setFileTabError(null);
    try {
      const payload = await window.launcher.game.readInstallationFile(effectiveServer.path, relativePath);
      if (payload.error) {
        setFileTabError(`Failed to open ${relativePath}: ${payload.error}`);
        return;
      }

      setFileContentByPath((prev) => ({ ...prev, [relativePath]: payload.content }));
      setSavedFileContentByPath((prev) => ({ ...prev, [relativePath]: payload.content }));
    } catch (error) {
      setFileTabError(`Failed to open ${relativePath}: ${String(error)}`);
    } finally {
      setIsFileEditorLoading(false);
    }
  }, [effectiveServer, fileContentByPath, hasGameApi]);

  const closeFileTab = useCallback((relativePath: string) => {
    setOpenFileTabs((prev) => {
      const next = prev.filter((path) => path !== relativePath);
      setActiveFileTabPath((current) => {
        if (current !== relativePath) return current;
        return next.length > 0 ? next[next.length - 1] : null;
      });
      return next;
    });
  }, []);

  const reloadActiveFileTab = useCallback(async () => {
    if (!effectiveServer || !hasGameApi || !activeFileTabPath) return;

    setIsFileEditorLoading(true);
    setFileTabError(null);
    try {
      const payload = await window.launcher.game.readInstallationFile(effectiveServer.path, activeFileTabPath);
      if (payload.error) {
        setFileTabError(`Failed to reload ${activeFileTabPath}: ${payload.error}`);
        return;
      }
      setFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: payload.content }));
      setSavedFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: payload.content }));
    } catch (error) {
      setFileTabError(`Failed to reload ${activeFileTabPath}: ${String(error)}`);
    } finally {
      setIsFileEditorLoading(false);
    }
  }, [activeFileTabPath, effectiveServer, hasGameApi]);

  const saveActiveFileTab = useCallback(async () => {
    if (!effectiveServer || !hasGameApi || !activeFileTabPath || isFileSaving) return;

    setIsFileSaving(true);
    setFileTabError(null);
    try {
      const content = fileContentByPath[activeFileTabPath] ?? '';
      const result = await window.launcher.game.writeInstallationFile(effectiveServer.path, activeFileTabPath, content);
      if (!result.success) {
        setFileTabError(result.error ?? `Failed to save ${activeFileTabPath}.`);
        return;
      }

      setSavedFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: content }));
    } catch (error) {
      setFileTabError(`Failed to save ${activeFileTabPath}: ${String(error)}`);
    } finally {
      setIsFileSaving(false);
    }
  }, [activeFileTabPath, effectiveServer, fileContentByPath, hasGameApi, isFileSaving]);

  useEffect(() => {
    let cancelled = false;

    if (!effectiveServer || !hasGameApi || !selectedLogRelativePath) {
      setLogs([]);
      setIsLogFileTruncated(false);
      setIsLogFileLoading(false);
      return;
    }

    setIsLogFileLoading(true);
    setLogLoadError(null);
    setLogPath(`logs/${selectedLogRelativePath}`);

    const loadLogFile = async () => {
      try {
        const payload = await window.launcher.game.readLogFile(effectiveServer.path, selectedLogRelativePath);
        if (cancelled) return;

        if (payload.error) {
          setLogs([]);
          setIsLogFileTruncated(false);
          setLogLoadError(`Failed to read ${selectedLogRelativePath}: ${payload.error}`);
          return;
        }

        const lines = payload.content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const parsed = lines.map(parseLogLine);
        const bounded = parsed.length <= LOG_BUFFER_CAP
          ? parsed
          : parsed.slice(parsed.length - LOG_BUFFER_CAP);

        setLogs(bounded);
        setIsLogFileTruncated(payload.truncated);
      } catch (error) {
        if (cancelled) return;
        setLogs([]);
        setIsLogFileTruncated(false);
        setLogLoadError(`Failed to load ${selectedLogRelativePath}: ${String(error)}`);
      } finally {
        if (!cancelled) {
          setIsLogFileLoading(false);
        }
      }
    };

    void loadLogFile();

    return () => {
      cancelled = true;
    };
  }, [effectiveServer, hasGameApi, selectedLogRelativePath]);

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
    setIsActionCatalogOpen(false);
    setDraggedWidget(null);
    setDraggedGroupId(null);
    setDraggedQuickAction(null);
    setWidgetDropTarget(null);
    setGroupDropTarget(null);
    setQuickActionDropTarget(null);
    setGroupResizeDraft(null);
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
    if (activeLogFilters.length === 0) return false;

    if (activeLogFilters.includes('errors') && (log.level === 'ERROR' || log.level === 'FATAL')) {
      return true;
    }
    if (activeLogFilters.includes('warnings') && log.level === 'WARNING') {
      return true;
    }
    if (activeLogFilters.includes('info') && (log.level === 'INFO' || log.level === 'stdout')) {
      return true;
    }
    if (activeLogFilters.includes('debug') && log.level === 'DEBUG') {
      return true;
    }

    return false;
  });

  const activeFileTabContent = activeFileTabPath ? (fileContentByPath[activeFileTabPath] ?? '') : '';
  const activeFileTabSavedContent = activeFileTabPath ? (savedFileContentByPath[activeFileTabPath] ?? '') : '';
  const activeFileTabHasUnsavedChanges = activeFileTabPath
    ? activeFileTabContent !== activeFileTabSavedContent
    : false;

  const areAllLogFiltersEnabled = activeLogFilters.length === LOG_FILTER_OPTIONS.length;

  const toggleLogFilter = useCallback((filter: LogFilter) => {
    setActiveLogFilters((prev) => {
      if (prev.includes(filter)) {
        // Keep at least one type active to avoid an unintentionally empty pane.
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== filter);
      }

      return [...prev, filter];
    });
  }, []);

  const selectAllLogFilters = useCallback(() => {
    setActiveLogFilters([...LOG_FILTER_OPTIONS]);
  }, []);

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

  const getGroupMinHeight = useCallback((group: DashboardGroup): number => {
    const weightedWidgetHeight = group.widgetIds.reduce((sum, widgetId) => sum + WIDGET_HEIGHT_WEIGHT[widgetId], 0);
    const estimated = 140 + weightedWidgetHeight;
    return Math.max(MIN_GROUP_HEIGHT, Math.min(estimated, MAX_GROUP_HEIGHT - 120));
  }, []);

  const updateGroupHeight = useCallback((groupId: string, nextHeight: number) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) return prev;
      const minHeight = getGroupMinHeight(group);
      group.height = Math.max(minHeight, Math.min(Math.round(nextHeight), MAX_GROUP_HEIGHT));
      return next;
    });
  }, [getGroupMinHeight]);

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
      next.groups.push({ id, title, widgetIds: [], height: MIN_GROUP_HEIGHT });
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

  const moveGroupToIndex = useCallback((groupId: string, targetIndex: number) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const index = next.groups.findIndex((group) => group.id === groupId);
      if (index < 0) {
        return prev;
      }

      const [group] = next.groups.splice(index, 1);
      const clampedTargetIndex = Math.max(0, Math.min(targetIndex, next.groups.length));
      next.groups.splice(clampedTargetIndex, 0, group);
      return next;
    });
  }, []);

  const resetDashboardLayout = useCallback(() => {
    setDashboardLayout(createDefaultDashboardLayout());
    setSelectedGroupId('main');
  }, []);

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) return prev;
      group.collapsed = !group.collapsed;
      return next;
    });
  }, []);

  const setAllGroupsCollapsed = useCallback((collapsed: boolean) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      next.groups = next.groups.map((group) => ({ ...group, collapsed }));
      return next;
    });
  }, []);

  const beginGroupResize = useCallback((groupId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const element = groupContainerRefs.current[groupId];
    if (!element) return;
    setGroupResizeDraft({
      groupId,
      startY: event.clientY,
      startHeight: element.getBoundingClientRect().height,
    });
  }, []);

  useEffect(() => {
    if (!groupResizeDraft) return;

    const handleMouseMove = (event: MouseEvent) => {
      const deltaY = event.clientY - groupResizeDraft.startY;
      updateGroupHeight(groupResizeDraft.groupId, groupResizeDraft.startHeight + deltaY);
    };

    const handleMouseUp = () => {
      setGroupResizeDraft(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [groupResizeDraft, updateGroupHeight]);

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

  const moveQuickActionToIndex = useCallback((actionId: ServerActionId, targetIndex: number) => {
    updateQuickActions((prev) => {
      const currentIndex = prev.indexOf(actionId);
      const clampedTargetIndex = Math.max(0, Math.min(targetIndex, prev.length));

      if (currentIndex < 0) {
        const next = [...prev];
        next.splice(clampedTargetIndex, 0, actionId);
        return next;
      }

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

  const handleClearCategoryLogs = useCallback((categoryId: string) => {
    if (selectedLogCategoryId === categoryId) {
      setLogs([]);
      setIsLogFileTruncated(false);
    }

    // Forget prior per-category tab selection so reopening defaults to latest.
    setSelectedLogPathByCategoryId((prev) => {
      if (!(categoryId in prev)) return prev;
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
  }, [selectedLogCategoryId]);

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

  const reloadGameConfigXml = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) return;

    setIsGameConfigLoading(true);
    setGameConfigError(null);
    try {
      const content = await window.launcher.game.readGameConfigXml(effectiveServer.path);
      const next = content ?? '';
      hydrateGameConfigState(next);
      setGameConfigLoadedServerId(effectiveServer.id);
    } catch (error) {
      setGameConfigError(`Failed to reload GameConfig.xml: ${String(error)}`);
    } finally {
      setIsGameConfigLoading(false);
    }
  }, [effectiveServer, hasGameApi, hydrateGameConfigState]);

  useEffect(() => {
    if (activeTab !== 'control') return;
    if (!effectiveServer || !hasGameApi) return;
    if (gameConfigLoadedServerId === effectiveServer.id) return;
    if (isGameConfigLoading || gameConfigError) return;
    void reloadGameConfigXml();
  }, [
    activeTab,
    effectiveServer,
    gameConfigError,
    gameConfigLoadedServerId,
    hasGameApi,
    isGameConfigLoading,
    reloadGameConfigXml,
  ]);

  const toggleGameConfigCategory = useCallback((category: GameConfigCategory) => {
    setGameConfigCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const saveGameConfigField = useCallback(async (field: GameConfigField, explicitValue?: string) => {
    if (!effectiveServer || !hasGameApi || savingGameConfigPath) return;

    const currentRaw = explicitValue ?? gameConfigValues[field.path] ?? field.defaultValue;
    const validation = getGameConfigFieldValidation(field, currentRaw);
    if (validation.error) return;

    let sanitized = currentRaw.trim();
    if (field.type === 'boolean') {
      sanitized = String(parseCfgBoolean(currentRaw, false));
    } else if (field.type === 'number') {
      const parsed = Number.parseFloat(currentRaw);
      if (!Number.isFinite(parsed)) return;

      const min = field.min ?? Number.NEGATIVE_INFINITY;
      const max = field.max ?? Number.POSITIVE_INFINITY;
      sanitized = String(Math.max(min, Math.min(max, parsed)));
    }

    setSavingGameConfigPath(field.path);
    setGameConfigError(null);
    setGameConfigValues((prev) => ({ ...prev, [field.path]: sanitized }));

    try {
      const doc = parseGameConfigXmlDocument(gameConfigXmlText);
      const target = findElementByGameConfigPath(doc, field.path);
      if (!target) {
        setGameConfigError(`Could not locate ${field.path} in GameConfig.xml.`);
        return;
      }

      target.textContent = sanitized;
      const serialized = new XMLSerializer().serializeToString(doc);
      const result = await window.launcher.game.writeGameConfigXml(effectiveServer.path, serialized);
      if (!result.success) {
        setGameConfigError(result.error ?? `Failed to save ${field.label} to GameConfig.xml.`);
        return;
      }

      hydrateGameConfigState(serialized, { keepDrafts: true });
      setGameConfigLoadedServerId(effectiveServer.id);
    } catch (error) {
      setGameConfigError(`Failed to save ${field.label}: ${String(error)}`);
    } finally {
      setSavingGameConfigPath(null);
    }
  }, [effectiveServer, gameConfigValues, gameConfigXmlText, hasGameApi, hydrateGameConfigState, savingGameConfigPath]);

  const persistMaxPlayers = useCallback(async () => {
    if (!effectiveServer || !hasGameApi || isSavingMaxPlayers) return;

    const sanitized = Math.max(0, Math.round(maxPlayersInput || 0));
    setMaxPlayersInput(sanitized);
    setIsSavingMaxPlayers(true);
    setActionError(null);

    try {
      const result = await window.launcher.game.writeServerConfigValue(
        effectiveServer.path,
        'MAX_CLIENTS',
        String(sanitized),
      );

      if (!result.success) {
        setActionError(result.error ?? 'Failed to save MAX_CLIENTS in server.cfg.');
        return;
      }

      if (effectiveServer.maxPlayers !== sanitized) {
        updateServerItem({ ...effectiveServer, maxPlayers: sanitized });
      }
    } catch (error) {
      setActionError(`Failed to save MAX_CLIENTS: ${String(error)}`);
    } finally {
      setIsSavingMaxPlayers(false);
    }
  }, [effectiveServer, hasGameApi, isSavingMaxPlayers, maxPlayersInput, updateServerItem]);

  const persistServerCfgValue = useCallback(async (key: string, value: string): Promise<boolean> => {
    if (!effectiveServer || !hasGameApi) return false;
    const result = await window.launcher.game.writeServerConfigValue(effectiveServer.path, key, value);
    if (!result.success) {
      setActionError(result.error ?? `Failed to save ${key} in server.cfg.`);
      return false;
    }
    return true;
  }, [effectiveServer, hasGameApi]);

  const saveConfigField = useCallback(async (field: ServerConfigField, explicitValue?: string) => {
    if (savingConfigKey) return;

    const currentRaw = explicitValue ?? serverConfigValues[field.key] ?? field.defaultValue;
    const validation = getConfigFieldValidation(field, currentRaw);
    if (validation.error) return;
    let nextValue = currentRaw;

    if (field.type === 'boolean') {
      nextValue = String(parseCfgBoolean(currentRaw, field.defaultValue === 'true'));
    } else if (field.type === 'number') {
      const parsed = Number.parseInt(currentRaw, 10);
      if (Number.isFinite(parsed)) {
        const min = field.min ?? Number.NEGATIVE_INFINITY;
        const max = field.max ?? Number.POSITIVE_INFINITY;
        nextValue = String(Math.max(min, Math.min(max, parsed)));
      } else {
        nextValue = field.defaultValue;
      }
    } else {
      nextValue = currentRaw.trim();
      if (!nextValue) nextValue = field.defaultValue;
    }

    setServerConfigValues((prev) => ({ ...prev, [field.key]: nextValue }));
    setSavingConfigKey(field.key);
    setActionError(null);

    try {
      const ok = await persistServerCfgValue(field.key, nextValue);
      if (!ok) return;

      if (field.key === 'MAX_CLIENTS') {
        const parsed = Number.parseInt(nextValue, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          setMaxPlayersInput(parsed);
          if (effectiveServer && effectiveServer.maxPlayers !== parsed) {
            updateServerItem({ ...effectiveServer, maxPlayers: parsed });
          }
        }
      }

      if (field.key === 'SERVER_LISTEN_IP') {
        setBindAddressInput(nextValue);
        if (effectiveServer && effectiveServer.serverIp !== nextValue) {
          updateServerItem({ ...effectiveServer, serverIp: nextValue });
        }
      }

      if (field.key === 'ANNOUNCE_SERVER_TO_SERVERLIST') {
        setIsPublicServerInput(parseCfgBoolean(nextValue, false));
      }
      if (field.key === 'USE_STARMADE_AUTHENTICATION') {
        const enabled = parseCfgBoolean(nextValue, false);
        setUseAuthInput(enabled);
        if (!enabled) {
          setRequireAuthInput(false);
          setServerConfigValues((prev) => ({ ...prev, REQUIRE_STARMADE_AUTHENTICATION: 'false' }));
        }
      }
      if (field.key === 'REQUIRE_STARMADE_AUTHENTICATION') {
        setRequireAuthInput(parseCfgBoolean(nextValue, false));
      }
    } catch (error) {
      setActionError(`Failed to save ${field.key}: ${String(error)}`);
    } finally {
      setSavingConfigKey(null);
    }
  }, [effectiveServer, persistServerCfgValue, savingConfigKey, serverConfigValues, updateServerItem]);

  const persistBindAddress = useCallback(async () => {
    if (isSavingConnectionSettings) return;
    const sanitized = bindAddressInput.trim() || 'all';
    setBindAddressInput(sanitized);
    setIsSavingConnectionSettings(true);
    setActionError(null);
    try {
      const ok = await persistServerCfgValue('SERVER_LISTEN_IP', sanitized);
      if (ok && effectiveServer && effectiveServer.serverIp !== sanitized) {
        updateServerItem({ ...effectiveServer, serverIp: sanitized });
      }
    } catch (error) {
      setActionError(`Failed to save SERVER_LISTEN_IP: ${String(error)}`);
    } finally {
      setIsSavingConnectionSettings(false);
    }
  }, [bindAddressInput, effectiveServer, isSavingConnectionSettings, persistServerCfgValue, updateServerItem]);

  const togglePublicServer = useCallback(async (nextChecked: boolean) => {
    if (isSavingConnectionSettings) return;
    setIsPublicServerInput(nextChecked);
    setIsSavingConnectionSettings(true);
    setActionError(null);
    try {
      const ok = await persistServerCfgValue('ANNOUNCE_SERVER_TO_SERVERLIST', String(nextChecked));
      if (!ok) setIsPublicServerInput(!nextChecked);
    } catch (error) {
      setIsPublicServerInput(!nextChecked);
      setActionError(`Failed to save ANNOUNCE_SERVER_TO_SERVERLIST: ${String(error)}`);
    } finally {
      setIsSavingConnectionSettings(false);
    }
  }, [isSavingConnectionSettings, persistServerCfgValue]);

  const toggleUseAuthentication = useCallback(async (nextChecked: boolean) => {
    if (isSavingConnectionSettings) return;
    const previousUseAuth = useAuthInput;
    const previousRequireAuth = requireAuthInput;
    setUseAuthInput(nextChecked);
    if (!nextChecked) setRequireAuthInput(false);
    setIsSavingConnectionSettings(true);
    setActionError(null);
    try {
      const useAuthSaved = await persistServerCfgValue('USE_STARMADE_AUTHENTICATION', String(nextChecked));
      if (!useAuthSaved) {
        setUseAuthInput(previousUseAuth);
        setRequireAuthInput(previousRequireAuth);
        return;
      }

      if (!nextChecked) {
        const requireSaved = await persistServerCfgValue('REQUIRE_STARMADE_AUTHENTICATION', 'false');
        if (!requireSaved) {
          setUseAuthInput(previousUseAuth);
          setRequireAuthInput(previousRequireAuth);
        }
      }
    } catch (error) {
      setUseAuthInput(previousUseAuth);
      setRequireAuthInput(previousRequireAuth);
      setActionError(`Failed to save authentication settings: ${String(error)}`);
    } finally {
      setIsSavingConnectionSettings(false);
    }
  }, [isSavingConnectionSettings, persistServerCfgValue, requireAuthInput, useAuthInput]);

  const toggleRequireAuthentication = useCallback(async (nextChecked: boolean) => {
    if (isSavingConnectionSettings || !useAuthInput) return;
    const previous = requireAuthInput;
    setRequireAuthInput(nextChecked);
    setIsSavingConnectionSettings(true);
    setActionError(null);
    try {
      const ok = await persistServerCfgValue('REQUIRE_STARMADE_AUTHENTICATION', String(nextChecked));
      if (!ok) setRequireAuthInput(previous);
    } catch (error) {
      setRequireAuthInput(previous);
      setActionError(`Failed to save REQUIRE_STARMADE_AUTHENTICATION: ${String(error)}`);
    } finally {
      setIsSavingConnectionSettings(false);
    }
  }, [isSavingConnectionSettings, persistServerCfgValue, requireAuthInput, useAuthInput]);

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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_3fr]">
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
        <span className="w-36 text-gray-300">Server IP:</span>
        <input
          value={effectiveServerIp}
          readOnly
          className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
        />
      </label>
    </div>
  );

  const renderConnectionWidget = () => (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 text-gray-300">Bind Address:</span>
          <input
            value={bindAddressInput}
            onChange={(event) => setBindAddressInput(event.target.value)}
            onBlur={() => { void persistBindAddress(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void persistBindAddress();
              }
            }}
            disabled={isSavingConnectionSettings}
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
          <input
            type="number"
            min={0}
            value={maxPlayersInput}
            onChange={(event) => setMaxPlayersInput(Math.max(0, Number(event.target.value) || 0))}
            onBlur={() => { void persistMaxPlayers(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void persistMaxPlayers();
              }
            }}
            disabled={isSavingMaxPlayers}
            className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-md border border-white/10 bg-black/20 p-3 text-sm text-gray-300">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPublicServerInput}
            onChange={(event) => { void togglePublicServer(event.target.checked); }}
            disabled={isSavingConnectionSettings}
            className="h-4 w-4 rounded"
          />
          <span>Public Server</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useAuthInput}
            onChange={(event) => { void toggleUseAuthentication(event.target.checked); }}
            disabled={isSavingConnectionSettings}
            className="h-4 w-4 rounded"
          />
          <span>Use Authentication</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={requireAuthInput}
            onChange={(event) => { void toggleRequireAuthentication(event.target.checked); }}
            disabled={isSavingConnectionSettings || !useAuthInput}
            className="h-4 w-4 rounded"
          />
          <span>Require Authentication</span>
        </label>
      </div>

      <div className="space-y-4 rounded-md border border-white/10 bg-black/20 p-3 text-sm text-gray-300 lg:col-span-2">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">server.cfg quick edit</p>
              <p className="text-xs text-gray-500">Changes are written to server.cfg.</p>
            </div>

            {DASHBOARD_SERVER_CFG_QUICK_KEYS.map((key) => {
              const field = configFields.find((candidate) => candidate.key === key);
              if (!field) return null;
              const rawValue = serverConfigValues[field.key] ?? field.defaultValue;
              const validation = getConfigFieldValidation(field, rawValue);
              const isSavingThisField = savingConfigKey === field.key;

              return (
                <div key={`dashboard-${field.key}`} className="rounded border border-white/10 bg-black/25 p-2">
                  <p className="text-xs font-semibold text-gray-200">{field.label}</p>
                  <p className="mb-2 text-[11px] text-gray-500">{field.key}</p>

                  {field.type === 'boolean' ? (
                    <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={parseCfgBoolean(rawValue, field.defaultValue === 'true')}
                        onChange={(event) => {
                          const next = String(event.target.checked);
                          setServerConfigValues((prev) => ({ ...prev, [field.key]: next }));
                          void saveConfigField(field, next);
                        }}
                        disabled={!!savingConfigKey || !!validation.error}
                        className="h-4 w-4 rounded"
                      />
                      Enabled
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={rawValue}
                        onChange={(event) => {
                          const next = event.target.value;
                          setServerConfigValues((prev) => ({ ...prev, [field.key]: next }));
                        }}
                        onBlur={() => { void saveConfigField(field); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveConfigField(field);
                          }
                        }}
                        disabled={!!savingConfigKey}
                        className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-gray-200"
                      />
                      <button
                        onClick={() => { void saveConfigField(field); }}
                        disabled={!!savingConfigKey || !!validation.error}
                        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSavingThisField ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  )}

                  {(validation.error || validation.warning) && (
                    <p className={`mt-1 text-[10px] ${validation.error ? 'text-red-300' : 'text-amber-300'}`}>
                      {validation.error ?? validation.warning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">GameConfig.xml quick edit</p>
                <p className="text-xs text-gray-500">Changes are written to GameConfig.xml.</p>
              </div>
              <button
                onClick={() => { void reloadGameConfigXml(); }}
                disabled={isGameConfigLoading || !!savingGameConfigPath}
                className="rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reload XML
              </button>
            </div>

            {!hasGameApi ? (
              <p className="text-xs text-gray-500">Game API unavailable.</p>
            ) : isGameConfigLoading ? (
              <p className="text-xs text-gray-500">Loading GameConfig.xml...</p>
            ) : gameConfigLoadedServerId !== effectiveServer?.id ? (
              <p className="text-xs text-gray-500">GameConfig.xml not loaded yet.</p>
            ) : (
              DASHBOARD_GAME_CONFIG_QUICK_PATHS.map((path) => {
                const field = gameConfigFields.find((candidate) => candidate.path === path);
                if (!field) return null;

                const rawValue = gameConfigValues[field.path] ?? field.defaultValue;
                const validation = getGameConfigFieldValidation(field, rawValue);
                const isSavingThisField = savingGameConfigPath === field.path;

                return (
                  <div key={`dashboard-${field.path}`} className="rounded border border-white/10 bg-black/25 p-2">
                    <p className="text-xs font-semibold text-gray-200">{field.label}</p>
                    <p className="mb-2 text-[11px] text-gray-500">{field.path}</p>

                    {field.type === 'boolean' ? (
                      <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={parseCfgBoolean(rawValue, field.defaultValue.toLowerCase() === 'true')}
                          onChange={(event) => {
                            const next = String(event.target.checked);
                            setGameConfigValues((prev) => ({ ...prev, [field.path]: next }));
                            void saveGameConfigField(field, next);
                          }}
                          disabled={!!savingGameConfigPath || !!validation.error}
                          className="h-4 w-4 rounded"
                        />
                        Enabled
                      </label>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={rawValue}
                          onChange={(event) => {
                            const next = event.target.value;
                            setGameConfigValues((prev) => ({ ...prev, [field.path]: next }));
                          }}
                          onBlur={() => { void saveGameConfigField(field); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void saveGameConfigField(field);
                            }
                          }}
                          disabled={!!savingGameConfigPath}
                          className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-gray-200"
                        />
                        <button
                          onClick={() => { void saveGameConfigField(field); }}
                          disabled={!!savingGameConfigPath || !!validation.error}
                          className="rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingThisField ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    )}

                    {(validation.error || validation.warning) && (
                      <p className={`mt-1 text-[10px] ${validation.error ? 'text-red-300' : 'text-amber-300'}`}>
                        {validation.error ?? validation.warning}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPlayersWidget = () => (
    <div className="min-h-[220px] overflow-y-auto rounded-md border border-white/10 bg-black/20 p-3 font-mono text-sm text-blue-300">
      Player listing will appear here when server player-state events are wired.
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
    options?: { showQuickToggle?: boolean; enableQuickDrag?: boolean; allowCatalogDrag?: boolean; emptyMessage?: string },
  ) => {
    if (actions.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-white/15 bg-black/20 p-4 text-sm text-gray-400">
          {options?.emptyMessage ?? 'No actions available.'}
        </div>
      );
    }

    const gridClassName = options?.showQuickToggle
      ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3'
      : 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4';

    return (
      <div className={gridClassName}>
        {options?.enableQuickDrag && isLayoutEditMode && renderQuickActionDropZone(0, 'col-span-full')}
        {actions.map((action) => {
          const isPinned = dashboardLayout.quickActionIds.includes(action.id);
          const quickActionIndex = dashboardLayout.quickActionIds.indexOf(action.id);
          const canDrag = isLayoutEditMode && ((!!options?.enableQuickDrag && isPinned) || !!options?.allowCatalogDrag);
          return (
            <React.Fragment key={action.id}>
              <div
                draggable={canDrag}
                onDragStart={() => {
                  if (!canDrag) return;
                  setDraggedQuickAction({ actionId: action.id });
                  setQuickActionDropTarget(isPinned && quickActionIndex >= 0 ? quickActionIndex : dashboardLayout.quickActionIds.length);
                }}
                onDragEnd={() => {
                  setDraggedQuickAction(null);
                  setQuickActionDropTarget(null);
                }}
                className={`rounded-lg border p-4 transition-all ${
                  draggedQuickAction?.actionId === action.id
                    ? 'border-starmade-accent/50 bg-starmade-accent/10 opacity-60 shadow-[0_0_0_1px_rgba(34,123,134,0.25)]'
                    : 'border-white/10 bg-black/20 hover:border-white/20'
                } ${canDrag ? 'cursor-move' : ''}`}
              >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {canDrag && renderDragHandle(`Drag ${action.label}`)}
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
              {options?.enableQuickDrag && isLayoutEditMode && renderQuickActionDropZone((isPinned ? quickActionIndex : dashboardLayout.quickActionIds.length) + 1, 'col-span-full')}
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

  const renderQuickActionDropZone = (targetIndex: number, className = '', label?: string) => (
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
        className={`${label ? 'min-h-14 p-3 text-xs font-semibold uppercase tracking-wider' : 'h-3'} rounded border border-dashed transition-colors ${
          quickActionDropTarget === targetIndex
            ? 'border-starmade-accent bg-starmade-accent/20 shadow-[0_0_0_1px_rgba(34,123,134,0.35)]'
            : 'border-starmade-accent/60 bg-starmade-accent/10'
        } ${className}`}
      >
        {label ? label : null}
      </div>
    ) : null
  );

  const renderControlsWidget = () => (
    <div className="space-y-2">
      {isLayoutEditMode && draggedQuickAction && renderQuickActionDropZone(0, 'w-full', 'Drop action here to pin/reorder quick actions')}
      {renderActionGrid(quickActions, {
        showQuickToggle: isLayoutEditMode,
        enableQuickDrag: isLayoutEditMode,
        emptyMessage: 'Open Add Actions in edit mode and drag actions onto this widget.',
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
    isLayoutEditMode && !!draggedWidget ? (
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
          : 'border-white/20 bg-white/5 hover:border-starmade-accent/70'
      }`}
    />
    ) : null
  );

  const handleGroupDrop = (targetIndex: number) => {
    if (!draggedGroupId) return;
    moveGroupToIndex(draggedGroupId, targetIndex);
    setDraggedGroupId(null);
    setGroupDropTarget(null);
  };

  const renderGroupDropZone = (targetIndex: number) => (
    isLayoutEditMode && !!draggedGroupId ? (
      <div
        key={`group-drop-${targetIndex}`}
        onDragEnter={() => {
          if (!draggedGroupId) return;
          setGroupDropTarget(targetIndex);
        }}
        onDragOver={(event) => {
          if (!draggedGroupId) return;
          event.preventDefault();
          setGroupDropTarget(targetIndex);
        }}
        onDragLeave={() => {
          if (groupDropTarget === targetIndex) {
            setGroupDropTarget(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleGroupDrop(targetIndex);
        }}
        className={`h-4 rounded border border-dashed transition-colors ${
          groupDropTarget === targetIndex
            ? 'border-starmade-accent bg-starmade-accent/20 shadow-[0_0_0_1px_rgba(34,123,134,0.35)]'
            : 'border-white/20 bg-white/5 hover:border-starmade-accent/70'
        }`}
      />
    ) : null
  );

  const renderDashboardGroup = (group: DashboardGroup) => {
    const minHeight = getGroupMinHeight(group);
    const height = Math.max(group.height ?? minHeight, minHeight);
    const isCollapsed = !!group.collapsed;
    const isResizing = groupResizeDraft?.groupId === group.id;
    const isDraggedGroup = draggedGroupId === group.id;

    return (
    <div
      className={`rounded-lg border bg-black/10 p-3 transition-all ${
        isDraggedGroup
          ? 'border-starmade-accent/50 opacity-60 shadow-[0_0_0_1px_rgba(34,123,134,0.25)]'
          : 'border-white/10'
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isLayoutEditMode ? (
          <>
            <span
              draggable
              onDragStart={() => {
                setDraggedGroupId(group.id);
              }}
              onDragEnd={() => {
                setDraggedGroupId(null);
                setGroupDropTarget(null);
              }}
            >
              {renderDragHandle(`Drag group ${group.title}`)}
            </span>
            <input
              value={group.title}
              onChange={(event) => renameGroup(group.id, event.target.value)}
              className="min-w-[160px] flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-gray-200"
            />
            <button
              onClick={() => toggleGroupCollapsed(group.id)}
              className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold text-gray-300 hover:bg-black/45"
            >
              {isCollapsed ? 'Expand' : 'Collapse'}
            </button>
            <button
              onClick={() => deleteGroup(group.id)}
              disabled={dashboardLayout.groups.length <= 1}
              className="rounded border border-red-500/40 bg-red-950/30 px-2 py-1 text-xs font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
            <span className="ml-auto text-xs uppercase tracking-wider text-gray-500">Min {minHeight}px</span>
          </>
        ) : (
          <>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">{group.title}</h3>
            <button
              onClick={() => toggleGroupCollapsed(group.id)}
              className="ml-auto rounded border border-white/15 bg-black/30 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-300 hover:bg-black/45"
            >
              {isCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </>
        )}
      </div>

      {!isCollapsed && (
        <div
          ref={(element) => {
            groupContainerRefs.current[group.id] = element;
          }}
          style={{ height: `${height}px`, minHeight: `${minHeight}px` }}
          className={`space-y-2 overflow-y-auto pr-1 ${isResizing ? 'select-none' : ''}`}
        >
          {renderDropZone(group.id, 0)}
          {group.widgetIds.map((widgetId, index) => {
            const widgetLabel = ALL_WIDGETS.find((widget) => widget.id === widgetId)?.label ?? widgetId;
            const isDragged = draggedWidget?.widgetId === widgetId && draggedWidget.sourceGroupId === group.id;
            return (
              <React.Fragment key={`${group.id}-${widgetId}`}>
                {isLayoutEditMode ? (
                  <div
                    draggable
                    onDragStart={(event) => {
                      event.stopPropagation();
                      setDraggedWidget({ widgetId, sourceGroupId: group.id });
                    }}
                    onDragEnd={(event) => {
                      event.stopPropagation();
                      setDraggedWidget(null);
                      setWidgetDropTarget(null);
                    }}
                    className={`rounded-lg border p-2 transition-all ${
                      isDragged
                        ? 'border-starmade-accent/50 bg-starmade-accent/10 opacity-60 shadow-[0_0_0_1px_rgba(34,123,134,0.25)]'
                        : 'border-white/10 bg-black/15 hover:border-white/20'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {renderDragHandle(`Drag ${widgetLabel}`)}
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{widgetLabel}</p>
                      </div>
                      <button
                        onClick={() => removeWidgetToHidden(widgetId, group.id)}
                        className="rounded border border-white/15 bg-black/30 px-2 py-0.5 text-xs text-gray-300 hover:bg-black/45"
                      >
                        Remove
                      </button>
                    </div>
                    {renderWidgetBody(widgetId)}
                  </div>
                ) : (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{widgetLabel}</p>
                    {renderWidgetBody(widgetId)}
                  </div>
                )}
                {renderDropZone(group.id, index + 1)}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {isCollapsed && (
        <div className="rounded-md border border-white/10 bg-black/15 px-3 py-2 text-xs text-gray-500">
          Group collapsed. Expand to view widgets.
        </div>
      )}

      {isLayoutEditMode && !isCollapsed && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] uppercase tracking-wider text-gray-500">
          <span>{Math.round(height)}px</span>
          <button
            onMouseDown={(event) => beginGroupResize(group.id, event)}
            className="rounded border border-white/15 bg-black/30 px-2 py-1 font-semibold text-gray-300 hover:bg-black/45"
          >
            Resize Height
          </button>
        </div>
      )}
    </div>
  );
  };

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

        <div className="relative rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Dashboard Layout</h3>
              <p className="mt-1 text-xs text-gray-500">
                {isLayoutEditMode
                  ? 'Drag groups/widgets/actions, rename groups, and pin quick actions while edit mode is enabled.'
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
            <button
              onClick={() => setAllGroupsCollapsed(true)}
              className="rounded border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-200 transition-colors hover:bg-black/45"
            >
              Collapse All
            </button>
            <button
              onClick={() => setAllGroupsCollapsed(false)}
              className="rounded border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-200 transition-colors hover:bg-black/45"
            >
              Expand All
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
                <button
                  onClick={() => setIsActionCatalogOpen((prev) => !prev)}
                  className={`rounded border px-2 py-1 text-sm font-semibold transition-colors ${
                    isActionCatalogOpen
                      ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white hover:bg-starmade-accent/30'
                      : 'border-white/15 bg-black/30 text-gray-200 hover:bg-black/45'
                  }`}
                >
                  {isActionCatalogOpen ? 'Hide Actions' : 'Add Actions'}
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
              <p className="mt-2 text-xs text-gray-500">Tip: drag groups to reorder columns, and drag widgets to move them between groups.</p>
            </>
          )}

          {isLayoutEditMode && isActionCatalogOpen && (
            <div className="pointer-events-auto absolute right-3 top-[calc(100%+0.5rem)] z-30 w-[min(56rem,calc(100vw-7rem))] rounded-lg border border-white/15 bg-black/90 p-3 shadow-2xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Action Catalog</h4>
                <p className="text-xs text-gray-500">Drag an action card into Server Controls to pin it on the dashboard.</p>
              </div>
              <div className="max-h-[50vh] overflow-y-auto pr-1">
                {renderActionGrid(serverActions, {
                  showQuickToggle: true,
                  allowCatalogDrag: true,
                  emptyMessage: 'No actions available.',
                })}
              </div>
            </div>
          )}
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto pr-1 ${
            usesDefaultGrid
              ? 'grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]'
              : 'grid grid-cols-1 gap-4 xl:grid-cols-2'
          }`}
        >
          {dashboardLayout.groups.map((group, index) => (
            <React.Fragment key={group.id}>
              {renderGroupDropZone(index)}
              {renderDashboardGroup(group)}
            </React.Fragment>
          ))}
          {renderGroupDropZone(dashboardLayout.groups.length)}
        </div>
      </div>
    );
  };

  const renderLogs = () => (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-bold uppercase tracking-wider text-white">Server Logs</h3>
            <p className="text-sm text-gray-400">{effectiveServerName}{logPath ? ` - ${logPath}` : ''}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={selectAllLogFilters}
                className={`rounded px-3 py-1 capitalize transition-colors ${
                  areAllLogFiltersEnabled ? 'bg-starmade-accent text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                all
              </button>
              {LOG_FILTER_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => toggleLogFilter(option)}
                  className={`rounded px-3 py-1 capitalize transition-colors ${
                    activeLogFilters.includes(option) ? 'bg-starmade-accent text-white' : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
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

        <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">Log Categories</p>
            <button
              onClick={() => { void reloadLogCatalog(); }}
              disabled={isLogListLoading}
              className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLogListLoading ? 'Refreshing...' : 'Refresh List'}
            </button>
          </div>

          {logCategories.length === 0 ? (
            <p className="text-sm text-gray-400">{isLogListLoading ? 'Scanning logs folder...' : 'No log files found in logs/.'}</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {logCategories.map((category) => {
                  const isSelectedCategory = selectedLogCategoryId === category.id;
                  return (
                    <div key={category.id} className="inline-flex items-center gap-1">
                      <button
                        onClick={() => {
                          const remembered = selectedLogPathByCategoryId[category.id];
                          const rememberedInCategory = category.files.find((file) => file.relativePath === remembered);
                          const next = rememberedInCategory?.relativePath ?? category.files[0]?.relativePath ?? null;
                          setSelectedLogRelativePath(next);
                        }}
                        className={`rounded border px-2 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                          isSelectedCategory
                            ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white'
                            : 'border-white/15 bg-black/30 text-gray-300 hover:bg-black/45'
                        }`}
                      >
                        {category.label} ({category.files.length})
                      </button>
                      <button
                        onClick={() => handleClearCategoryLogs(category.id)}
                        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300 hover:bg-black/45"
                        title={`Clear ${category.label} view`}
                      >
                        Clear
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {selectedLogCategory ? `${selectedLogCategory.label} Files` : 'Files'}
                </span>
                {selectedLogCategoryFiles.map((file) => {
                  const isActiveFile = selectedLogRelativePath === file.relativePath;
                  return (
                    <button
                      key={file.relativePath}
                      onClick={() => {
                        setSelectedLogRelativePath(file.relativePath);
                        if (selectedLogCategoryId) {
                          setSelectedLogPathByCategoryId((prev) => ({
                            ...prev,
                            [selectedLogCategoryId]: file.relativePath,
                          }));
                        }
                      }}
                      className={`rounded border px-2 py-1 text-xs font-semibold transition-colors ${
                        isActiveFile
                          ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white'
                          : 'border-white/15 bg-black/30 text-gray-300 hover:bg-black/45'
                      }`}
                    >
                      {file.fileName}
                    </button>
                  );
                })}
              </div>

              {selectedLogRelativePath && (() => {
                const selectedFile = selectedLogCategoryFiles.find((file) => file.relativePath === selectedLogRelativePath)
                  ?? logCategories.flatMap((category) => category.files).find((file) => file.relativePath === selectedLogRelativePath);

                if (!selectedFile) return null;

                return (
                  <p className="mt-2 text-xs text-gray-400">
                    {selectedFile.fileName} - {formatLogFileSize(selectedFile.sizeBytes)} - modified {formatLogModifiedTime(selectedFile.modifiedMs)}
                  </p>
                );
              })()}
            </>
          )}

          {logLoadError && (
            <p className="mt-2 text-sm text-red-300">{logLoadError}</p>
          )}
        </div>
      </div>

      <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 font-mono text-sm">
        {isLogFileLoading ? (
          <p className="text-gray-400">Loading log file...</p>
        ) : (
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
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-4 py-3">
        <p className="text-sm text-gray-400">
          {filteredLogs.length} / {LOG_BUFFER_CAP} buffered log entries
          {isLogFileTruncated ? ' (tail view)' : ''}
        </p>
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

  const renderServerCfgConfiguration = () => {
    const model: ConfigPanelModel = {
      title: 'Server Configuration',
      subtitle: 'Values are read from and written to server.cfg in this installation.',
      loadingText: 'Loading configuration from server.cfg...',
      searchPlaceholder: 'Search key, label, or description',
      emptyMessage: 'No configuration keys match the current search/filter.',
      categoryOrder: CONFIG_CATEGORY_ORDER,
      categoryLabels: CONFIG_CATEGORY_LABELS,
      fields: configFields.map((field) => ({
        id: field.key,
        keyDisplay: field.key,
        label: field.label,
        description: field.description,
        category: field.category,
        type: field.type,
        defaultValue: field.defaultValue,
        min: field.min,
        max: field.max,
        guidance: field.guidance,
      })),
      values: serverConfigValues,
      setValues: setServerConfigValues,
      searchTerm: configSearchTerm,
      setSearchTerm: setConfigSearchTerm,
      categoryFilter: configCategoryFilter,
      setCategoryFilter: setConfigCategoryFilter,
      isLoading: isConfigLoading,
      savingFieldId: savingConfigKey,
      hasUnsavedChanges: false,
      error: null,
      onSaveField: async (id, explicitValue) => {
        const field = configFields.find((f) => f.key === id);
        if (field) await saveConfigField(field, explicitValue);
      },
      onValidateField: (id, rawValue) => {
        const field = configFields.find((f) => f.key === id);
        return field ? getConfigFieldValidation(field, rawValue) : { error: null, warning: null };
      },
    };
    return <ConfigPanel model={model} />;
  };

  const renderGameConfigXmlConfiguration = () => {
    const hasUnsavedChanges = Object.keys(gameConfigValues).some(
      (path) => gameConfigValues[path] !== (gameConfigSavedValues[path] ?? ''),
    );
    const needle = gameConfigSearchTerm.trim().toLowerCase();

    const filteredGameConfigListSections = gameConfigListSections
      .filter((section) => {
        if (gameConfigCategoryFilter.size > 0 && !gameConfigCategoryFilter.has(section.category)) return false;
        if (!needle) return true;
        if (section.key.toLowerCase().includes(needle) || section.label.toLowerCase().includes(needle)) return true;
        return section.columns.some((column) => column.label.toLowerCase().includes(needle) || column.key.toLowerCase().includes(needle));
      })
      .map((section) => {
        if (!needle) return section;
        const rows = section.rows.filter((row) => section.columns.some((column) => {
          const path = row.fieldPaths[column.key];
          const value = (gameConfigValues[path] ?? gameConfigSavedValues[path] ?? '').toLowerCase();
          return value.includes(needle) || path.toLowerCase().includes(needle);
        }));
        return { ...section, rows };
      })
      .filter((section) => section.rows.length > 0);

    const bodyExtras = (
      <section className="space-y-3">
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={showAdvancedGameConfigLists}
            onChange={(event) => setShowAdvancedGameConfigLists(event.target.checked)}
            className="h-4 w-4 rounded"
          />
          Show advanced repeated entry tables (e.g. StartingGear blocks/tools)
        </label>

        {showAdvancedGameConfigLists && (
          filteredGameConfigListSections.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/15 bg-black/20 px-3 py-4 text-sm text-gray-400">
              No repeated entry tables match the current search/filter.
            </p>
          ) : (
            <div className="space-y-4">
              {filteredGameConfigListSections.map((section) => (
                <div key={section.key} className="rounded-md border border-white/10 bg-black/20 p-3">
                  <div className="mb-2">
                    <p className="text-sm font-semibold text-white">{section.label}</p>
                    <p className="text-xs text-gray-400">{section.description}</p>
                    <p className="mt-1 text-[11px] font-mono text-gray-500">{section.key}</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border-b border-white/10 px-2 py-2 text-left text-xs uppercase tracking-wider text-gray-400">#</th>
                          {section.columns.map((column) => (
                            <th key={`${section.key}-${column.key}`} className="border-b border-white/10 px-2 py-2 text-left text-xs uppercase tracking-wider text-gray-400">
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row) => (
                          <tr key={`${section.key}-row-${row.index}`}>
                            <td className="border-b border-white/5 px-2 py-2 align-top text-xs text-gray-500">{row.index}</td>
                            {section.columns.map((column) => {
                              const fieldPath = row.fieldPaths[column.key];
                              const rawValue = gameConfigValues[fieldPath] ?? '';
                              const pseudoField: GameConfigField = {
                                path: fieldPath,
                                label: `${section.label} ${column.label}`,
                                description: `${section.key} row ${row.index}`,
                                category: section.category,
                                type: column.type,
                                defaultValue: gameConfigSavedValues[fieldPath] ?? rawValue,
                              };
                              const validation = getGameConfigFieldValidation(pseudoField, rawValue);
                              const isSavingThisField = savingGameConfigPath === fieldPath;

                              return (
                                <td key={fieldPath} className="border-b border-white/5 px-2 py-2 align-top">
                                  <div className="flex min-w-[180px] items-center gap-2">
                                    {column.type === 'boolean' ? (
                                      <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                                        <input
                                          type="checkbox"
                                          checked={parseCfgBoolean(rawValue, false)}
                                          onChange={(event) => {
                                            const next = String(event.target.checked);
                                            setGameConfigValues((prev) => ({ ...prev, [fieldPath]: next }));
                                            void saveGameConfigField(pseudoField, next);
                                          }}
                                          disabled={!!savingGameConfigPath || !!validation.error}
                                          className="h-4 w-4 rounded"
                                        />
                                        Enabled
                                      </label>
                                    ) : (
                                      <>
                                        <input
                                          type={column.type === 'number' ? 'number' : 'text'}
                                          value={rawValue}
                                          onChange={(event) => {
                                            const next = event.target.value;
                                            setGameConfigValues((prev) => ({ ...prev, [fieldPath]: next }));
                                          }}
                                          onBlur={() => { void saveGameConfigField(pseudoField); }}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              event.preventDefault();
                                              void saveGameConfigField(pseudoField);
                                            }
                                          }}
                                          disabled={!!savingGameConfigPath}
                                          className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-gray-200"
                                        />
                                        <button
                                          onClick={() => { void saveGameConfigField(pseudoField); }}
                                          disabled={!!savingGameConfigPath || !!validation.error}
                                          className="rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          {isSavingThisField ? 'Saving...' : 'Save'}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                  {(validation.error || validation.warning) && (
                                    <p className={`mt-1 text-[10px] ${validation.error ? 'text-red-300' : 'text-amber-300'}`}>
                                      {validation.error ?? validation.warning}
                                    </p>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </section>
    );

    const model: ConfigPanelModel = {
      title: 'GameConfig.xml',
      subtitle: 'Edit game settings using typed fields and save each value directly to GameConfig.xml.',
      loadingText: 'Loading GameConfig.xml...',
      searchPlaceholder: 'Search GameConfig fields...',
      emptyMessage: 'No GameConfig fields match the current search/filter.',
      categoryOrder: GAME_CONFIG_CATEGORY_ORDER,
      categoryLabels: GAME_CONFIG_CATEGORY_LABELS,
      fields: gameConfigFields.map((field) => ({
        id: field.path,
        keyDisplay: field.path,
        label: field.label,
        description: field.description,
        category: field.category,
        type: field.type,
        defaultValue: field.defaultValue,
        min: field.min,
        max: field.max,
        guidance: field.guidance,
      })),
      values: gameConfigValues,
      setValues: setGameConfigValues,
      searchTerm: gameConfigSearchTerm,
      setSearchTerm: setGameConfigSearchTerm,
      categoryFilter: gameConfigCategoryFilter,
      setCategoryFilter: setGameConfigCategoryFilter,
      isLoading: isGameConfigLoading,
      savingFieldId: savingGameConfigPath,
      hasUnsavedChanges,
      error: gameConfigError,
      onSaveField: async (id, explicitValue) => {
        const field = gameConfigFields.find((f) => f.path === id);
        if (field) await saveGameConfigField(field, explicitValue);
      },
      onValidateField: (id, rawValue) => {
        const field = gameConfigFields.find((f) => f.path === id);
        return field ? getGameConfigFieldValidation(field, rawValue) : { error: null, warning: null };
      },
      reloadLabel: 'Reload',
      onReload: reloadGameConfigXml,
      reloadDisabled: !effectiveServer || !hasGameApi || isGameConfigLoading || !!savingGameConfigPath,
      bodyExtras,
    };

    return <ConfigPanel model={model} />;
  };

  const renderConfiguration = () => (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveConfigTab('server-cfg')}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeConfigTab === 'server-cfg'
                ? 'border-starmade-accent bg-starmade-accent/20 text-white'
                : 'border-white/15 bg-black/25 text-gray-300 hover:bg-black/40'
            }`}
          >
            server.cfg
          </button>
          <button
            onClick={() => setActiveConfigTab('game-config-xml')}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeConfigTab === 'game-config-xml'
                ? 'border-starmade-accent bg-starmade-accent/20 text-white'
                : 'border-white/15 bg-black/25 text-gray-300 hover:bg-black/40'
            }`}
          >
            GameConfig.xml
          </button>
        </div>
      </div>

      {activeConfigTab === 'server-cfg' ? renderServerCfgConfiguration() : renderGameConfigXmlConfiguration()}
    </div>
  );

  const renderFileTree = (relativeDir: string, depth = 0): React.ReactNode => {
    const entries = fileEntriesByDir[relativeDir] ?? [];
    if (entries.length === 0) {
      return depth === 0 ? <p className="px-2 py-1 text-xs text-gray-500">No files found.</p> : null;
    }

    return entries.map((entry) => {
      const isDirExpanded = expandedFileDirs.includes(entry.relativePath);
      const isTabOpen = openFileTabs.includes(entry.relativePath);

      if (entry.isDirectory) {
        return (
          <div key={entry.relativePath}>
            <button
              onClick={() => toggleFileDirectory(entry.relativePath)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-gray-200 hover:bg-white/5"
              style={{ paddingLeft: `${8 + (depth * 14)}px` }}
            >
              <span className="w-3 text-xs text-gray-400">{isDirExpanded ? 'v' : '>'}</span>
              <span className="font-semibold text-gray-300">{entry.name}/</span>
            </button>
            {isDirExpanded && (
              <div>{renderFileTree(entry.relativePath, depth + 1)}</div>
            )}
          </div>
        );
      }

      return (
        <button
          key={entry.relativePath}
          onClick={() => { void openFileInTab(entry.relativePath); }}
          className={`flex w-full items-center rounded px-2 py-1 text-left text-sm transition-colors ${
            activeFileTabPath === entry.relativePath
              ? 'bg-starmade-accent/20 text-white'
              : 'text-gray-300 hover:bg-white/5'
          }`}
          style={{ paddingLeft: `${22 + (depth * 14)}px` }}
        >
          <span className="truncate">{entry.name}</span>
          {isTabOpen && <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">Open</span>}
        </button>
      );
    });
  };

  const renderFilesTab = () => (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 xl:grid-cols-[320px_1fr]">
      <div className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-black/20">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-200">Server Files</h3>
            <p className="text-xs text-gray-500">Browse and open files from this server install.</p>
          </div>
          <button
            onClick={() => { void loadFileDirectory(''); }}
            disabled={isFileBrowserLoading || !effectiveServer}
            className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFileBrowserLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {renderFileTree('')}
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-black/20">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-200">Manual File Editor</h3>
            <p className="text-xs text-gray-500">Use Configuration tab for structured editing, or edit raw files here.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void reloadActiveFileTab(); }}
              disabled={!activeFileTabPath || isFileEditorLoading || isFileSaving}
              className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reload
            </button>
            <button
              onClick={() => { void saveActiveFileTab(); }}
              disabled={!activeFileTabPath || isFileEditorLoading || isFileSaving || !activeFileTabHasUnsavedChanges}
              className="rounded bg-starmade-accent px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white hover:bg-starmade-accent/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFileSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="border-b border-white/10 px-2 py-1">
          <div className="flex flex-wrap items-center gap-1">
            {openFileTabs.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-500">Open a file from the browser to begin editing.</p>
            ) : (
              openFileTabs.map((tabPath) => {
                const tabFileName = tabPath.split('/').pop() || tabPath;
                const tabHasUnsavedChanges = (fileContentByPath[tabPath] ?? '') !== (savedFileContentByPath[tabPath] ?? '');
                const isActive = activeFileTabPath === tabPath;

                return (
                  <div key={tabPath} className={`inline-flex items-center rounded border ${
                    isActive
                      ? 'border-starmade-accent/40 bg-starmade-accent/20'
                      : 'border-white/15 bg-black/25'
                  }`}>
                    <button
                      onClick={() => setActiveFileTabPath(tabPath)}
                      className="px-2 py-1 text-xs text-gray-200"
                    >
                      {tabFileName}{tabHasUnsavedChanges ? ' *' : ''}
                    </button>
                    <button
                      onClick={() => closeFileTab(tabPath)}
                      className="px-2 py-1 text-xs text-gray-400 hover:text-white"
                      title="Close tab"
                    >
                      x
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {fileTabError && (
          <div className="border-b border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-300">
            {fileTabError}
          </div>
        )}

        <div className="min-h-0 flex-1 p-3">
          {!activeFileTabPath ? (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-white/15 bg-black/20 p-6 text-center text-sm text-gray-400">
              Open a file from the left pane. For guided settings, use the Configuration tab.
            </div>
          ) : isFileEditorLoading ? (
            <p className="text-sm text-gray-400">Loading {activeFileTabPath}...</p>
          ) : (
            <textarea
              value={activeFileTabContent}
              onChange={(event) => {
                const next = event.target.value;
                setFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: next }));
              }}
              spellCheck={false}
              className="h-full w-full resize-none rounded-md border border-white/15 bg-black/40 p-3 font-mono text-xs leading-5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
            />
          )}
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
    if (activeTab === 'configuration') return renderConfiguration();
    if (activeTab === 'files') return renderFilesTab();
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

