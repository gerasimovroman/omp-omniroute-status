export interface QuotaEntry {
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage?: number;
  resetAt?: string | null;
  unlimited?: boolean;
  windowSeconds?: number;
}
export interface ProviderQuotaInfo {
  connectionId?: string;
  provider: string;
  plan?: string;
  quotas: Record<string, QuotaEntry>;
  quotaWindowThresholds?: unknown;
  bankedResetCredits?: number;
}

export interface OmniUsageResponse {
  allowed: boolean;
  personal?: unknown;
  provider?: ProviderQuotaInfo;
  providers?: ProviderQuotaInfo[];
}

export interface OmniConfig {
  key?: string;
  url?: string;
  timeoutMs?: number;
  compact?: boolean;
  filter?: string;
}

export interface FormattedQuotaRow {
  name: string;
  used: number;
  total: number | string;
  remainingPct: number;
  resetAt?: string | null;
  unlimited?: boolean;
}
