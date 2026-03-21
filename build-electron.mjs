#!/usr/bin/env node
/**
 * build-electron.mjs
 *
 * Compiles the Electron main-process TypeScript files to dist-electron/ using
 * esbuild instead of bare tsc so that environment variables (e.g. SMD_API_KEY)
 * can be **baked into the compiled output** at CI/CD build time rather than
 * resolved at runtime (where they would be undefined in a packaged app).
 *
 * Usage:
 *   node build-electron.mjs
 *
 * Environment variables recognised (any that are set will be inlined):
 *   SMD_API_KEY, SMD_XF_API_KEY, XENFORO_API_KEY
 */

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. Type-check with tsc (no emit) ──────────────────────────────────────
console.log('[build-electron] Type-checking with tsc...');
execSync('npx tsc --project tsconfig.electron.json --noEmit', {
  stdio: 'inherit',
  cwd: __dirname,
});

// ── 2. Collect entry points from electron/ ────────────────────────────────
const electronDir = path.join(__dirname, 'electron');
const files = await readdir(electronDir);
const entryPoints = files
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(electronDir, f));

// ── 3. Build env-var defines (bake key in at build time) ──────────────────
const ENV_VARS_TO_BAKE = ['SMD_API_KEY', 'SMD_XF_API_KEY', 'XENFORO_API_KEY'];
const define = {};
for (const name of ENV_VARS_TO_BAKE) {
  const value = process.env[name];
  if (typeof value === 'string' && value.length > 0) {
    define[`process.env.${name}`] = JSON.stringify(value);
    console.log(`[build-electron] Baking in ${name} (${value.length} chars)`);
  }
}

if (Object.keys(define).length === 0) {
  console.warn(
    '[build-electron] No SMD API key env var found. ' +
    'The packaged app will require SMD_API_KEY at runtime or via a .env file.',
  );
}

// ── 4. Compile with esbuild ───────────────────────────────────────────────
console.log('[build-electron] Compiling electron main process...');
await build({
  entryPoints,
  outdir: path.join(__dirname, 'dist-electron'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: false,    // Transpile each file individually; imports remain as-is.
  define,           // Replaces process.env.SMD_API_KEY → "literal-key-value"
  logLevel: 'info',
});

console.log('[build-electron] Done.');

