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

type ServerPanelTab = 'control' | 'actions' | 'logs' | 'configuration' | 'files' | 'database';
const CONFIG_EDITOR_TABS = [
  { id: 'server-cfg', label: 'server.cfg' },
  { id: 'game-config-xml', label: 'GameConfig.xml' },
  { id: 'faction-config-xml', label: 'FactionConfig.xml' },
] as const;

type ConfigEditorTab = (typeof CONFIG_EDITOR_TABS)[number]['id'];
type LogFilter = 'errors' | 'warnings' | 'info' | 'debug';
type DashboardWidgetId = 'status' | 'serverInfo' | 'connection' | 'players' | 'controls';
type ServerActionId = 'start' | 'stop' | 'restart' | 'update';
const DASHBOARD_CONFIG_CONTROL_KEYS = [
  'MAX_CLIENTS',
  'SERVER_LISTEN_IP',
  'ANNOUNCE_SERVER_TO_SERVERLIST',
  'USE_STARMADE_AUTHENTICATION',
  'REQUIRE_STARMADE_AUTHENTICATION',
  'USE_WHITELIST',
  'SERVER_LIST_NAME',
  'SERVER_LIST_DESCRIPTION',
  'HOST_NAME_TO_ANNOUNCE_TO_SERVER_LIST',
] as const;
type DashboardConfigControlKey = (typeof DASHBOARD_CONFIG_CONTROL_KEYS)[number];

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
  isEditableText: boolean;
  nonEditableReason?: string;
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
  quickConfigKeys: DashboardConfigControlKey[];
}

interface DraggedWidget {
  widgetId: DashboardWidgetId;
  sourceGroupId: string;
}

interface DraggedQuickAction {
  actionId: ServerActionId;
}

const LOG_BUFFER_CAP = 30000;
const DASHBOARD_STORE_KEY = 'serverPanelDashboardLayoutsV2';
const MIN_GROUP_HEIGHT = 260;
const MAX_GROUP_HEIGHT = 1200;
const FACTION_CONFIG_PATH_CANDIDATES = [
  'customFactionConfig/FactionConfigTemplate.xml',
  'config/customConfigTemplate/FactionConfigTemplate.xml',
  'FactionConfigTemplate.xml',
] as const;

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
  { id: 'actions', label: 'Actions' },
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
  quickConfigKeys: ['MAX_CLIENTS', 'SERVER_LISTEN_IP', 'ANNOUNCE_SERVER_TO_SERVERLIST'],
});

const isServerActionId = (value: unknown): value is ServerActionId => (
  value === 'start' ||
  value === 'stop' ||
  value === 'restart' ||
  value === 'update'
);

const isDashboardConfigControlKey = (value: unknown): value is DashboardConfigControlKey => (
  typeof value === 'string' && DASHBOARD_CONFIG_CONTROL_KEYS.includes(value as DashboardConfigControlKey)
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
  quickConfigKeys: [...layout.quickConfigKeys],
});

const normalizeLayout = (raw: unknown): DashboardLayout => {
  const fallback = createDefaultDashboardLayout();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;

  const root = raw as { groups?: unknown; hiddenWidgetIds?: unknown; quickActionIds?: unknown; quickConfigKeys?: unknown };
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

  const quickConfigKeys: DashboardConfigControlKey[] = [];
  if (Array.isArray(root.quickConfigKeys)) {
    for (const configKey of root.quickConfigKeys) {
      if (isDashboardConfigControlKey(configKey) && !quickConfigKeys.includes(configKey)) {
        quickConfigKeys.push(configKey);
      }
    }
  }

  return {
    groups,
    hiddenWidgetIds,
    quickActionIds: quickActionIds.length > 0 ? quickActionIds : fallback.quickActionIds,
    quickConfigKeys,
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

interface ConfigSchemaValidation {
  integer?: boolean;
  regex?: string;
  message?: string;
  allowedValues?: string[];
  minLength?: number;
  maxLength?: number;
}

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
  validation?: ConfigSchemaValidation;
}

interface ServerConfigEntry {
  key: string;
  value: string;
  comment: string | null;
}

type ConfigFieldValidation = import('../../common/ConfigPanel').ConfigFieldValidation;

type GameConfigFieldType = 'string' | 'number' | 'boolean';
type GameConfigCategory = 'economy' | 'environment' | 'limits';
type FactionConfigCategory = 'activity' | 'system-bonus' | 'points';

interface GameConfigFieldMeta {
  label: string;
  description: string;
  category: GameConfigCategory;
  type?: GameConfigFieldType;
  min?: number;
  max?: number;
  guidance?: string;
  validation?: ConfigSchemaValidation;
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
  validation?: ConfigSchemaValidation;
}

interface FactionConfigFieldMeta {
  label: string;
  description: string;
  category: FactionConfigCategory;
  type?: GameConfigFieldType;
  min?: number;
  max?: number;
  guidance?: string;
  validation?: ConfigSchemaValidation;
}

interface FactionConfigField {
  path: string;
  label: string;
  description: string;
  category: FactionConfigCategory;
  type: GameConfigFieldType;
  defaultValue: string;
  min?: number;
  max?: number;
  guidance?: string;
  validation?: ConfigSchemaValidation;
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

interface GameConfigCommentToggleEntry {
  id: string;
  label: string;
  description: string;
  path: string;
  category: GameConfigCategory;
  snippet: string;
}

interface GameConfigCategoryRule {
  category: GameConfigCategory;
  startsWith?: string;
  includes?: string;
}

interface FactionConfigCategoryRule {
  category: FactionConfigCategory;
  startsWith?: string;
  includes?: string;
}

interface ServerPanelSchema {
  version: number;
  serverConfig?: {
    categoryLabels?: Record<string, string>;
    categoryOrder?: string[];
    fields?: ServerConfigField[];
  };
  gameConfig?: {
    categoryLabels?: Record<string, string>;
    categoryOrder?: string[];
    fieldMeta?: Record<string, GameConfigFieldMeta>;
    commentToggleEntries?: GameConfigCommentToggleEntry[];
    hiddenPathPrefixes?: string[];
    categoryRules?: GameConfigCategoryRule[];
  };
  factionConfig?: {
    categoryLabels?: Record<string, string>;
    categoryOrder?: string[];
    fieldMeta?: Record<string, FactionConfigFieldMeta>;
    hiddenPathPrefixes?: string[];
    categoryRules?: FactionConfigCategoryRule[];
  };
}

const GAME_CONFIG_CATEGORY_LABELS: Record<GameConfigCategory, string> = {
  economy: 'Economy',
  environment: 'Environment',
  limits: 'Limits',
};

const GAME_CONFIG_CATEGORY_ORDER: GameConfigCategory[] = ['economy', 'environment', 'limits'];

const FACTION_CONFIG_CATEGORY_LABELS: Record<FactionConfigCategory, string> = {
  activity: 'Activity',
  'system-bonus': 'System Bonus',
  points: 'Faction Points',
};

const FACTION_CONFIG_CATEGORY_ORDER: FactionConfigCategory[] = ['activity', 'system-bonus', 'points'];

const FACTION_CONFIG_FIELD_META: Record<string, FactionConfigFieldMeta> = {
  'Faction/FactionActivity/BasicValues/SetInactiveAfterHours': {
    label: 'Inactive Timeout (Hours)',
    description: 'Time after which factions become inactive when offline.',
    category: 'activity',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Inactive timeout must be a whole number.' },
  },
  'Faction/FactionActivity/BasicValues/SetActiveAfterOnlineForMin': {
    label: 'Reactivate After Minutes Online',
    description: 'Minutes online needed to set a faction active again.',
    category: 'activity',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Reactivate time must be a whole number.' },
  },
};

const FACTION_CONFIG_HIDDEN_PATH_PREFIXES: string[] = [];

const FACTION_CONFIG_CATEGORY_RULES: FactionConfigCategoryRule[] = [
  { category: 'activity', includes: 'activity' },
  { category: 'system-bonus', includes: 'ownerbonus' },
  { category: 'points', includes: 'factionpoint' },
];

const GAME_CONFIG_FIELD_META: Record<string, GameConfigFieldMeta> = {
  'GameConfig/StartingGear/Credits': {
    label: 'Starting Credits',
    description: 'Credits granted to a new character on spawn.',
    category: 'economy',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Starting credits must be a whole number.' },
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
  'GameConfig/MaxDimensionShip/X': {
    label: 'Max Ship X',
    description: 'Maximum ship dimension on the X axis.',
    category: 'limits',
    type: 'number',
    validation: { integer: true, message: 'Ship dimensions must be whole numbers.' },
  },
  'GameConfig/MaxDimensionShip/Y': {
    label: 'Max Ship Y',
    description: 'Maximum ship dimension on the Y axis.',
    category: 'limits',
    type: 'number',
    validation: { integer: true, message: 'Ship dimensions must be whole numbers.' },
  },
  'GameConfig/MaxDimensionShip/Z': {
    label: 'Max Ship Z',
    description: 'Maximum ship dimension on the Z axis.',
    category: 'limits',
    type: 'number',
    validation: { integer: true, message: 'Ship dimensions must be whole numbers.' },
  },
  'GameConfig/MaxDimensionStation/X': {
    label: 'Max Station X',
    description: 'Maximum station dimension on the X axis.',
    category: 'limits',
    type: 'number',
    validation: { integer: true, message: 'Station dimensions must be whole numbers.' },
  },
  'GameConfig/MaxDimensionStation/Y': {
    label: 'Max Station Y',
    description: 'Maximum station dimension on the Y axis.',
    category: 'limits',
    type: 'number',
    validation: { integer: true, message: 'Station dimensions must be whole numbers.' },
  },
  'GameConfig/MaxDimensionStation/Z': {
    label: 'Max Station Z',
    description: 'Maximum station dimension on the Z axis.',
    category: 'limits',
    type: 'number',
    validation: { integer: true, message: 'Station dimensions must be whole numbers.' },
  },
  'GameConfig/GroupLimits/Controller[]/ID': {
    label: 'Controller ID',
    description: 'Controller block ID used for group/computer limits.',
    category: 'limits',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Controller IDs must be whole numbers.' },
  },
  'GameConfig/GroupLimits/Controller[]/GroupMax': {
    label: 'Group Max',
    description: 'Maximum simultaneous groups for this controller.',
    category: 'limits',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Group max must be a whole number.' },
  },
  'GameConfig/GroupLimits/Controller[]/ComputerMax': {
    label: 'Computer Max',
    description: 'Maximum number of computers allowed for this controller.',
    category: 'limits',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Computer max must be a whole number.' },
  },
  'GameConfig/ShipLimits/Mass': {
    label: 'Ship Mass Limit',
    description: 'Maximum ship mass allowed.',
    category: 'limits',
    type: 'number',
    min: 0,
  },
  'GameConfig/ShipLimits/Blocks': {
    label: 'Ship Block Limit',
    description: 'Maximum ship block count allowed.',
    category: 'limits',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Block limits must be whole numbers.' },
  },
  'GameConfig/PlanetLimits/Mass': {
    label: 'Planet Mass Limit',
    description: 'Maximum planet mass allowed.',
    category: 'limits',
    type: 'number',
    min: 0,
  },
  'GameConfig/PlanetLimits/Blocks': {
    label: 'Planet Block Limit',
    description: 'Maximum planet block count allowed.',
    category: 'limits',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Block limits must be whole numbers.' },
  },
  'GameConfig/StationLimits/Mass': {
    label: 'Station Mass Limit',
    description: 'Maximum station mass allowed.',
    category: 'limits',
    type: 'number',
    min: 0,
  },
  'GameConfig/StationLimits/Blocks': {
    label: 'Station Block Limit',
    description: 'Maximum station block count allowed.',
    category: 'limits',
    type: 'number',
    min: 0,
    validation: { integer: true, message: 'Block limits must be whole numbers.' },
  },
};

const GAME_CONFIG_COMMENT_TOGGLE_DEFAULTS: GameConfigCommentToggleEntry[] = [
  {
    id: 'group-limits',
    label: 'Enable Group Limits',
    description: 'Adds GroupLimits controller caps to GameConfig.xml.',
    path: 'GameConfig/GroupLimits',
    category: 'limits',
    snippet: '<GroupLimits>\n    <Controller>\n      <ID>4</ID>\n      <GroupMax>30</GroupMax>\n    </Controller>\n    <Controller>\n      <ID>544</ID>\n      <ComputerMax>2</ComputerMax>\n    </Controller>\n  </GroupLimits>',
  },
  {
    id: 'max-dimension-ship',
    label: 'Enable MaxDimensionShip',
    description: 'Adds MaxDimensionShip size limits.',
    path: 'GameConfig/MaxDimensionShip',
    category: 'limits',
    snippet: '<MaxDimensionShip>\n    <X>100</X>\n    <Y>400</Y>\n    <Z>-1</Z>\n  </MaxDimensionShip>',
  },
  {
    id: 'max-dimension-station',
    label: 'Enable MaxDimensionStation',
    description: 'Adds MaxDimensionStation size limits.',
    path: 'GameConfig/MaxDimensionStation',
    category: 'limits',
    snippet: '<MaxDimensionStation>\n    <X>600</X>\n    <Y>800</Y>\n    <Z>1000</Z>\n  </MaxDimensionStation>',
  },
  {
    id: 'ship-limits',
    label: 'Enable ShipLimits',
    description: 'Adds ship mass/block limits.',
    path: 'GameConfig/ShipLimits',
    category: 'limits',
    snippet: '<ShipLimits>\n    <Mass>1000.0</Mass>\n    <Blocks>100</Blocks>\n  </ShipLimits>',
  },
  {
    id: 'planet-limits',
    label: 'Enable PlanetLimits',
    description: 'Adds planet mass/block limits.',
    path: 'GameConfig/PlanetLimits',
    category: 'limits',
    snippet: '<PlanetLimits>\n    <Mass>50000.0</Mass>\n    <Blocks>2000000</Blocks>\n  </PlanetLimits>',
  },
  {
    id: 'station-limits',
    label: 'Enable StationLimits',
    description: 'Adds station mass/block limits.',
    path: 'GameConfig/StationLimits',
    category: 'limits',
    snippet: '<StationLimits>\n    <Mass>5000.0</Mass>\n    <Blocks>500</Blocks>\n  </StationLimits>',
  },
];

const GAME_CONFIG_HIDDEN_PATH_PREFIXES = [
  'GameConfig/StartingGear/Block',
  'GameConfig/StartingGear/Tool',
  'GameConfig/StartingGear/Helmet',
  'GameConfig/StartingGear/Flashlight',
  'GameConfig/StartingGear/Logbook',
  'GameConfig/StartingGear/Blueprint',
  'GameConfig/StartingGear/BuildInhibiter',
];

const GAME_CONFIG_CATEGORY_RULES: GameConfigCategoryRule[] = [
  { category: 'economy', startsWith: 'GameConfig/StartingGear' },
  { category: 'environment', includes: 'sun' },
  { category: 'environment', includes: 'heat' },
  { category: 'limits', includes: 'limit' },
  { category: 'limits', includes: 'maxdimension' },
];

const isServerPanelSchema = (value: unknown): value is ServerPanelSchema => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

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

const shouldHideGameConfigPath = (path: string, hiddenPrefixes: string[]): boolean => (
  hiddenPrefixes.some((prefix) => path.startsWith(prefix))
);

const getGameConfigMetaForPath = (
  fieldMetaByPath: Record<string, GameConfigFieldMeta>,
  path: string,
): GameConfigFieldMeta | undefined => {
  const direct = fieldMetaByPath[path];
  if (direct) return direct;
  const wildcardPath = path.replace(/\[\d+\]/g, '[]');
  return fieldMetaByPath[wildcardPath];
};

const getFactionConfigMetaForPath = (
  fieldMetaByPath: Record<string, FactionConfigFieldMeta>,
  path: string,
): FactionConfigFieldMeta | undefined => {
  const direct = fieldMetaByPath[path];
  if (direct) return direct;
  const wildcardPath = path.replace(/\[\d+\]/g, '[]');
  return fieldMetaByPath[wildcardPath];
};

const runSchemaValidation = (
  validation: ConfigSchemaValidation | undefined,
  rawValue: string,
  fieldType: ServerConfigFieldType | GameConfigFieldType,
): ConfigFieldValidation | null => {
  if (!validation) return null;

  const trimmed = rawValue.trim();

  if (fieldType === 'number' && validation.integer && !/^-?\d+$/.test(trimmed)) {
    return { error: validation.message ?? 'Enter a whole number.', warning: null };
  }

  if (validation.minLength !== undefined && trimmed.length < validation.minLength) {
    return { error: validation.message ?? `Value must be at least ${validation.minLength} characters.`, warning: null };
  }

  if (validation.maxLength !== undefined && trimmed.length > validation.maxLength) {
    return { error: validation.message ?? `Value must be at most ${validation.maxLength} characters.`, warning: null };
  }

  if (validation.allowedValues && validation.allowedValues.length > 0 && !validation.allowedValues.includes(trimmed)) {
    return { error: validation.message ?? `Value must be one of: ${validation.allowedValues.join(', ')}.`, warning: null };
  }

  if (validation.regex) {
    try {
      const regex = new RegExp(validation.regex);
      if (!regex.test(trimmed)) {
        return { error: validation.message ?? 'Value does not match the expected format.', warning: null };
      }
    } catch {
      // Ignore malformed schema regex values to keep editing functional.
    }
  }

  return null;
};

const inferGameConfigCategory = (path: string, rules: GameConfigCategoryRule[]): GameConfigCategory => {
  const lowerPath = path.toLowerCase();
  for (const rule of rules) {
    if (rule.startsWith && path.startsWith(rule.startsWith)) return rule.category;
    if (rule.includes && lowerPath.includes(rule.includes.toLowerCase())) return rule.category;
  }
  return null
};

const inferFactionConfigCategory = (path: string, rules: FactionConfigCategoryRule[]): FactionConfigCategory => {
  const lowerPath = path.toLowerCase();
  for (const rule of rules) {
    if (rule.startsWith && path.startsWith(rule.startsWith)) return rule.category;
    if (rule.includes && lowerPath.includes(rule.includes.toLowerCase())) return rule.category;
  }
  return null
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

const getGameConfigCommentToggleStates = (
  xmlContent: string,
  entries: GameConfigCommentToggleEntry[],
): Record<string, boolean> => {
  const states: Record<string, boolean> = {};
  try {
    const doc = parseGameConfigXmlDocument(xmlContent);
    for (const entry of entries) {
      states[entry.id] = !!findElementByGameConfigPath(doc, entry.path);
    }
  } catch {
    for (const entry of entries) {
      states[entry.id] = false;
    }
  }
  return states;
};

const createElementFromSnippet = (doc: Document, snippet: string, expectedTag: string): Element | null => {
  const parser = new DOMParser();
  const wrapped = `<root>${snippet}</root>`;
  const parsed = parser.parseFromString(wrapped, 'application/xml');
  const parseError = parsed.querySelector('parsererror');
  if (parseError) return null;

  const element = Array.from(parsed.documentElement.children).find((child) => child.tagName === expectedTag);
  if (!element) return null;
  return doc.importNode(element, true);
};

const uncommentGameConfigEntryFromComments = (
  doc: Document,
  root: Element,
  tagName: string,
): boolean => {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType !== Node.COMMENT_NODE) continue;
    const commentText = node.nodeValue ?? '';
    if (!commentText.includes(`<${tagName}`) || !commentText.includes(`</${tagName}>`)) continue;

    const parser = new DOMParser();
    const wrapped = `<root>${commentText}</root>`;
    const parsed = parser.parseFromString(wrapped, 'application/xml');
    const parseError = parsed.querySelector('parsererror');
    if (parseError) continue;

    const candidate = Array.from(parsed.documentElement.children).find((child) => child.tagName === tagName);
    if (!candidate) continue;

    const imported = doc.importNode(candidate, true);
    root.replaceChild(imported, node);
    return true;
  }

  return false;
};

const hasOnlyLeafChildren = (element: Element): boolean => {
  const children = Array.from(element.children);
  if (children.length === 0) return false;
  return children.every((child) => child.children.length === 0);
};

const extractGameConfigListSections = (
  xmlContent: string,
  categoryOrder: GameConfigCategory[],
  categoryRules: GameConfigCategoryRule[],
): GameConfigListSection[] => {
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
          category: inferGameConfigCategory(sectionKey, categoryRules),
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
    const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.label.localeCompare(b.label);
  });
};

const extractGameConfigFields = (
  xmlContent: string,
  fieldMetaByPath: Record<string, GameConfigFieldMeta>,
  categoryOrder: GameConfigCategory[],
  hiddenPrefixes: string[],
  categoryRules: GameConfigCategoryRule[],
): { fields: GameConfigField[]; values: Record<string, string> } => {
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

      if (shouldHideGameConfigPath(path, hiddenPrefixes)) return;

      const explicitMeta = getGameConfigMetaForPath(fieldMetaByPath, path);
      const inferredType = parseGameConfigFieldType(rawValue);
      const type = explicitMeta?.type ?? inferredType;

      fields.push({
        path,
        label: explicitMeta?.label ?? humanizeGameConfigSegment(path.split('/').pop() ?? path),
        description: explicitMeta?.description ?? `GameConfig path: ${path}`,
        category: explicitMeta?.category ?? inferGameConfigCategory(path, categoryRules),
        type,
        defaultValue: rawValue,
        min: explicitMeta?.min,
        max: explicitMeta?.max,
        guidance: explicitMeta?.guidance,
        validation: explicitMeta?.validation,
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
    const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.label.localeCompare(b.label);
  });

  return { fields, values };
};

const extractFactionConfigFields = (
  xmlContent: string,
  fieldMetaByPath: Record<string, FactionConfigFieldMeta>,
  categoryOrder: FactionConfigCategory[],
  hiddenPrefixes: string[],
  categoryRules: FactionConfigCategoryRule[],
): { fields: FactionConfigField[]; values: Record<string, string> } => {
  const doc = parseGameConfigXmlDocument(xmlContent);
  const root = doc.documentElement;
  if (!root) return { fields: [], values: {} };

  const values: Record<string, string> = {};
  const fields: FactionConfigField[] = [];

  const walk = (element: Element, parentPath: string) => {
    const childElements = Array.from(element.children);
    if (childElements.length === 0) {
      const path = parentPath;
      const rawValue = (element.textContent ?? '').trim();
      values[path] = rawValue;

      if (shouldHideGameConfigPath(path, hiddenPrefixes)) return;

      const explicitMeta = getFactionConfigMetaForPath(fieldMetaByPath, path);
      const inferredType = parseGameConfigFieldType(rawValue);
      const type = explicitMeta?.type ?? inferredType;

      fields.push({
        path,
        label: explicitMeta?.label ?? humanizeGameConfigSegment(path.split('/').pop() ?? path),
        description: explicitMeta?.description ?? `FactionConfig path: ${path}`,
        category: explicitMeta?.category ?? inferFactionConfigCategory(path, categoryRules),
        type,
        defaultValue: rawValue,
        min: explicitMeta?.min,
        max: explicitMeta?.max,
        guidance: explicitMeta?.guidance,
        validation: explicitMeta?.validation,
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
    const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
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

  const schemaValidation = runSchemaValidation(field.validation, trimmed, field.type);
  if (schemaValidation) {
    return schemaValidation;
  }

  if (field.type === 'string' && !trimmed) {
    return { error: null, warning: 'Empty value may be rejected by the game parser.' };
  }

  return { error: null, warning: null };
};

const getFactionConfigFieldValidation = (field: FactionConfigField, rawValue: string): ConfigFieldValidation => {
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
  }

  const schemaValidation = runSchemaValidation(field.validation, trimmed, field.type);
  if (schemaValidation) return schemaValidation;

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
    validation: { integer: true, message: 'Max players must be a whole number.' },
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
    validation: { integer: true, message: 'Autosave interval must be a whole number.' },
  },
  {
    key: 'THRUST_SPEED_LIMIT',
    label: 'Thrust Speed Limit',
    description: 'Maximum ship speed in m/s.',
    category: 'performance',
    type: 'number',
    defaultValue: '75',
    min: 0,
    validation: { integer: true, message: 'Thrust speed limit must be a whole number.' },
  },
  {
    key: 'SOCKET_BUFFER_SIZE',
    label: 'Socket Buffer Size',
    description: 'Incoming/outgoing socket buffer size in bytes.',
    category: 'networking',
    type: 'number',
    defaultValue: '65536',
    min: 1024,
    validation: { integer: true, message: 'Socket buffer size must be a whole number.' },
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
    validation: { integer: true, message: 'Spam protection window must be a whole number.' },
  },
  {
    key: 'NT_SPAM_PROTECT_MAX_ATTEMPTS',
    label: 'Spam Protect Max Attempts',
    description: 'Maximum connection attempts allowed per window.',
    category: 'security',
    type: 'number',
    defaultValue: '30',
    min: 0,
    validation: { integer: true, message: 'Spam protection attempts must be a whole number.' },
  },
  {
    key: 'SECTOR_INACTIVE_TIMEOUT',
    label: 'Sector Inactive Timeout (sec)',
    description: 'Time before sectors go inactive (-1 disables).',
    category: 'performance',
    type: 'number',
    defaultValue: '20',
    min: -1,
    validation: { integer: true, message: 'Sector timeout must be a whole number.' },
  },
  {
    key: 'SECTOR_INACTIVE_CLEANUP_TIMEOUT',
    label: 'Sector Cleanup Timeout (sec)',
    description: 'Time before inactive sectors are removed from memory (-1 disables).',
    category: 'performance',
    type: 'number',
    defaultValue: '10',
    min: -1,
    validation: { integer: true, message: 'Sector cleanup timeout must be a whole number.' },
  },
  {
    key: 'MAX_SIMULTANEOUS_EXPLOSIONS',
    label: 'Max Simultaneous Explosions',
    description: 'Threaded explosion concurrency cap.',
    category: 'performance',
    type: 'number',
    defaultValue: '10',
    min: 1,
    validation: { integer: true, message: 'Explosion concurrency must be a whole number.' },
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
    validation: { integer: true, message: 'Chunk pool size must be a whole number.' },
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
    validation: { integer: true, message: 'CPU chunk pool size must be a whole number.' },
  },
];

const SERVER_CONFIG_DEFAULTS: Record<string, string> = Object.fromEntries(
  SERVER_CONFIG_FIELDS.map((field) => [field.key, field.defaultValue]),
);

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

  const schemaValidation = runSchemaValidation(field.validation, trimmed, field.type);
  if (schemaValidation) {
    return schemaValidation;
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
  const [isLogWrapEnabled, setIsLogWrapEnabled] = useState(true);
  const [isFileWrapEnabled, setIsFileWrapEnabled] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lifecycleState, setLifecycleState] = useState<ServerLifecycleState>('stopped');
  const [runtimePid, setRuntimePid] = useState<number | undefined>(undefined);
  const [runtimeUptimeMs, setRuntimeUptimeMs] = useState<number | undefined>(undefined);
  const [serverNameInput, setServerNameInput] = useState<string>('');
  const [isSavingServerName, setIsSavingServerName] = useState(false);
  const [serverPortInput, setServerPortInput] = useState<string>('4242');
  const [isSavingServerPort, setIsSavingServerPort] = useState(false);
  const [serverConfigSchemaFields, setServerConfigSchemaFields] = useState<ServerConfigField[]>(SERVER_CONFIG_FIELDS);
  const [serverConfigCategoryLabels, setServerConfigCategoryLabels] = useState<Record<string, string>>(CONFIG_CATEGORY_LABELS);
  const [serverConfigCategoryOrder, setServerConfigCategoryOrder] = useState<string[]>(CONFIG_CATEGORY_ORDER);
  const [gameConfigFieldMetaByPath, setGameConfigFieldMetaByPath] = useState<Record<string, GameConfigFieldMeta>>(GAME_CONFIG_FIELD_META);
  const [gameConfigCategoryLabels, setGameConfigCategoryLabels] = useState<Record<string, string>>(GAME_CONFIG_CATEGORY_LABELS);
  const [gameConfigCategoryOrder, setGameConfigCategoryOrder] = useState<GameConfigCategory[]>(GAME_CONFIG_CATEGORY_ORDER);
  const [gameConfigCommentToggleEntries, setGameConfigCommentToggleEntries] = useState<GameConfigCommentToggleEntry[]>(GAME_CONFIG_COMMENT_TOGGLE_DEFAULTS);
  const [gameConfigHiddenPathPrefixes, setGameConfigHiddenPathPrefixes] = useState<string[]>(GAME_CONFIG_HIDDEN_PATH_PREFIXES);
  const [gameConfigCategoryRules, setGameConfigCategoryRules] = useState<GameConfigCategoryRule[]>(GAME_CONFIG_CATEGORY_RULES);
  const [factionConfigFieldMetaByPath, setFactionConfigFieldMetaByPath] = useState<Record<string, FactionConfigFieldMeta>>(FACTION_CONFIG_FIELD_META);
  const [factionConfigCategoryLabels, setFactionConfigCategoryLabels] = useState<Record<string, string>>(FACTION_CONFIG_CATEGORY_LABELS);
  const [factionConfigCategoryOrder, setFactionConfigCategoryOrder] = useState<FactionConfigCategory[]>(FACTION_CONFIG_CATEGORY_ORDER);
  const [factionConfigHiddenPathPrefixes, setFactionConfigHiddenPathPrefixes] = useState<string[]>(FACTION_CONFIG_HIDDEN_PATH_PREFIXES);
  const [factionConfigCategoryRules, setFactionConfigCategoryRules] = useState<FactionConfigCategoryRule[]>(FACTION_CONFIG_CATEGORY_RULES);
  const [savingGameConfigToggleId, setSavingGameConfigToggleId] = useState<string | null>(null);
  const [gameConfigCommentToggleStates, setGameConfigCommentToggleStates] = useState<Record<string, boolean>>({});
  const [gameConfigToggleExpanded, setGameConfigToggleExpanded] = useState<Record<string, boolean>>({});
  const [factionConfigXmlText, setFactionConfigXmlText] = useState('');
  const [factionConfigFields, setFactionConfigFields] = useState<FactionConfigField[]>([]);
  const [factionConfigValues, setFactionConfigValues] = useState<Record<string, string>>({});
  const [factionConfigSavedValues, setFactionConfigSavedValues] = useState<Record<string, string>>({});
  const [factionConfigSearchTerm, setFactionConfigSearchTerm] = useState('');
  const [factionConfigCategoryFilter, setFactionConfigCategoryFilter] = useState<Set<string>>(new Set());
  const [factionConfigLoadedServerId, setFactionConfigLoadedServerId] = useState<string | null>(null);
  const [isFactionConfigLoading, setIsFactionConfigLoading] = useState(false);
  const [savingFactionConfigPath, setSavingFactionConfigPath] = useState<string | null>(null);
  const [factionConfigError, setFactionConfigError] = useState<string | null>(null);
  const [factionConfigRelativePath, setFactionConfigRelativePath] = useState<string>(FACTION_CONFIG_PATH_CANDIDATES[0]);
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
  const [gameConfigLoadedServerId, setGameConfigLoadedServerId] = useState<string | null>(null);
  const [isGameConfigLoading, setIsGameConfigLoading] = useState(false);
  const [savingGameConfigPath, setSavingGameConfigPath] = useState<string | null>(null);
  const [gameConfigError, setGameConfigError] = useState<string | null>(null);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logCategories, setLogCategories] = useState<LogCategory[]>([]);
  const [selectedLogRelativePath, setSelectedLogRelativePath] = useState<string | null>(null);
  const [isLogListLoading, setIsLogListLoading] = useState(false);
  const [isLogFileLoading, setIsLogFileLoading] = useState(false);
  const [isLogFileTruncated, setIsLogFileTruncated] = useState(false);
  const [logLoadError, setLogLoadError] = useState<string | null>(null);
  const [isClearingLogFiles, setIsClearingLogFiles] = useState(false);
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
  const [fileTabErrorPath, setFileTabErrorPath] = useState<string | null>(null);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(createDefaultDashboardLayout);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [isLayoutEditMode, setIsLayoutEditMode] = useState(false);
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
  const isPoppedOutPanel = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('panelMode') === 'popout';

  const serverConfigDefaults = useMemo<Record<string, string>>(
    () => Object.fromEntries(serverConfigSchemaFields.map((field) => [field.key, field.defaultValue])),
    [serverConfigSchemaFields],
  );

  const serverConfigFieldKeys = useMemo(
    () => new Set(serverConfigSchemaFields.map((field) => field.key)),
    [serverConfigSchemaFields],
  );

  const serverDownloadStatus = effectiveServer ? downloadStatuses[effectiveServer.id] : undefined;
  const isUpdating = serverDownloadStatus?.state === 'checksums' || serverDownloadStatus?.state === 'downloading';

  const allLogFiles = useMemo(() => {
    return logCategories
      .flatMap((category) => category.files)
      .map((file, index) => ({ file, index }))
      .sort((a, b) => {
        if (b.file.modifiedMs !== a.file.modifiedMs) {
          return b.file.modifiedMs - a.file.modifiedMs;
        }
        if (a.file.relativePath !== b.file.relativePath) {
          return a.file.relativePath.localeCompare(b.file.relativePath);
        }
        return a.index - b.index;
      })
      .map(({ file }) => file);
  }, [logCategories]);

  const selectedLogFile = useMemo(() => {
    if (!selectedLogRelativePath) return null;
    return allLogFiles.find((file) => file.relativePath === selectedLogRelativePath) ?? null;
  }, [allLogFiles, selectedLogRelativePath]);

  const selectedLogRelativePathRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLogRelativePathRef.current = selectedLogRelativePath;
  }, [selectedLogRelativePath]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.launcher?.app?.getServerPanelSchema) return;

    let cancelled = false;

    const loadSchema = async () => {
      try {
        const raw = await window.launcher.app.getServerPanelSchema();
        if (cancelled || !isServerPanelSchema(raw)) return;

        const serverFields = Array.isArray(raw.serverConfig?.fields) && raw.serverConfig?.fields.length > 0
          ? raw.serverConfig.fields
          : SERVER_CONFIG_FIELDS;
        const serverLabels = raw.serverConfig?.categoryLabels && typeof raw.serverConfig.categoryLabels === 'object'
          ? raw.serverConfig.categoryLabels
          : CONFIG_CATEGORY_LABELS;
        const serverOrder = Array.isArray(raw.serverConfig?.categoryOrder) && raw.serverConfig.categoryOrder.length > 0
          ? raw.serverConfig.categoryOrder
          : CONFIG_CATEGORY_ORDER;

        const gameMeta = raw.gameConfig?.fieldMeta && typeof raw.gameConfig.fieldMeta === 'object'
          ? raw.gameConfig.fieldMeta
          : GAME_CONFIG_FIELD_META;
        const gameLabels = raw.gameConfig?.categoryLabels && typeof raw.gameConfig.categoryLabels === 'object'
          ? raw.gameConfig.categoryLabels
          : GAME_CONFIG_CATEGORY_LABELS;
        const parsedGameOrder = Array.isArray(raw.gameConfig?.categoryOrder)
          ? raw.gameConfig.categoryOrder.filter((entry): entry is GameConfigCategory => (
            entry === 'economy' || entry === 'environment' || entry === 'limits' || entry === 'other'
          ))
          : [];
        const gameOrder = parsedGameOrder.length > 0 ? parsedGameOrder : GAME_CONFIG_CATEGORY_ORDER;
        const toggleEntries = Array.isArray(raw.gameConfig?.commentToggleEntries) && raw.gameConfig.commentToggleEntries.length > 0
          ? raw.gameConfig.commentToggleEntries
          : GAME_CONFIG_COMMENT_TOGGLE_DEFAULTS;
        const hiddenPrefixes = Array.isArray(raw.gameConfig?.hiddenPathPrefixes)
          ? raw.gameConfig.hiddenPathPrefixes.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const categoryRules = Array.isArray(raw.gameConfig?.categoryRules)
          ? raw.gameConfig.categoryRules.filter((entry): entry is GameConfigCategoryRule => (
            !!entry
            && typeof entry === 'object'
            && !Array.isArray(entry)
            && (entry.category === 'economy' || entry.category === 'environment' || entry.category === 'limits' || entry.category === 'other')
            && (typeof entry.startsWith === 'string' || typeof entry.includes === 'string')
          ))
          : [];
        const factionMeta = raw.factionConfig?.fieldMeta && typeof raw.factionConfig.fieldMeta === 'object'
          ? raw.factionConfig.fieldMeta
          : FACTION_CONFIG_FIELD_META;
        const factionLabels = raw.factionConfig?.categoryLabels && typeof raw.factionConfig.categoryLabels === 'object'
          ? raw.factionConfig.categoryLabels
          : FACTION_CONFIG_CATEGORY_LABELS;
        const parsedFactionOrder = Array.isArray(raw.factionConfig?.categoryOrder)
          ? raw.factionConfig.categoryOrder.filter((entry): entry is FactionConfigCategory => (
            entry === 'activity' || entry === 'system-bonus' || entry === 'points' || entry === 'other'
          ))
          : [];
        const factionOrder = parsedFactionOrder.length > 0 ? parsedFactionOrder : FACTION_CONFIG_CATEGORY_ORDER;
        const factionHiddenPrefixes = Array.isArray(raw.factionConfig?.hiddenPathPrefixes)
          ? raw.factionConfig.hiddenPathPrefixes.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const factionCategoryRules = Array.isArray(raw.factionConfig?.categoryRules)
          ? raw.factionConfig.categoryRules.filter((entry): entry is FactionConfigCategoryRule => (
            !!entry
            && typeof entry === 'object'
            && !Array.isArray(entry)
            && (entry.category === 'activity' || entry.category === 'system-bonus' || entry.category === 'points' || entry.category === 'other')
            && (typeof entry.startsWith === 'string' || typeof entry.includes === 'string')
          ))
          : [];

        setServerConfigSchemaFields(serverFields);
        setServerConfigCategoryLabels(serverLabels);
        setServerConfigCategoryOrder(serverOrder);
        setGameConfigFieldMetaByPath(gameMeta);
        setGameConfigCategoryLabels(gameLabels);
        setGameConfigCategoryOrder(gameOrder);
        setGameConfigCommentToggleEntries(toggleEntries);
        setGameConfigHiddenPathPrefixes(hiddenPrefixes.length > 0 ? hiddenPrefixes : GAME_CONFIG_HIDDEN_PATH_PREFIXES);
        setGameConfigCategoryRules(categoryRules.length > 0 ? categoryRules : GAME_CONFIG_CATEGORY_RULES);
        setFactionConfigFieldMetaByPath(factionMeta);
        setFactionConfigCategoryLabels(factionLabels);
        setFactionConfigCategoryOrder(factionOrder);
        setFactionConfigHiddenPathPrefixes(factionHiddenPrefixes.length > 0 ? factionHiddenPrefixes : FACTION_CONFIG_HIDDEN_PATH_PREFIXES);
        setFactionConfigCategoryRules(factionCategoryRules.length > 0 ? factionCategoryRules : FACTION_CONFIG_CATEGORY_RULES);
      } catch (error) {
        console.warn('[ServerPanel] Failed to load server panel schema:', error);
      }
    };

    void loadSchema();

    return () => {
      cancelled = true;
    };
  }, []);

  const reloadLogCatalog = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) {
      setLogCategories([]);
      setSelectedLogRelativePath(null);
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
    setIsLogFileTruncated(false);
    setLogLoadError(null);
    setIsClearingLogFiles(false);
    setActiveConfigTab('server-cfg');
    setGameConfigXmlText('');
    setGameConfigFields([]);
    setGameConfigListSections([]);
    setGameConfigValues({});
    setGameConfigSavedValues({});
    setGameConfigSearchTerm('');
    setGameConfigCategoryFilter(new Set());
    setGameConfigCommentToggleStates({});
    setGameConfigToggleExpanded({});
    setSavingGameConfigToggleId(null);
    setGameConfigLoadedServerId(null);
    setSavingGameConfigPath(null);
    setGameConfigError(null);
    setFactionConfigXmlText('');
    setFactionConfigFields([]);
    setFactionConfigValues({});
    setFactionConfigSavedValues({});
    setFactionConfigSearchTerm('');
    setFactionConfigCategoryFilter(new Set());
    setFactionConfigLoadedServerId(null);
    setSavingFactionConfigPath(null);
    setFactionConfigError(null);
    setFactionConfigRelativePath(FACTION_CONFIG_PATH_CANDIDATES[0]);
    setFileEntriesByDir({});
    setExpandedFileDirs(['']);
    setOpenFileTabs([]);
    setActiveFileTabPath(null);
    setFileContentByPath({});
    setSavedFileContentByPath({});
    setFileTabError(null);
    setServerNameInput(effectiveServer?.name ?? '');
    setServerPortInput(effectiveServer?.port?.trim() || '4242');
  }, [effectiveServer?.id]);

  const readFactionConfigXmlFromInstallation = useCallback(async (): Promise<{ content: string; relativePath: string; error?: string }> => {
    if (!effectiveServer || !hasGameApi) {
      return { content: '', relativePath: FACTION_CONFIG_PATH_CANDIDATES[0], error: 'Server context unavailable.' };
    }

    let firstError: string | undefined;
    for (const relativePath of FACTION_CONFIG_PATH_CANDIDATES) {
      const payload = await window.launcher.game.readInstallationFile(effectiveServer.path, relativePath);
      if (!payload.error) {
        return { content: payload.content ?? '', relativePath };
      }
      if (!firstError) firstError = payload.error;
    }

    return {
      content: '',
      relativePath: FACTION_CONFIG_PATH_CANDIDATES[0],
      error: firstError ?? `Could not find faction config template (${FACTION_CONFIG_PATH_CANDIDATES.join(' or ')}).`,
    };
  }, [effectiveServer, hasGameApi]);

  const writeFactionConfigXmlToInstallation = useCallback(async (content: string): Promise<{ success: boolean; relativePath?: string; error?: string }> => {
    if (!effectiveServer || !hasGameApi) {
      return { success: false, error: 'Server context unavailable.' };
    }

    const uniqueCandidates = [
      factionConfigRelativePath,
      ...FACTION_CONFIG_PATH_CANDIDATES.filter((path) => path !== factionConfigRelativePath),
    ];

    let firstError: string | undefined;
    for (const relativePath of uniqueCandidates) {
      const result = await window.launcher.game.writeInstallationFile(effectiveServer.path, relativePath, content);
      if (result.success) {
        return { success: true, relativePath };
      }
      if (!firstError) firstError = result.error;
    }

    return {
      success: false,
      error: firstError ?? `Could not write faction config template (${FACTION_CONFIG_PATH_CANDIDATES.join(' or ')}).`,
    };
  }, [effectiveServer, factionConfigRelativePath, hasGameApi]);

  useEffect(() => {
    void reloadLogCatalog();
  }, [reloadLogCatalog]);

  const reloadServerConfigValues = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) {
      setConfigFields(serverConfigSchemaFields);
      setServerConfigValues(serverConfigDefaults);
      return;
    }

    setIsConfigLoading(true);
    try {
      const cfgEntries: ServerConfigEntry[] = await window.launcher.game.listServerConfigValues(effectiveServer.path);

      const discoveredFields: ServerConfigField[] = cfgEntries
        .filter((entry) => !serverConfigFieldKeys.has(entry.key))
        .map((entry) => ({
          key: entry.key,
          label: humanizeServerConfigKey(entry.key),
          description: entry.comment || 'Discovered key from server.cfg.',
          category: 'advanced' as ServerConfigCategory,
          type: inferServerConfigFieldType(entry.value),
          defaultValue: entry.value,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

      const nextFields = [...serverConfigSchemaFields, ...discoveredFields];
      const valueMap: Record<string, string> = Object.fromEntries(nextFields.map((field) => [field.key, field.defaultValue]));
      for (const entry of cfgEntries) {
        valueMap[entry.key] = entry.value;
      }

      setConfigFields(nextFields);
      setServerConfigValues(valueMap);
    } catch (error) {
      console.warn('[ServerPanel] Failed to load configuration values from server.cfg:', error);
      setConfigFields(serverConfigSchemaFields);
      setServerConfigValues(serverConfigDefaults);
    } finally {
      setIsConfigLoading(false);
    }
  }, [
    effectiveServer,
    hasGameApi,
    serverConfigDefaults,
    serverConfigFieldKeys,
    serverConfigSchemaFields,
  ]);

  useEffect(() => {
    void reloadServerConfigValues();
  }, [reloadServerConfigValues]);

  const hydrateGameConfigState = useCallback((xmlContent: string, options?: { keepDrafts?: boolean }) => {
    const parsed = extractGameConfigFields(
      xmlContent,
      gameConfigFieldMetaByPath,
      gameConfigCategoryOrder,
      gameConfigHiddenPathPrefixes,
      gameConfigCategoryRules,
    );
    const listSections = extractGameConfigListSections(xmlContent, gameConfigCategoryOrder, gameConfigCategoryRules);
    const toggleStates = getGameConfigCommentToggleStates(xmlContent, gameConfigCommentToggleEntries);
    setGameConfigXmlText(xmlContent);
    setGameConfigFields(parsed.fields);
    setGameConfigListSections(listSections);
    setGameConfigValues((prev) => (options?.keepDrafts ? { ...parsed.values, ...prev } : parsed.values));
    setGameConfigSavedValues(parsed.values);
    setGameConfigCommentToggleStates(toggleStates);
  }, [
    gameConfigCategoryOrder,
    gameConfigCategoryRules,
    gameConfigCommentToggleEntries,
    gameConfigFieldMetaByPath,
    gameConfigHiddenPathPrefixes,
  ]);

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

  const hydrateFactionConfigState = useCallback((xmlContent: string, options?: { keepDrafts?: boolean }) => {
    const parsed = extractFactionConfigFields(
      xmlContent,
      factionConfigFieldMetaByPath,
      factionConfigCategoryOrder,
      factionConfigHiddenPathPrefixes,
      factionConfigCategoryRules,
    );
    setFactionConfigXmlText(xmlContent);
    setFactionConfigFields(parsed.fields);
    setFactionConfigValues((prev) => (options?.keepDrafts ? { ...parsed.values, ...prev } : parsed.values));
    setFactionConfigSavedValues(parsed.values);
  }, [
    factionConfigCategoryOrder,
    factionConfigCategoryRules,
    factionConfigFieldMetaByPath,
    factionConfigHiddenPathPrefixes,
  ]);

  useEffect(() => {
    if (activeConfigTab !== 'faction-config-xml') return;
    if (!effectiveServer || !hasGameApi) return;
    if (factionConfigLoadedServerId === effectiveServer.id) return;

    let cancelled = false;
    setIsFactionConfigLoading(true);
    setFactionConfigError(null);

    const loadFactionConfigXml = async () => {
      try {
        const payload = await readFactionConfigXmlFromInstallation();
        if (cancelled) return;

        if (payload.error) {
          setFactionConfigError(`Failed to load faction config template: ${payload.error}`);
          setFactionConfigFields([]);
          setFactionConfigValues({});
          setFactionConfigSavedValues({});
          return;
        }

        const next = payload.content ?? '';
        hydrateFactionConfigState(next);
        setFactionConfigRelativePath(payload.relativePath);
        setFactionConfigLoadedServerId(effectiveServer.id);
      } catch (error) {
        if (cancelled) return;
        setFactionConfigError(`Failed to load faction config template: ${String(error)}`);
        setFactionConfigFields([]);
        setFactionConfigValues({});
        setFactionConfigSavedValues({});
      } finally {
        if (!cancelled) setIsFactionConfigLoading(false);
      }
    };

    void loadFactionConfigXml();

    return () => {
      cancelled = true;
    };
  }, [
    activeConfigTab,
    effectiveServer,
    factionConfigLoadedServerId,
    hasGameApi,
    hydrateFactionConfigState,
    readFactionConfigXmlFromInstallation,
  ]);

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

  const openFileInTab = useCallback(async (entry: InstallationFileEntry) => {
    if (!effectiveServer || !hasGameApi) return;

    if (!entry.isEditableText) {
      const errorPath = entry.relativePath;
      setFileTabError(entry.nonEditableReason ?? `Cannot open ${errorPath}: binary files are not supported in the editor.`);
      setFileTabErrorPath(errorPath);
      setOpenFileTabs((prev) => (prev.includes(errorPath) ? prev : [...prev, errorPath]));
      setActiveFileTabPath(errorPath);
      return;
    }

    const relativePath = entry.relativePath;

    setOpenFileTabs((prev) => (prev.includes(relativePath) ? prev : [...prev, relativePath]));
    setActiveFileTabPath(relativePath);

    if (relativePath in fileContentByPath) return;

    setIsFileEditorLoading(true);
    setFileTabError(null);
    setFileTabErrorPath(null);
    try {
      const payload = await window.launcher.game.readInstallationFile(effectiveServer.path, relativePath);
      if (payload.error) {
        setFileTabError(`Failed to open ${relativePath}: ${payload.error}`);
        setFileTabErrorPath(relativePath);
        return;
      }

      setFileContentByPath((prev) => ({ ...prev, [relativePath]: payload.content }));
      setSavedFileContentByPath((prev) => ({ ...prev, [relativePath]: payload.content }));
    } catch (error) {
      setFileTabError(`Failed to open ${relativePath}: ${String(error)}`);
      setFileTabErrorPath(relativePath);
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
    setFileTabErrorPath((current) => {
      if (current === relativePath) {
        setFileTabError(null);
        return null;
      }
      return current;
    });
  }, []);

  const reloadActiveFileTab = useCallback(async () => {
    if (!effectiveServer || !hasGameApi || !activeFileTabPath) return;

    setIsFileEditorLoading(true);
    setFileTabError(null);
    setFileTabErrorPath(null);
    try {
      const payload = await window.launcher.game.readInstallationFile(effectiveServer.path, activeFileTabPath);
      if (payload.error) {
        setFileTabError(`Failed to reload ${activeFileTabPath}: ${payload.error}`);
        setFileTabErrorPath(activeFileTabPath);
        return;
      }
      setFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: payload.content }));
      setSavedFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: payload.content }));
    } catch (error) {
      setFileTabError(`Failed to reload ${activeFileTabPath}: ${String(error)}`);
      setFileTabErrorPath(activeFileTabPath);
    } finally {
      setIsFileEditorLoading(false);
    }
  }, [activeFileTabPath, effectiveServer, hasGameApi]);

  const saveActiveFileTab = useCallback(async () => {
    if (!effectiveServer || !hasGameApi || !activeFileTabPath || isFileSaving) return;

    setIsFileSaving(true);
    setFileTabError(null);
    setFileTabErrorPath(null);
    try {
      const content = fileContentByPath[activeFileTabPath] ?? '';
      const result = await window.launcher.game.writeInstallationFile(effectiveServer.path, activeFileTabPath, content);
      if (!result.success) {
        setFileTabError(result.error ?? `Failed to save ${activeFileTabPath}.`);
        setFileTabErrorPath(activeFileTabPath);
        return;
      }

      setSavedFileContentByPath((prev) => ({ ...prev, [activeFileTabPath]: content }));
    } catch (error) {
      setFileTabError(`Failed to save ${activeFileTabPath}: ${String(error)}`);
      setFileTabErrorPath(activeFileTabPath);
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

  const quickConfigFields = useMemo(
    () => dashboardLayout.quickConfigKeys
      .map((configKey) => configFields.find((field) => field.key === configKey))
      .filter((field): field is ServerConfigField => !!field),
    [configFields, dashboardLayout.quickConfigKeys],
  );

  const updateQuickActions = useCallback((updater: (prev: ServerActionId[]) => ServerActionId[]) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      next.quickActionIds = updater(next.quickActionIds);
      return next;
    });
  }, []);

  const updateQuickConfigKeys = useCallback((updater: (prev: DashboardConfigControlKey[]) => DashboardConfigControlKey[]) => {
    setDashboardLayout((prev) => {
      const next = cloneLayout(prev);
      next.quickConfigKeys = updater(next.quickConfigKeys);
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

  const toggleQuickConfigKey = useCallback((configKey: DashboardConfigControlKey) => {
    updateQuickConfigKeys((prev) => (
      prev.includes(configKey)
        ? prev.filter((key) => key !== configKey)
        : [...prev, configKey]
    ));
  }, [updateQuickConfigKeys]);

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

  const handleClearLogs = useCallback(async () => {
    if (!effectiveServer || !hasGameApi || isClearingLogFiles) return;

    const confirmed = window.confirm('Are you sure you want to delete all files in this server\'s logs folder? This cannot be undone.');
    if (!confirmed) return;

    setIsClearingLogFiles(true);
    setLogLoadError(null);

    try {
      const result = await window.launcher.game.clearLogFiles(effectiveServer.path);
      if (!result.success) {
        setLogLoadError(result.error ?? 'Failed to clear logs folder.');
        return;
      }

      setLogs([]);
      setIsLogFileTruncated(false);
      setSelectedLogRelativePath(null);
      setLogPath(null);
      await reloadLogCatalog();
    } catch (error) {
      setLogLoadError(`Failed to clear logs folder: ${String(error)}`);
    } finally {
      setIsClearingLogFiles(false);
    }
  }, [effectiveServer, hasGameApi, isClearingLogFiles, reloadLogCatalog]);

  const handleClearBufferedLogs = useCallback(() => {
    setLogs([]);
    setIsLogFileTruncated(false);
  }, []);

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

  const handlePopOutServerPanel = useCallback(async () => {
    if (isPoppedOutPanel) return;
    if (typeof window === 'undefined' || !window.launcher?.window?.openServerPanel) return;

    const result = await window.launcher.window.openServerPanel(
      effectiveServer?.id ?? serverId,
      effectiveServer?.name ?? serverName ?? effectiveServerName,
    ).catch((error) => ({ success: false, error: String(error) }));

    if (!result.success) {
      setActionError(result.error ?? 'Failed to pop out server panel window.');
    } else {
      // Navigate the main window away from ServerPanel so it isn't duplicated
      navigate('Play');
    }
  }, [effectiveServer?.id, effectiveServer?.name, effectiveServerName, isPoppedOutPanel, navigate, serverId, serverName]);

  const handleDockServerPanel = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('starmade-launcher-navigation');
      channel.postMessage({
        type: 'open-server-panel',
        serverId: effectiveServer?.id ?? serverId,
        serverName: effectiveServer?.name ?? serverName ?? effectiveServerName,
      });
      channel.close();
    }

    window.launcher?.window?.close();
  }, [effectiveServer?.id, effectiveServer?.name, effectiveServerName, serverId, serverName]);

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

  const reloadFactionConfigXml = useCallback(async () => {
    if (!effectiveServer || !hasGameApi) return;

    setIsFactionConfigLoading(true);
    setFactionConfigError(null);
    try {
      const payload = await readFactionConfigXmlFromInstallation();
      if (payload.error) {
        setFactionConfigError(`Failed to reload faction config template: ${payload.error}`);
        return;
      }
      const next = payload.content ?? '';
      hydrateFactionConfigState(next);
      setFactionConfigRelativePath(payload.relativePath);
      setFactionConfigLoadedServerId(effectiveServer.id);
    } catch (error) {
      setFactionConfigError(`Failed to reload faction config template: ${String(error)}`);
    } finally {
      setIsFactionConfigLoading(false);
    }
  }, [effectiveServer, hasGameApi, hydrateFactionConfigState, readFactionConfigXmlFromInstallation]);

  const setGameConfigCommentToggle = useCallback(async (entry: GameConfigCommentToggleEntry, enabled: boolean) => {
    if (!effectiveServer || !hasGameApi || savingGameConfigPath || savingGameConfigToggleId) return;

    setSavingGameConfigToggleId(entry.id);
    setGameConfigError(null);

    try {
      const doc = parseGameConfigXmlDocument(gameConfigXmlText);
      const root = doc.documentElement;
      if (!root || root.tagName !== 'GameConfig') {
        throw new Error('GameConfig.xml root node is invalid.');
      }

      const target = findElementByGameConfigPath(doc, entry.path);
      const tagName = entry.path.split('/').pop();
      if (!tagName) {
        throw new Error(`Invalid toggle path: ${entry.path}`);
      }

      if (enabled) {
        if (!target) {
          const restoredFromComment = uncommentGameConfigEntryFromComments(doc, root, tagName);
          if (!restoredFromComment) {
            const created = createElementFromSnippet(doc, entry.snippet, tagName);
            if (!created) {
              throw new Error(`Invalid snippet for ${entry.label}.`);
            }
            root.appendChild(doc.createTextNode('\n\n  '));
            root.appendChild(created);
            root.appendChild(doc.createTextNode('\n'));
          }
        }
      } else if (target) {
        const serializedTarget = new XMLSerializer().serializeToString(target);
        const replacement = doc.createComment(`\n  ${serializedTarget}\n  `);
        target.parentNode?.replaceChild(replacement, target);
      }

      const serialized = new XMLSerializer().serializeToString(doc);
      const result = await window.launcher.game.writeGameConfigXml(effectiveServer.path, serialized);
      if (!result.success) {
        setGameConfigError(result.error ?? `Failed to update ${entry.label} in GameConfig.xml.`);
        return;
      }

      hydrateGameConfigState(serialized, { keepDrafts: true });
      setGameConfigLoadedServerId(effectiveServer.id);
    } catch (error) {
      setGameConfigError(`Failed to toggle ${entry.label}: ${String(error)}`);
    } finally {
      setSavingGameConfigToggleId(null);
    }
  }, [
    effectiveServer,
    gameConfigXmlText,
    hasGameApi,
    hydrateGameConfigState,
    savingGameConfigPath,
    savingGameConfigToggleId,
  ]);

  const saveGameConfigField = useCallback(async (field: GameConfigField, explicitValue?: string) => {
    if (!effectiveServer || !hasGameApi || savingGameConfigPath || savingGameConfigToggleId) return;

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
  }, [effectiveServer, gameConfigValues, gameConfigXmlText, hasGameApi, hydrateGameConfigState, savingGameConfigPath, savingGameConfigToggleId]);

  const saveFactionConfigField = useCallback(async (field: FactionConfigField, explicitValue?: string) => {
    if (!effectiveServer || !hasGameApi || savingFactionConfigPath) return;

    const currentRaw = explicitValue ?? factionConfigValues[field.path] ?? field.defaultValue;
    const validation = getFactionConfigFieldValidation(field, currentRaw);
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

    setSavingFactionConfigPath(field.path);
    setFactionConfigError(null);
    setFactionConfigValues((prev) => ({ ...prev, [field.path]: sanitized }));

    try {
      const doc = parseGameConfigXmlDocument(factionConfigXmlText);
      const target = findElementByGameConfigPath(doc, field.path);
      if (!target) {
        setFactionConfigError(`Could not locate ${field.path} in the faction config template.`);
        return;
      }

      target.textContent = sanitized;
      const serialized = new XMLSerializer().serializeToString(doc);
      const result = await writeFactionConfigXmlToInstallation(serialized);
      if (!result.success) {
        setFactionConfigError(result.error ?? `Failed to save ${field.label} to the faction config template.`);
        return;
      }

      if (result.relativePath) {
        setFactionConfigRelativePath(result.relativePath);
      }

      hydrateFactionConfigState(serialized, { keepDrafts: true });
      setFactionConfigLoadedServerId(effectiveServer.id);
    } catch (error) {
      setFactionConfigError(`Failed to save ${field.label}: ${String(error)}`);
    } finally {
      setSavingFactionConfigPath(null);
    }
  }, [
    effectiveServer,
    factionConfigValues,
    factionConfigXmlText,
    hasGameApi,
    hydrateFactionConfigState,
    savingFactionConfigPath,
    writeFactionConfigXmlToInstallation,
  ]);

  const persistServerName = useCallback(async () => {
    if (!effectiveServer || isSavingServerName) return;

    const sanitized = serverNameInput.trim() || effectiveServer.name;
    setServerNameInput(sanitized);
    if (sanitized === effectiveServer.name) return;

    setIsSavingServerName(true);
    setActionError(null);
    try {
      updateServerItem({ ...effectiveServer, name: sanitized });
    } catch (error) {
      setActionError(`Failed to save server name: ${String(error)}`);
      setServerNameInput(effectiveServer.name);
    } finally {
      setIsSavingServerName(false);
    }
  }, [effectiveServer, isSavingServerName, serverNameInput, updateServerItem]);

  const persistServerPort = useCallback(async () => {
    if (!effectiveServer || isSavingServerPort) return;

    const parsed = Number.parseInt(serverPortInput.trim() || '4242', 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      setActionError('Server port must be between 1 and 65535.');
      setServerPortInput(effectiveServer.port?.trim() || '4242');
      return;
    }

    const sanitized = String(parsed);
    setServerPortInput(sanitized);
    if (sanitized === (effectiveServer.port?.trim() || '4242')) return;

    setIsSavingServerPort(true);
    setActionError(null);
    try {
      updateServerItem({ ...effectiveServer, port: sanitized });
    } catch (error) {
      setActionError(`Failed to save server port: ${String(error)}`);
      setServerPortInput(effectiveServer.port?.trim() || '4242');
    } finally {
      setIsSavingServerPort(false);
    }
  }, [effectiveServer, isSavingServerPort, serverPortInput, updateServerItem]);

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
          if (effectiveServer && effectiveServer.maxPlayers !== parsed) {
            updateServerItem({ ...effectiveServer, maxPlayers: parsed });
          }
        }
      }

      if (field.key === 'SERVER_LISTEN_IP') {
        if (effectiveServer && effectiveServer.serverIp !== nextValue) {
          updateServerItem({ ...effectiveServer, serverIp: nextValue });
        }
      }

      if (field.key === 'USE_STARMADE_AUTHENTICATION') {
        const enabled = parseCfgBoolean(nextValue, false);
        if (!enabled) {
          setServerConfigValues((prev) => ({ ...prev, REQUIRE_STARMADE_AUTHENTICATION: 'false' }));
        }
      }
    } catch (error) {
      setActionError(`Failed to save ${field.key}: ${String(error)}`);
    } finally {
      setSavingConfigKey(null);
    }
  }, [effectiveServer, persistServerCfgValue, savingConfigKey, serverConfigValues, updateServerItem]);

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
      <PageContainer resizable>
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

  const getDashboardConfigField = (key: string): ServerConfigField | null => (
    configFields.find((field) => field.key === key) ?? null
  );

  const getDashboardConfigValue = (key: string): string => {
    const field = getDashboardConfigField(key);
    if (!field) return '';
    return serverConfigValues[key] ?? field.defaultValue;
  };

  const renderDashboardConfigField = (
    key: string,
    options?: { labelWidthClassName?: string; requireKey?: string; compact?: boolean },
  ) => {
    const field = getDashboardConfigField(key);
    if (!field) return null;

    const rawValue = getDashboardConfigValue(key);
    const validation = getConfigFieldValidation(field, rawValue);
    const isSavingThisField = savingConfigKey === field.key;
    const isRequirementMet = options?.requireKey
      ? parseCfgBoolean(getDashboardConfigValue(options.requireKey), false)
      : true;
    const isDisabled = !!savingConfigKey || !isRequirementMet;

    if (field.type === 'boolean') {
      return (
        <div key={field.key} className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={parseCfgBoolean(rawValue, field.defaultValue === 'true')}
              onChange={(event) => {
                const next = String(event.target.checked);
                setServerConfigValues((prev) => ({ ...prev, [field.key]: next }));
                void saveConfigField(field, next);
              }}
              disabled={isDisabled || !!validation.error}
              className="h-4 w-4 rounded"
            />
            <span>{options?.compact ? 'Enabled' : field.label}</span>
            {isSavingThisField && <span className="text-[10px] uppercase tracking-wider text-gray-500">Saving...</span>}
          </label>
          {(validation.error || validation.warning || !isRequirementMet) && (
            <p className={`text-[10px] ${validation.error ? 'text-red-300' : 'text-amber-300'}`}>
              {validation.error ?? validation.warning ?? `${field.label} requires ${getDashboardConfigField(options?.requireKey ?? '')?.label ?? options?.requireKey} to be enabled.`}
            </p>
          )}
        </div>
      );
    }

    if (options?.compact) {
      return (
        <div key={field.key} className="space-y-1">
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            min={field.type === 'number' && field.min !== undefined ? field.min : undefined}
            max={field.type === 'number' && field.max !== undefined ? field.max : undefined}
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
            className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
          {(validation.error || validation.warning) && (
            <p className={`text-[10px] ${validation.error ? 'text-red-300' : 'text-amber-300'}`}>
              {validation.error ?? validation.warning}
            </p>
          )}
        </div>
      );
    }

    return (
      <label key={field.key} className="flex items-start gap-3 text-sm">
        <span className={`${options?.labelWidthClassName ?? 'w-36'} pt-2 text-gray-300`}>{field.label}:</span>
        <div className="flex-1">
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            min={field.type === 'number' && field.min !== undefined ? field.min : undefined}
            max={field.type === 'number' && field.max !== undefined ? field.max : undefined}
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
            className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
          {(validation.error || validation.warning) && (
            <p className={`mt-1 text-[10px] ${validation.error ? 'text-red-300' : 'text-amber-300'}`}>
              {validation.error ?? validation.warning}
            </p>
          )}
        </div>
      </label>
    );
  };

  const renderServerInfoWidget = () => (
    <div className="space-y-3">
      {/*<label className="flex items-center gap-3 text-sm">
        <span className="w-36 text-gray-300">Server Name:</span>
        <input
          value={serverNameInput}
          onChange={(event) => setServerNameInput(event.target.value)}
          onBlur={() => { void persistServerName(); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void persistServerName();
            }
          }}
          disabled={isSavingServerName}
          className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
        />
      </label>*/}
      {renderDashboardConfigField('SERVER_LIST_NAME')}
      {renderDashboardConfigField('SERVER_LIST_DESCRIPTION')}
      {renderDashboardConfigField('HOST_NAME_TO_ANNOUNCE_TO_SERVER_LIST')}
      <label className="flex items-center gap-3 text-sm">
        <span className="w-36 text-gray-300">Install Path:</span>
        <input
          value={effectiveServer.path || 'Not configured'}
          readOnly
          className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
        />
      </label>
    </div>
  );

  const renderConnectionWidget = () => (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        {renderDashboardConfigField('SERVER_LISTEN_IP', { labelWidthClassName: 'w-28' })}
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 text-gray-300">Server Port:</span>
          <input
            value={serverPortInput}
            onChange={(event) => setServerPortInput(event.target.value)}
            onBlur={() => { void persistServerPort(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void persistServerPort();
              }
            }}
            disabled={isSavingServerPort}
            className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-gray-200"
          />
        </label>
        {renderDashboardConfigField('MAX_CLIENTS', { labelWidthClassName: 'w-28' })}
      </div>

      <div className="space-y-3 rounded-md border border-white/10 bg-black/20 p-3 text-sm text-gray-300">
        {renderDashboardConfigField('ANNOUNCE_SERVER_TO_SERVERLIST')}
        {renderDashboardConfigField('USE_STARMADE_AUTHENTICATION')}
        {renderDashboardConfigField('REQUIRE_STARMADE_AUTHENTICATION', { requireKey: 'USE_STARMADE_AUTHENTICATION' })}
        {renderDashboardConfigField('USE_WHITELIST')}
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

  const dashboardConfigCatalogFields = DASHBOARD_CONFIG_CONTROL_KEYS
    .map((configKey) => configFields.find((field) => field.key === configKey))
    .filter((field): field is ServerConfigField => !!field);

  const renderDashboardToggleButton = (isPinned: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        isPinned
          ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white hover:bg-starmade-accent/30'
          : 'border-white/15 bg-black/25 text-gray-300 hover:bg-black/40'
      }`}
    >
      {isPinned ? 'On Dashboard' : 'Add to Dashboard'}
    </button>
  );

  const renderActionGrid = (
    actions: ServerActionDefinition[],
    options?: { showDashboardToggle?: boolean; enableQuickDrag?: boolean; emptyMessage?: string },
  ) => {
    if (actions.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-white/15 bg-black/20 p-4 text-sm text-gray-400">
          {options?.emptyMessage ?? 'No actions available.'}
        </div>
      );
    }

    const gridClassName = options?.showDashboardToggle
      ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3'
      : 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4';

    return (
      <div className={gridClassName}>
        {options?.enableQuickDrag && isLayoutEditMode && renderQuickActionDropZone(0, 'col-span-full')}
        {actions.map((action) => {
          const isPinned = dashboardLayout.quickActionIds.includes(action.id);
          const quickActionIndex = dashboardLayout.quickActionIds.indexOf(action.id);
          const canDrag = isLayoutEditMode && !!options?.enableQuickDrag && isPinned;
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
                className={`flex h-full flex-col rounded-lg border p-4 transition-all ${
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
                {options?.showDashboardToggle && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {renderDashboardToggleButton(isPinned, () => toggleQuickAction(action.id))}
                  </div>
                )}
              </div>

              <p className="mb-4 flex-1 text-xs text-gray-500">{action.detail}</p>

              <button
                onClick={action.onClick}
                disabled={!action.enabled}
                className={`mt-auto w-full rounded-md border px-4 py-3 text-sm font-semibold transition-colors ${getActionButtonClassName(action)}`}
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

  const renderConfigControlGrid = (
    fields: ServerConfigField[],
    options?: { showDashboardToggle?: boolean; emptyMessage?: string },
  ) => {
    if (fields.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-white/15 bg-black/20 p-4 text-sm text-gray-400">
          {options?.emptyMessage ?? 'No config controls available.'}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
        {fields.map((field) => {
          const isPinned = dashboardLayout.quickConfigKeys.includes(field.key as DashboardConfigControlKey);
          return (
            <div key={field.key} className="rounded-lg border border-white/10 bg-black/20 p-4 transition-all hover:border-white/20">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold text-white">{field.label}</h4>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">{field.description}</p>
                </div>
                {options?.showDashboardToggle && renderDashboardToggleButton(isPinned, () => toggleQuickConfigKey(field.key as DashboardConfigControlKey))}
              </div>

              <p className="mb-4 text-xs text-gray-500">{field.key}</p>
              {renderDashboardConfigField(field.key, {
                requireKey: field.key === 'REQUIRE_STARMADE_AUTHENTICATION' ? 'USE_STARMADE_AUTHENTICATION' : undefined,
                compact: true,
              })}
            </div>
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
    <div className="space-y-4">
      {isLayoutEditMode && draggedQuickAction && renderQuickActionDropZone(0, 'w-full', 'Drop action here to pin/reorder quick actions')}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pinned Actions</p>
        </div>
        {renderActionGrid(quickActions, {
          showDashboardToggle: isLayoutEditMode,
          enableQuickDrag: isLayoutEditMode,
          emptyMessage: 'Use the Actions tab to pin server actions to this widget.',
        })}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pinned Config Controls</p>
        </div>
        {renderConfigControlGrid(quickConfigFields, {
          showDashboardToggle: isLayoutEditMode,
          emptyMessage: 'Use the Actions tab to pin config controls to this widget.',
        })}
      </div>
    </div>
  );

  const renderActionsPanel = () => (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {actionError && (
        <div className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Actions And Controls</h3>
        <p className="mt-1 text-xs text-gray-500">
          This panel lists all actionable buttons and reusable config controls. Use Add to Dashboard to pin any of them into the dashboard controls widget.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Server Actions</h4>
            <p className="mt-1 text-xs text-gray-500">Start, stop, restart, and update controls for the selected server.</p>
          </div>
          {renderActionGrid(serverActions, {
            showDashboardToggle: true,
            emptyMessage: 'No server actions available.',
          })}
        </section>

        <section className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Config Controls</h4>
            <p className="mt-1 text-xs text-gray-500">Editable server.cfg values that can also be pinned into the dashboard controls widget.</p>
          </div>
          {renderConfigControlGrid(dashboardConfigCatalogFields, {
            showDashboardToggle: true,
            emptyMessage: 'No dashboard config controls are available for this server.',
          })}
        </section>
      </div>
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
          className={`space-y-2 overflow-y-auto pr-1 pb-2 ${isResizing ? 'select-none' : ''}`}
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

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Dashboard Layout</h3>
              <p className="mt-1 text-xs text-gray-500">
                {isLayoutEditMode
                  ? 'Drag groups and widgets, rename groups, and use the Actions tab to pin controls while edit mode is enabled.'
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
                  onClick={() => setActiveTab('actions')}
                  className="rounded border border-white/15 bg-black/30 px-2 py-1 text-sm font-semibold text-gray-200 hover:bg-black/45"
                >
                  Open Actions Tab
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
              <p className="mt-2 text-xs text-gray-500">Tip: drag groups to reorder columns, drag widgets to move them between groups, and use the Actions tab to pin controls into Server Controls.</p>
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

            <button
              onClick={() => setIsLogWrapEnabled((prev) => !prev)}
              className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45"
            >
              {isLogWrapEnabled ? 'Wrap: On' : 'Wrap: Off'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
          <p className="px-2 py-1 text-xs text-gray-500">
            {isLogListLoading
              ? 'Scanning logs folder...'
              : allLogFiles.length > 0
                ? `${allLogFiles.length} log file${allLogFiles.length === 1 ? '' : 's'} available`
                : 'No log files found in logs'}
          </p>
          <button
            onClick={() => { void reloadLogCatalog(); }}
            disabled={isLogListLoading}
            className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLogListLoading ? 'Refreshing...' : 'Refresh List'}
          </button>
        </div>

        {selectedLogFile && (
          <p className="mt-2 text-xs text-gray-400">
            {selectedLogFile.fileName} - {formatLogFileSize(selectedLogFile.sizeBytes)} - modified {formatLogModifiedTime(selectedLogFile.modifiedMs)}
          </p>
        )}

        {logLoadError && (
          <p className="mt-2 text-sm text-red-300">{logLoadError}</p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[320px_1fr]">
        <div className="flex min-h-0 flex-col border-b border-white/10 xl:border-b-0 xl:border-r xl:border-white/10">
          <div className="border-b border-white/10 px-3 py-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-300">All Log Files</h4>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {allLogFiles.length === 0 ? (
              <p className="p-2 text-sm text-gray-500">No log files available.</p>
            ) : (
              <div className="space-y-1">
                {allLogFiles.map((file) => {
                  const isActiveFile = selectedLogRelativePath === file.relativePath;
                  return (
                    <button
                      key={file.relativePath}
                      onClick={() => setSelectedLogRelativePath(file.relativePath)}
                      className={`w-full rounded border px-2 py-2 text-left transition-colors ${
                        isActiveFile
                          ? 'border-starmade-accent/40 bg-starmade-accent/20'
                          : 'border-white/15 bg-black/25 hover:bg-black/35'
                      }`}
                    >
                      <p className="truncate text-xs font-semibold text-gray-200">{file.fileName}</p>
                      <p className="truncate text-[11px] text-gray-500">
                        {formatLogFileSize(file.sizeBytes)} - {formatLogModifiedTime(file.modifiedMs)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div ref={logContainerRef} className="min-h-0 overflow-x-auto overflow-y-auto p-4 font-mono text-sm">
          {isLogFileLoading ? (
            <p className="text-gray-400">Loading log file...</p>
          ) : (
            <div className="space-y-1">
              {selectedLogRelativePath == null && (
                <p className="text-gray-500">Select a log file from the left to load it.</p>
              )}
              {selectedLogRelativePath != null && filteredLogs.length === 0 && (
                <p className="text-gray-500">No log lines in this file yet.</p>
              )}
              {filteredLogs.map((log, index) => (
                <div
                  key={`${log.timestamp}-${index}`}
                  className={`flex gap-3 rounded px-2 py-1 hover:bg-white/5 ${isLogWrapEnabled ? '' : 'min-w-max'}`}
                >
                  <span className="flex-shrink-0 text-gray-500">{log.timestamp}</span>
                  <span className={`flex-shrink-0 font-semibold ${getLogLevelColor(log.level)}`}>[{log.level}]</span>
                  <span className={`${isLogWrapEnabled ? 'break-all' : 'whitespace-pre'} text-gray-300`}>{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-4 py-3">
        <p className="text-sm text-gray-400">
          {filteredLogs.length} / {LOG_BUFFER_CAP} buffered log entries
          {isLogFileTruncated ? ' (tail view)' : ''}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleClearBufferedLogs}
            disabled={logs.length === 0}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Clear Buffer
          </button>
          <button
            onClick={() => { void handleClearLogs(); }}
            disabled={!effectiveServer || !hasGameApi || isClearingLogFiles}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isClearingLogFiles ? 'Clearing...' : 'Delete Log Files'}
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
      subtitle: 'Edit server settings.',
      loadingText: 'Loading configuration from server.cfg...',
      searchPlaceholder: 'Search key, label, or description',
      emptyMessage: 'No configuration keys match the current search/filter.',
      categoryOrder: serverConfigCategoryOrder,
      categoryLabels: serverConfigCategoryLabels,
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
      reloadLabel: 'Reload',
      onReload: reloadServerConfigValues,
      reloadDisabled: !effectiveServer || !hasGameApi || isConfigLoading || !!savingConfigKey,
    };
    return <ConfigPanel model={model} />;
  };

  const renderGameConfigXmlConfiguration = () => {
    const hasUnsavedChanges = Object.keys(gameConfigValues).some(
      (path) => gameConfigValues[path] !== (gameConfigSavedValues[path] ?? ''),
    );
    const toggleNeedle = gameConfigSearchTerm.trim().toLowerCase();
    const toggleEntries = gameConfigCommentToggleEntries.filter((entry) => {
      if (gameConfigCategoryFilter.size > 0 && !gameConfigCategoryFilter.has(entry.category)) return false;
      if (!toggleNeedle) return true;

      return (
        entry.id.toLowerCase().includes(toggleNeedle)
        || entry.label.toLowerCase().includes(toggleNeedle)
        || entry.description.toLowerCase().includes(toggleNeedle)
        || entry.path.toLowerCase().includes(toggleNeedle)
      );
    });

    const toggleEntriesByCategory = gameConfigCategoryOrder.reduce<Partial<Record<string, React.ReactNode[]>>>((acc, category) => {
      const categoryEntries = toggleEntries.filter((entry) => entry.category === category);
      if (categoryEntries.length === 0) return acc;

      acc[category] = [
        <div key={`game-config-toggle-${category}`} className="rounded-md border border-white/10 bg-black/20 p-3">
          <p className="text-sm font-semibold text-white">Optional Commented Sections</p>
          <p className="mt-1 text-xs text-gray-400">
            These sections are disabled in XML comments by default. Toggle them on to expose their fields in this editor.
          </p>
          <div className="mt-3 space-y-2">
            {categoryEntries.map((entry) => {
              const enabled = gameConfigCommentToggleStates[entry.id] ?? false;
              const isSavingThisToggle = savingGameConfigToggleId === entry.id;
              const toggleDisabled = !!savingGameConfigPath || (!!savingGameConfigToggleId && !isSavingThisToggle);

              return (
                <div key={entry.id} className="rounded border border-white/10 bg-black/25 p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{entry.label}</p>
                      <p className="text-xs text-gray-400">{entry.description}</p>
                      <p className="mt-1 font-mono text-[11px] text-gray-500">{entry.path}</p>
                    </div>
                    <button
                      onClick={() => { void setGameConfigCommentToggle(entry, !enabled); }}
                      disabled={toggleDisabled}
                      className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingThisToggle ? 'Saving...' : (enabled ? 'Disable' : 'Enable')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ];

      return acc;
    }, {});

    const model: ConfigPanelModel = {
      title: 'GameConfig.xml',
      subtitle: 'Edit game settings.',
      loadingText: 'Loading GameConfig.xml...',
      searchPlaceholder: 'Search by key, label, description, or value',
      emptyMessage: 'No fields match the current search/filter.',
      categoryOrder: gameConfigCategoryOrder,
      categoryLabels: gameConfigCategoryLabels,
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
      reloadDisabled: !effectiveServer || !hasGameApi || isGameConfigLoading || !!savingGameConfigPath || !!savingGameConfigToggleId,
      categoryExtras: toggleEntriesByCategory,
    };

    return <ConfigPanel model={model} />;
  };

  const renderFactionConfigXmlConfiguration = () => {
    const hasUnsavedChanges = Object.keys(factionConfigValues).some(
      (path) => factionConfigValues[path] !== (factionConfigSavedValues[path] ?? ''),
    );

    const model: ConfigPanelModel = {
      title: 'FactionConfig.xml',
      subtitle: 'Edit faction settings from the generated template file.',
      loadingText: 'Loading faction config template...',
      searchPlaceholder: 'Search by key, label, description, or value',
      emptyMessage: 'No fields match the current search/filter.',
      categoryOrder: factionConfigCategoryOrder,
      categoryLabels: factionConfigCategoryLabels,
      fields: factionConfigFields.map((field) => ({
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
      values: factionConfigValues,
      setValues: setFactionConfigValues,
      searchTerm: factionConfigSearchTerm,
      setSearchTerm: setFactionConfigSearchTerm,
      categoryFilter: factionConfigCategoryFilter,
      setCategoryFilter: setFactionConfigCategoryFilter,
      isLoading: isFactionConfigLoading,
      savingFieldId: savingFactionConfigPath,
      hasUnsavedChanges,
      error: factionConfigError,
      onSaveField: async (id, explicitValue) => {
        const field = factionConfigFields.find((f) => f.path === id);
        if (field) await saveFactionConfigField(field, explicitValue);
      },
      onValidateField: (id, rawValue) => {
        const field = factionConfigFields.find((f) => f.path === id);
        return field ? getFactionConfigFieldValidation(field, rawValue) : { error: null, warning: null };
      },
      reloadLabel: 'Reload',
      onReload: reloadFactionConfigXml,
      reloadDisabled: !effectiveServer || !hasGameApi || isFactionConfigLoading || !!savingFactionConfigPath,
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
          <button
            onClick={() => setActiveConfigTab('faction-config-xml')}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeConfigTab === 'faction-config-xml'
                ? 'border-starmade-accent bg-starmade-accent/20 text-white'
                : 'border-white/15 bg-black/25 text-gray-300 hover:bg-black/40'
            }`}
          >
            FactionConfig.xml
          </button>
        </div>
      </div>

      {activeConfigTab === 'server-cfg'
        ? renderServerCfgConfiguration()
        : activeConfigTab === 'game-config-xml'
          ? renderGameConfigXmlConfiguration()
          : renderFactionConfigXmlConfiguration()}
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

      const isEditableTextFile = entry.isEditableText;
      return (
        <button
          key={entry.relativePath}
          onClick={() => { void openFileInTab(entry); }}
          disabled={!isEditableTextFile}
          className={`flex w-full items-center rounded px-2 py-1 text-left text-sm transition-colors ${
            !isEditableTextFile
              ? 'cursor-not-allowed text-gray-500'
              : activeFileTabPath === entry.relativePath
              ? 'bg-starmade-accent/20 text-white'
              : 'text-gray-300 hover:bg-white/5'
          }`}
          style={{ paddingLeft: `${22 + (depth * 14)}px` }}
          title={isEditableTextFile ? undefined : (entry.nonEditableReason ?? 'Binary files are not editable in this panel.')}
        >
          <span className="truncate">{entry.name}</span>
          {!isEditableTextFile && <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">Binary</span>}
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
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-200">File Editor</h3>
            <p className="text-xs text-gray-500">Use Configuration tab for structured editing, or edit raw files here.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFileWrapEnabled((prev) => !prev)}
              className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45"
            >
              {isFileWrapEnabled ? 'Wrap: On' : 'Wrap: Off'}
            </button>
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
              wrap={isFileWrapEnabled ? 'soft' : 'off'}
              spellCheck={false}
              className={`h-full w-full resize-none rounded-md border border-white/15 bg-black/40 p-3 font-mono text-xs leading-5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-starmade-accent ${
                isFileWrapEnabled ? 'overflow-x-hidden whitespace-pre-wrap' : 'overflow-x-auto whitespace-pre'
              }`}
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
    if (activeTab === 'actions') return renderActionsPanel();
    if (activeTab === 'logs') return renderLogs();
    if (activeTab === 'configuration') return renderConfiguration();
    if (activeTab === 'files') return renderFilesTab();
    return renderPlaceholderTab(
      'Database',
      'Database tools placeholder. This area is reserved for universe/player data operations later.'
    );
  };

  return (
    <PageContainer resizable>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
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

          <button
            onClick={isPoppedOutPanel ? handleDockServerPanel : () => { void handlePopOutServerPanel(); }}
            className="rounded-md border border-white/15 bg-black/20 px-3 py-1.5 text-sm font-semibold text-gray-200 transition-colors hover:bg-black/35"
          >
            {isPoppedOutPanel ? 'Dock Back' : 'Pop Out'}
          </button>
        </div>

        <div className="min-h-0 flex-1">{renderActiveTab()}</div>
      </div>
    </PageContainer>
  );
};

export default ServerPanel;

