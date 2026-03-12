/**
 * Account authentication for the StarMade registry (registry.star-made.org).
 *
 * All network calls are performed in the main process so that credentials
 * (username, password, tokens) never touch the renderer sandbox.
 *
 * The registry uses a standard OAuth 2.0 Resource-Owner Password Credentials
 * (ROPC) flow — same as the v2 launcher's auth.coffee / refreshToken service.
 *
 * API overview:
 *   POST /oauth/token          – login (grant_type=password) or refresh (grant_type=refresh_token)
 *   POST /api/v1/users.json    – register a new account
 */

import https from 'https';
import querystring from 'querystring';
import { safeStorage } from 'electron';
import { storeGet, storeSet, storeDelete } from './store.js';

// ─── Registry endpoints ───────────────────────────────────────────────────────

const TOKEN_URL    = 'https://registry.star-made.org/oauth/token';
const REGISTER_URL = 'https://registry.star-made.org/api/v1/users.json';
const OAUTH_SCOPE  = 'public read_citizen_info client';

// ─── Store key helpers ────────────────────────────────────────────────────────

/** Key under which we store the encrypted access token for a given account id. */
function tokenKey(accountId: string): string {
  return `auth_access_token_${accountId}`;
}
function refreshKey(accountId: string): string {
  return `auth_refresh_token_${accountId}`;
}
function expiryKey(accountId: string): string {
  return `auth_token_expiry_${accountId}`;
}

// ─── Token persistence ────────────────────────────────────────────────────────

/**
 * Encrypt `value` with Electron's safeStorage (OS keychain-backed AES) and
 * store it.  Falls back to plaintext storage when safeStorage is unavailable
 * (e.g. headless CI or early process startup).
 */
function storeToken(key: string, value: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(value);
    storeSet(key, buf.toString('base64'));
  } else {
    storeSet(key, value);
  }
}

function loadToken(key: string): string | null {
  const raw = storeGet(key);
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(raw, 'base64');
      return safeStorage.decryptString(buf);
    }
    return raw;
  } catch {
    return null;
  }
}

function deleteToken(key: string): void {
  storeDelete(key);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface HttpResponse {
  statusCode: number;
  body: string;
}

function httpsPost(url: string, formData: Record<string, string>): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const postBody = querystring.stringify(formData);
    const parsed   = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody),
          'Accept':         'application/json',
          'User-Agent':     'StarMade-Launcher/4',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end',  ()      => resolve({ statusCode: res.statusCode ?? 0, body }));
      },
    );

    req.on('error', reject);
    req.write(postBody);
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LoginSuccess {
  success: true;
  accountId: string;
  username: string;
  /** Opaque UUID returned by the registry (may be absent on very old accounts). */
  uuid?: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface LoginFailure {
  success: false;
  error: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

export interface RegisterResult {
  success: boolean;
  error?: string;
}

// ─── Login (ROPC) ─────────────────────────────────────────────────────────────

/**
 * Authenticate against the StarMade registry.
 *
 * On success, the tokens are stored (encrypted) in the launcher store keyed by
 * the account id derived from the username.  The renderer only receives the
 * safe summary (username, uuid, expiresIn) — never the raw token.
 */
export async function loginWithPassword(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await httpsPost(TOKEN_URL, {
      grant_type: 'password',
      username:   username.trim(),
      password,
      scope:      OAUTH_SCOPE,
    });

    const json = JSON.parse(res.body) as Record<string, unknown>;

    if (res.statusCode === 200 && typeof json.access_token === 'string') {
      const accessToken  = json.access_token  as string;
      const refreshToken = json.refresh_token as string | undefined;
      const expiresIn    = typeof json.expires_in === 'number' ? json.expires_in : 3600;

      // Derive a stable, store-friendly account id from the username
      const accountId = `registry-${username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
      const expiry    = Date.now() + expiresIn * 1000;

      storeToken(tokenKey(accountId), accessToken);
      if (refreshToken) storeToken(refreshKey(accountId), refreshToken);
      storeSet(expiryKey(accountId), expiry);

      console.log(`[Auth] Logged in as ${username.trim()} (accountId=${accountId})`);

      return {
        success: true,
        accountId,
        username: username.trim(),
        expiresIn,
      };
    }

    if (res.statusCode === 401) {
      return { success: false, error: 'Invalid credentials.' };
    }

    return { success: false, error: `Login failed (HTTP ${res.statusCode}).` };
  } catch (err) {
    console.error('[Auth] loginWithPassword error:', err);
    return { success: false, error: 'Network error — please check your connection.' };
  }
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshAccessToken(accountId: string): Promise<LoginResult> {
  const storedRefresh = loadToken(refreshKey(accountId));
  if (!storedRefresh) {
    return { success: false, error: 'No refresh token stored — please log in again.' };
  }

  try {
    const res = await httpsPost(TOKEN_URL, {
      grant_type:    'refresh_token',
      refresh_token: storedRefresh,
      scope:         OAUTH_SCOPE,
    });

    const json = JSON.parse(res.body) as Record<string, unknown>;

    if (res.statusCode === 200 && typeof json.access_token === 'string') {
      const accessToken  = json.access_token  as string;
      const refreshToken = json.refresh_token as string | undefined;
      const expiresIn    = typeof json.expires_in === 'number' ? json.expires_in : 3600;
      const expiry       = Date.now() + expiresIn * 1000;

      storeToken(tokenKey(accountId), accessToken);
      if (refreshToken) storeToken(refreshKey(accountId), refreshToken);
      storeSet(expiryKey(accountId), expiry);

      // Recover username from the accountId convention
      const username = accountId.replace(/^registry-/, '');

      console.log(`[Auth] Refreshed token for ${username}`);
      return { success: true, accountId, username, expiresIn };
    }

    return { success: false, error: `Token refresh failed (HTTP ${res.statusCode}).` };
  } catch (err) {
    console.error('[Auth] refreshAccessToken error:', err);
    return { success: false, error: 'Network error — please check your connection.' };
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export async function registerAccount(
  username: string,
  email: string,
  password: string,
  subscribeToNewsletter: boolean,
): Promise<RegisterResult> {
  try {
    const res = await httpsPost(REGISTER_URL, {
      'user[username]':              username.trim(),
      'user[email]':                 email.trim(),
      'user[password]':              password,
      'user[password_confirmation]': password,
      'user[subscribe_to_newsletter]': subscribeToNewsletter ? '1' : '0',
    });

    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log(`[Auth] Registered account: ${username.trim()}`);
      return { success: true };
    }

    // Parse validation errors (HTTP 422)
    try {
      const json = JSON.parse(res.body) as Record<string, unknown>;
      if (res.statusCode === 422 && json.errors && typeof json.errors === 'object') {
        const errors = json.errors as Record<string, string[]>;
        const field  = Object.keys(errors)[0];
        if (field) {
          const label = field.charAt(0).toUpperCase() + field.slice(1);
          return { success: false, error: `${label} ${errors[field][0]}` };
        }
      }
    } catch {
      // fall through to generic error
    }

    return { success: false, error: `Registration failed (HTTP ${res.statusCode}).` };
  } catch (err) {
    console.error('[Auth] registerAccount error:', err);
    return { success: false, error: 'Network error — please check your connection.' };
  }
}

// ─── Token retrieval (for game launch) ───────────────────────────────────────

/**
 * Retrieve the stored access token for `accountId`, refreshing it first if it
 * is expired and a refresh token is available.
 *
 * Returns `null` for guest accounts (no token required for offline play).
 */
export async function getAccessTokenForLaunch(accountId: string): Promise<string | null> {
  // Guest accounts have no token
  if (accountId.startsWith('offline-') || accountId.startsWith('guest-')) return null;

  const token = loadToken(tokenKey(accountId));
  if (!token) return null;

  // Check expiry — refresh proactively if less than 5 minutes remain
  const expiry = storeGet(expiryKey(accountId));
  if (typeof expiry === 'number' && expiry - Date.now() < 5 * 60 * 1000) {
    console.log(`[Auth] Token for ${accountId} is near expiry — refreshing…`);
    const result = await refreshAccessToken(accountId);
    if (result.success) {
      return loadToken(tokenKey(accountId));
    }
    // Refresh failed — try the stored token anyway; game will reject if it's truly expired
  }

  return token;
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export function logoutAccount(accountId: string): void {
  deleteToken(tokenKey(accountId));
  deleteToken(refreshKey(accountId));
  storeDelete(expiryKey(accountId));
  console.log(`[Auth] Logged out account: ${accountId}`);
}

// ─── Status check ─────────────────────────────────────────────────────────────

/**
 * Returns whether a valid (non-expired) access token exists for the account.
 * Does NOT make a network request.
 */
export function getAuthStatus(accountId: string): { authenticated: boolean; expired: boolean } {
  if (accountId.startsWith('offline-') || accountId.startsWith('guest-')) {
    return { authenticated: false, expired: false };
  }

  const token  = loadToken(tokenKey(accountId));
  if (!token) return { authenticated: false, expired: false };

  const expiry = storeGet(expiryKey(accountId));
  const expired = typeof expiry === 'number' ? Date.now() >= expiry : false;

  return { authenticated: true, expired };
}

