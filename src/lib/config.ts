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
  clientSecret: string;
  mailbox: string;
  folder: string;
}

const REQUIRED_GRAPH_VARS = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
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
    clientSecret: process.env.AZURE_CLIENT_SECRET as string,
    mailbox: process.env.DMARC_MAILBOX as string,
    folder: process.env.DMARC_MAILBOX_FOLDER || 'inbox',
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
    ttlMs: positiveNumber('DMARC_CACHE_TTL_HOURS', 168) * 60 * 60 * 1000,
    maxEntries: 500,
  };
}
