export function isStarmoteDebugEnabled(): boolean {
  const value = process.env.STARMOTE_DEBUG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function logStarmoteDebug(event: string, details?: Record<string, unknown>): void {
  if (!isStarmoteDebugEnabled()) return;

  if (details) {
    console.debug(`[StarMote] ${event}`, details);
    return;
  }

  console.debug(`[StarMote] ${event}`);
}

