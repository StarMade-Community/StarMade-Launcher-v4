export interface LaunchArgFixture {
  name: string;
  options: {
    jvmArgList: string[];
    isServer?: boolean;
    serverPort?: number;
    authToken?: string;
    uplink?: string;
    uplinkPort?: number;
    modIds?: string[];
  };
  expectedArgs: string[];
  expectedSafeArgs: string[];
}

export const LAUNCH_ARG_FIXTURES: LaunchArgFixture[] = [
  {
    name: 'client launch without auth token',
    options: {
      jvmArgList: ['-Xms1024M', '-Xmx2048M'],
    },
    expectedArgs: ['-Xms1024M', '-Xmx2048M', '-jar', 'StarMade.jar', '-force'],
    expectedSafeArgs: ['-Xms1024M', '-Xmx2048M', '-jar', 'StarMade.jar', '-force'],
  },
  {
    name: 'server launch includes port and auth token redaction',
    options: {
      jvmArgList: ['-Xms1536M', '-Xmx4096M'],
      isServer: true,
      serverPort: 4242,
      authToken: 'token-abc-123',
    },
    expectedArgs: [
      '-Xms1536M',
      '-Xmx4096M',
      '-jar',
      'StarMade.jar',
      '-force',
      '-server',
      '-port',
      '4242',
      '-auth',
      'token-abc-123',
    ],
    expectedSafeArgs: [
      '-Xms1536M',
      '-Xmx4096M',
      '-jar',
      'StarMade.jar',
      '-force',
      '-server',
      '-port',
      '4242',
      '-auth',
      '[REDACTED]',
    ],
  },
  {
    name: 'uplink launch includes default uplink port and mods',
    options: {
      jvmArgList: ['-Xmx2048M'],
      uplink: '127.0.0.1',
      modIds: ['m1', 'm2'],
    },
    expectedArgs: [
      '-Xmx2048M',
      '-jar',
      'StarMade.jar',
      '-force',
      '-uplink',
      '127.0.0.1',
      '4242',
      'm1,m2',
    ],
    expectedSafeArgs: [
      '-Xmx2048M',
      '-jar',
      'StarMade.jar',
      '-force',
      '-uplink',
      '127.0.0.1',
      '4242',
      'm1,m2',
    ],
  },
  {
    name: 'redacts inline auth assignment arguments',
    options: {
      jvmArgList: ['-auth=legacy-token', '-Dfoo=bar'],
      authToken: 'legacy-token',
    },
    expectedArgs: ['-auth=legacy-token', '-Dfoo=bar', '-jar', 'StarMade.jar', '-force', '-auth', 'legacy-token'],
    expectedSafeArgs: ['-auth=[REDACTED]', '-Dfoo=bar', '-jar', 'StarMade.jar', '-force', '-auth', '[REDACTED]'],
  },
];

