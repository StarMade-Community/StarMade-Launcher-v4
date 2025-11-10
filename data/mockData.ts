import type { ManagedItem, Account, Version } from '../types';

export const accountsData: Account[] = [
    { id: '1', name: 'DukeofRealms', uuid: '8d3b4e2a-1b9c-4f7d-8a6e-3c5d7f9a1b2c' },
    { id: '2', name: 'GuestUser123', uuid: 'f4a7b8e1-5c6d-4e8f-9a1b-2c3d4e5f6a7b' },
];

export const versionsData: Version[] = [
  { id: '0.203.175', name: 'Latest Release 0.203.175', type: 'latest' },
  { id: '1.19.4', name: 'Release 1.19.4', type: 'release' },
  { id: '24w14a', name: 'Snapshot 24w14a', type: 'dev' },
  { id: '1.0', name: 'Archive 1.0', type: 'archive' },
];

export const initialInstallationsData: ManagedItem[] = [
  {
    id: '1',
    name: 'Latest Release',
    version: '0.203.175',
    type: 'latest',
    icon: 'latest',
    path: 'C:\\Games\\StarMade\\Instances\\latest-release',
    lastPlayed: '2 hours ago',
  },
  {
    id: '2',
    name: 'Dev Build',
    version: '24w14a',
    type: 'dev',
    icon: 'dev',
    path: 'C:\\Games\\StarMade\\Instances\\dev-build',
    lastPlayed: '3 days ago',
  },
  {
    id: '3',
    name: 'Legacy Version',
    version: '1.0',
    type: 'archive',
    icon: 'archive',
    path: 'C:\\Games\\StarMade\\Instances\\archive-1.0',
    lastPlayed: 'Over a year ago',
  },
];

export const defaultInstallationData: ManagedItem = {
  id: '',
  name: 'New Installation',
  version: '0.203.175',
  type: 'release',
  icon: 'release',
  path: 'C:\\Games\\StarMade\\Instances\\new-installation',
  lastPlayed: 'Never',
};

export const initialServersData: ManagedItem[] = [
  {
    id: 's1',
    name: 'Official EU Server',
    version: '0.203.175',
    type: 'latest',
    icon: 'server',
    path: 'C:\\Games\\StarMade\\Servers\\official-eu',
    lastPlayed: 'Online',
    port: '4242',
  },
  {
    id: 's2',
    name: 'Creative Build World',
    version: '24w14a',
    type: 'dev',
    icon: 'cube',
    path: 'C:\\Games\\StarMade\\Servers\\creative-build',
    lastPlayed: '5 minutes ago',
    port: '27015',
  },
  {
    id: 's3',
    name: 'Legacy PvP Arena',
    version: '1.0',
    type: 'archive',
    icon: 'bolt',
    path: 'C:\\Games\\StarMade\\Servers\\pvp-legacy',
    lastPlayed: 'Offline',
    port: '4243',
  },
];

export const defaultServerData: ManagedItem = {
  id: '',
  name: 'New Server',
  version: '0.203.175',
  type: 'release',
  icon: 'server',
  path: 'C:\\Games\\StarMade\\Servers\\new-server',
  lastPlayed: 'Never',
  port: '4242',
};
