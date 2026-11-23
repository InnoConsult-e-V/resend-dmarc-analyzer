import 'server-only';

/**
 * Environment configuration (server-only).
 *
 * Secrets are read exclusively from environment variables. There are no
 * defaults or fallbacks, and error messages name the missing variable but
 * never print any value.
 */

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  mailbox: string;
  folder: string;
  redirectUri: string;
  authDir: string;
}

const REQUIRED_GRAPH_VARS = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'DMARC_MAILBOX',
] as const;

/**
 * Read Microsoft Graph configuration. Throws if anything required is missing.
 * Evaluated lazily so builds do not need secrets.
 */
export function getGraphConfig(): GraphConfig {
  const missing = REQUIRED_GRAPH_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(', ')}`);
  }

  return {
    tenantId: process.env.AZURE_TENANT_ID as string,
    clientId: process.env.AZURE_CLIENT_ID as string,
    mailbox: process.env.DMARC_MAILBOX as string,
    folder: process.env.DMARC_MAILBOX_FOLDER || 'inbox',
    redirectUri:
      process.env.AUTH_REDIRECT_URI ||
      'http://localhost:3000/api/auth/callback',
    authDir: process.env.DMARC_AUTH_DIR || '.cache/auth',
  };
}

export interface CacheConfig {
  dir: string;
  ttlMs: number;
  maxEntries: number;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid configuration: ${name} must be a positive number`);
  }
  return n;
}

/**
 * Read cache configuration. All values are optional.
 */
export function getCacheConfig(): CacheConfig {
  return {
    dir: process.env.DMARC_CACHE_DIR || '.cache/dmarc',
    // 90 days by default: the dashboard needs history to show trends.
    ttlMs: positiveNumber('DMARC_CACHE_TTL_HOURS', 2160) * 60 * 60 * 1000,
    maxEntries: Math.floor(positiveNumber('DMARC_CACHE_MAX_ENTRIES', 5000)),
  };
}

/** How far back a mailbox fetch looks (days). Matches the cache retention. */
export function getFetchDays(): number {
  return positiveNumber('DMARC_FETCH_DAYS', 90);
}

/** Folder for the small local state file (last sync / last review). */
export function getStateDir(): string {
  return process.env.DMARC_STATE_DIR || '.cache/state';
}

/** Folder for the cached reverse-DNS (PTR) lookups. */
export function getDnsCacheDir(): string {
  return process.env.DMARC_DNS_CACHE_DIR || '.cache/dns';
}

/**
 * Optional: the email address that receives DMARC reports. When set, the DNS
 * check verifies a domain's rua= tag contains it.
 */
export function getReportAddress(): string | undefined {
  return process.env.DMARC_REPORT_ADDRESS?.trim().toLowerCase() || undefined;
}
