function normalizeFlag(value: string | undefined): boolean | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === '1' || trimmed === 'true' || trimmed === 'yes' || trimmed === 'on') return true;
  if (trimmed === '0' || trimmed === 'false' || trimmed === 'no' || trimmed === 'off') return false;
  return null;
}

export function isStarmoteRolloutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = normalizeFlag(env.STARMOTE_ENABLED);
  if (explicit !== null) return explicit;

  const legacy = normalizeFlag(env.STARMOTE_V2_ENABLED);
  if (legacy !== null) return legacy;

  return true;
}

