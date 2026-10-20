import { resolveOmniConfig } from './config.ts';
import type { OmniConfig, OmniUsageResponse } from './types.ts';

export async function fetchUsage(options: Partial<OmniConfig> = {}): Promise<OmniUsageResponse> {
  const config = resolveOmniConfig(options);

  if (!config.key) {
    throw new Error(
      'Missing OmniRoute API key. Set OMNIROUTE_API_KEY, ~/.omp/secrets/omniroute.key, or ~/.omni-status.json'
    );
  }

  const primaryEndpoint = `${config.url}/api/usage/om-usage?format=json`;

  return await doFetch(primaryEndpoint, config.key, config.timeoutMs ?? 8000);
}
export async function refreshConnectionUsage(connectionId: string, options: Partial<OmniConfig> = {}): Promise<unknown> {
  const config = resolveOmniConfig(options);
  if (!config.key) throw new Error('Missing OmniRoute API key');

  const endpoint = `${config.url}/api/usage/${encodeURIComponent(connectionId)}`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(config.timeoutMs ?? 15000),
  });

  if (!res.ok) {
    throw new Error(`Refresh failed (HTTP ${res.status}): ${res.statusText}`);
  }
  return await res.json();
}

export async function refreshAllConnections(options: Partial<OmniConfig> = {}): Promise<number> {
  const data = await fetchUsage(options);
  const providers = data.providers?.length ? data.providers : data.provider ? [data.provider] : [];
  const connectionIds = providers.map((p) => p.connectionId).filter((id): id is string => Boolean(id));

  await Promise.allSettled(connectionIds.map((id) => refreshConnectionUsage(id, options)));
  return connectionIds.length;
}


async function doFetch(endpoint: string, key: string, timeoutMs: number): Promise<OmniUsageResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {}
      if (res.status === 401) {
        throw new Error('Unauthorized (401): OmniRoute rejected the API key.');
      }
      throw new Error(`OmniRoute error (${res.status} ${res.statusText}): ${detail.slice(0, 150)}`);
    }

    return (await res.json()) as OmniUsageResponse;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out while connecting to OmniRoute (${timeoutMs}ms limit).`);
    }
    const cause = err instanceof Error ? (err.cause as { message?: string; code?: string } | undefined) : undefined;
    const causeMsg = cause?.message || cause?.code || '';
    if (causeMsg) {
      throw new Error(`Cannot connect to OmniRoute at ${endpoint} (${causeMsg}).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
