import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDomain } from 'tldts';
import { isOwnDomain } from '@/lib/dmarc/identity';
import { validateNameMap } from './csv';
import type { ServiceInfo } from './keys';

/**
 * Names the service behind a sending source using the vendored parsedmarc map
 * (data/sender-names, CC BY-SA 4.0). Loaded from disk once; no network.
 */

const FILE = 'data/sender-names/base_reverse_dns_map.csv';

type NameMap = Map<string, { name: string; type: string }>;
let cached: NameMap | null = null;

export function loadNameMap(file = path.resolve(process.cwd(), FILE)): NameMap {
  if (cached && file === path.resolve(process.cwd(), FILE)) {
    return cached;
  }
  const map: NameMap = new Map();
  try {
    const result = validateNameMap(readFileSync(file, 'utf-8'));
    if (result.ok) {
      for (const r of result.rows) {
        map.set(r.domain, { name: r.name, type: r.type });
      }
    } else {
      console.warn('[senders] sender-name map is invalid; names are disabled');
    }
  } catch {
    console.warn('[senders] sender-name map not found; names are disabled');
  }
  if (file === path.resolve(process.cwd(), FILE)) {
    cached = map;
  }
  return map;
}

/** Look a host up by itself, then by each parent domain down to the registrable domain. */
function matchDomain(host: string, map: NameMap) {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) {
    return null;
  }
  const base = getDomain(h) ?? h;
  const labels = h.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const hit = map.get(candidate);
    if (hit) {
      return { ...hit, domain: candidate };
    }
    if (candidate === base) {
      break;
    }
  }
  return null;
}

export interface ServiceInputs {
  /** Reverse-DNS name of the source IP, if known */
  ptrHost?: string | null;
  dkimDomains: string[];
  spfDomains: string[];
  envelopeFrom: string[];
  /** The domains the reports are about: identities in them are not a "service". */
  ownDomains: string[];
}

/**
 * DKIM signing domains first, then SPF and envelope-from domains, then the
 * PTR name (so the result does not depend on whether a PTR lookup is cached).
 */
export function lookupService(
  input: ServiceInputs,
  map: NameMap = loadNameMap(),
): ServiceInfo | null {
  const tries: Array<[ServiceInfo['via'], string[]]> = [
    ['dkim', input.dkimDomains],
    ['spf', input.spfDomains],
    ['envelope', input.envelopeFrom],
    ['ptr', input.ptrHost ? [input.ptrHost] : []],
  ];
  for (const [via, domains] of tries) {
    for (const d of [...domains].sort()) {
      if (via !== 'ptr' && isOwnDomain(d, input.ownDomains)) {
        continue;
      }
      const hit = matchDomain(d, map);
      if (hit) {
        return { name: hit.name, type: hit.type, via, domain: hit.domain };
      }
    }
  }
  return null;
}
