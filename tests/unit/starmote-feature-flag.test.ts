import { describe, it, expect } from 'vitest';

import { isStarmoteRolloutEnabled } from '../../electron/starmote-feature-flag.js';

describe('isStarmoteRolloutEnabled', () => {
  it('defaults to enabled when no env vars are set', () => {
    expect(isStarmoteRolloutEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('supports explicit enabled values', () => {
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('supports explicit disabled values', () => {
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('falls back to legacy STARMOTE_V2_ENABLED when STARMOTE_ENABLED is absent', () => {
    expect(isStarmoteRolloutEnabled({ STARMOTE_V2_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isStarmoteRolloutEnabled({ STARMOTE_V2_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('gives STARMOTE_ENABLED precedence over legacy flag', () => {
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: '0', STARMOTE_V2_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isStarmoteRolloutEnabled({ STARMOTE_ENABLED: '1', STARMOTE_V2_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

