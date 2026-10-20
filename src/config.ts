import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OmniConfig } from './types.ts';

export function resolveOmniConfig(overrides: Partial<OmniConfig> = {}): OmniConfig {
  const home = homedir();
  let fileConfig: { apiKey?: string; baseUrl?: string; url?: string } = {};

  const configPath = join(home, '.omni-status.json');
  if (existsSync(configPath)) {
    try {
      const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a configuration object');
      for (const field of ['apiKey', 'url', 'baseUrl'] as const) {
        if (field in value) {
          const candidate: unknown = value[field];
          if (typeof candidate !== 'string') throw new Error(`Expected a string for ${field}`);
          fileConfig[field] = candidate;
        }
      }
    } catch {
      throw new Error('Invalid ~/.omni-status.json: expected string apiKey, url or baseUrl fields');
    }
  }

  let key = overrides.key || process.env.OMNIROUTE_API_KEY || fileConfig.apiKey;

  if (!key) {
    const ompSecretPath = join(home, '.omp', 'secrets', 'omniroute.key');
    if (existsSync(ompSecretPath)) {
      try {
        key = readFileSync(ompSecretPath, 'utf8').trim();
      } catch {
        // ignore read error
      }
    }
  }

  let url =
    overrides.url ||
    process.env.OMNIROUTE_BASE_URL ||
    process.env.OMNIROUTE_URL ||
    fileConfig.url ||
    fileConfig.baseUrl;

  if (!url) throw new Error('Set OMNIROUTE_BASE_URL or baseUrl in ~/.omni-status.json');
  const parsedUrl = new URL(url);
  if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error('OmniRoute base URL must be HTTP(S), without credentials, query or fragment');
  }

  url = url.replace(/\/+$/, '');
  // Strip trailing /v1 if accidentally passed from model endpoint baseUrl
  url = url.replace(/\/v1$/, '');

  return {
    key: key || '',
    url,
    timeoutMs: overrides.timeoutMs ?? 8000,
    compact: overrides.compact ?? false,
    filter: overrides.filter ?? '',
  };
}
