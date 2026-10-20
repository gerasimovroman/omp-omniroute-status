import type { FormattedQuotaRow, OmniConfig, OmniUsageResponse, ProviderQuotaInfo, QuotaEntry } from './types.ts';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return `${c.gray}none${c.reset}`;
  const target = new Date(dateStr);
  const diffMs = target.getTime() - Date.now();
  const timeStr = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  if (diffMs <= 0) {
    return `${c.yellow}resets now${c.reset} ${c.gray}(${timeStr})${c.reset}`;
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;

  if (days > 0) {
    const dateFormatted = target.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `in ${days}d ${hours}h ${c.gray}(${dateFormatted} ${timeStr})${c.reset}`;
  }
  if (hours > 0) {
    return `in ${hours}h ${mins}m ${c.gray}(${timeStr})${c.reset}`;
  }
  return `in ${mins}m ${c.gray}(${timeStr})${c.reset}`;
}

export function renderProgressBar(remainingPct: number, width = 14): string {
  const safePct = Math.max(0, Math.min(100, remainingPct));
  const filledChars = Math.round((safePct / 100) * width);
  const emptyChars = width - filledChars;

  let color = c.green;
  if (safePct < 20) {
    color = c.red;
  } else if (safePct <= 50) {
    color = c.yellow;
  }

  return `${color}${'█'.repeat(filledChars)}${c.dim}${'░'.repeat(emptyChars)}${c.reset}`;
}

export function extractQuotaRows(
  quotas: Record<string, QuotaEntry>,
  compact = false,
  filter = ''
): FormattedQuotaRow[] {
  const entries = Object.entries(quotas);
  const filterLower = filter.toLowerCase().trim();

  const rows: FormattedQuotaRow[] = [];
  for (const [key, q] of entries) {
    if (filterLower && !key.toLowerCase().includes(filterLower)) {
      continue;
    }

    const used = q.used ?? 0;
    const total = q.total ?? 0;

    if (q.unlimited) {
      if (compact && !filterLower) {
        continue;
      }
      rows.push({
        name: key,
        used,
        total: '∞',
        remainingPct: 100,
        resetAt: q.resetAt,
        unlimited: true,
      });
      continue;
    }

    let remainingPct = 100;
    if (typeof q.remainingPercentage === 'number') {
      remainingPct = q.remainingPercentage;
    } else if (typeof q.remaining === 'number' && total > 0) {
      remainingPct = (q.remaining / total) * 100;
    } else if (total > 0) {
      remainingPct = Math.max(0, ((total - used) / total) * 100);
    }

    rows.push({
      name: key,
      used,
      total,
      remainingPct,
      resetAt: q.resetAt,
      unlimited: false,
    });
  }

  if (compact && rows.length > 3) {
    const groups = new Map<string, FormattedQuotaRow[]>();
    for (const r of rows) {
      const groupKey = `${r.used}-${r.total}-${r.resetAt ?? ''}`;
      const list = groups.get(groupKey);
      if (list) {
        list.push(r);
      } else {
        groups.set(groupKey, [r]);
      }
    }

    const compactRows: FormattedQuotaRow[] = [];
    for (const [, items] of groups) {
      if (items.length === 1) {
        compactRows.push(items[0]);
      } else {
        const first = items[0];
        let shortName = first.name;
        if (shortName.startsWith('gemini-') && shortName.includes('flash')) {
          shortName = 'gemini-flash';
        } else if (shortName.startsWith('claude-') || shortName.startsWith('gpt-')) {
          shortName = 'claude / gpt';
        }
        compactRows.push({
          ...first,
          name: `${shortName} *(+${items.length - 1})*`,
        });
      }
    }
    return compactRows;
  }

  return rows;
}

export function formatUsageReport(data: OmniUsageResponse, options: Partial<OmniConfig> = {}): string {
  const lines: string[] = [];
  const sep = `${c.gray}${'─'.repeat(78)}${c.reset}`;
  const allowedBadge = data.allowed ? `${c.green}● active${c.reset}` : `${c.red}● restricted${c.reset}`;

  lines.push('');
  lines.push(` ${c.bold}${c.cyan}OMNIROUTE${c.reset} ${c.bold}QUOTA & USAGE${c.reset}   ${allowedBadge}   ${c.gray}${options.url || ''}${c.reset}`);
  lines.push(sep);

  const providers = data.providers?.length
    ? data.providers
    : data.provider
      ? [data.provider]
      : [];

  if (providers.length === 0) {
    lines.push(` ${c.yellow}No provider quota data available.${c.reset}`);
    lines.push(sep);
    return lines.join('\n');
  }

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const name = p.provider.toUpperCase();
    const planBadge = p.plan ? `${c.yellow}[${p.plan}]${c.reset}` : '';

    lines.push(` ${c.bold}${c.white}${name}${c.reset} ${planBadge}`);

    const rows = extractQuotaRows(p.quotas || {}, options.compact, options.filter);
    if (rows.length === 0) {
      lines.push(`   ${c.gray}No matching active quotas${c.reset}`);
      continue;
    }

    const maxLen = Math.max(16, ...rows.map((r) => r.name.length));

    for (const r of rows) {
      const nameCol = r.name.padEnd(maxLen);
      const usedCol = `${r.used}/${r.total}`.padStart(10);
      const bar = renderProgressBar(r.remainingPct, 12);
      const pctCol = `${r.remainingPct.toFixed(1)}% left`.padStart(11);
      const resetCol = r.unlimited ? `${c.dim}unlimited${c.reset}` : formatRelativeTime(r.resetAt);

      lines.push(`   ${c.cyan}${nameCol}${c.reset}  ${c.dim}${usedCol}${c.reset}  ${bar} ${pctCol}  ${c.gray}reset:${c.reset} ${resetCol}`);
    }

    if (i < providers.length - 1) {
      lines.push('');
    }
  }

  lines.push(sep);
  lines.push(` ${c.gray}Updated: ${new Date().toLocaleTimeString([], { hour12: false })}${c.reset}`);
  lines.push('');
  return lines.join('\n');
}

export function formatWidgetLines(data: OmniUsageResponse, maxLines = 6): string[] {
  const providers = data.providers?.length ? data.providers : data.provider ? [data.provider] : [];
  if (providers.length === 0) return ['OmniRoute: no quota data'];

  const lines: string[] = [];
  lines.push(`OmniRoute Quotas (${data.allowed ? '● active' : '● restricted'}):`);

  for (const p of providers) {
    const rows = extractQuotaRows(p.quotas || {}, true);
    for (const r of rows) {
      if (lines.length >= maxLines) break;
      const pct = r.remainingPct.toFixed(0);
      const resetNote = r.unlimited ? 'unlimited' : r.resetAt ? new Date(r.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      lines.push(`  ${p.provider}/${r.name}: ${pct}% left (${r.used}/${r.total}) ${resetNote ? `resets ${resetNote}` : ''}`);
    }
    if (lines.length >= maxLines) break;
  }

  return lines;
}

export function formatRelativeTimePlain(dateStr?: string | null): string {
  if (!dateStr) return 'none';
  const target = new Date(dateStr);
  const diffMs = target.getTime() - Date.now();
  const timeStr = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  if (diffMs <= 0) {
    return `resets now (${timeStr})`;
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;

  if (days > 0) {
    const dateFormatted = target.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `in ${days}d ${hours}h (${dateFormatted} ${timeStr})`;
  }
  if (hours > 0) {
    return `in ${hours}h ${mins}m (${timeStr})`;
  }
  return `in ${mins}m (${timeStr})`;
}

export function formatSummaryMarkdown(data: OmniUsageResponse, options: Partial<OmniConfig> = {}): string {
  const providers = data.providers?.length ? data.providers : data.provider ? [data.provider] : [];
  if (providers.length === 0) return 'No OmniRoute quota data available.';

  const compact = options.compact ?? true;
  const chunks: string[] = [];
  const statusLabel = data.allowed ? '🟢 Active' : '🔴 Restricted';
  chunks.push(`### ⚡ OmniRoute Quotas (${statusLabel})\n`);
  chunks.push('| Pool / Model | Left | Used / Total | Reset |');
  chunks.push('| :--- | :---: | :---: | :--- |');

  const providerCounts = new Map<string, number>();
  for (const p of providers) {
    const name = p.provider.toUpperCase();
    providerCounts.set(name, (providerCounts.get(name) ?? 0) + 1);
  }

  const providerSeen = new Map<string, number>();
  const creditsNotes: string[] = [];

  for (const p of providers) {
    const pName = p.provider.toUpperCase();
    const totalCount = providerCounts.get(pName) ?? 1;
    const currentIdx = (providerSeen.get(pName) ?? 0) + 1;
    providerSeen.set(pName, currentIdx);

    const pLabel = totalCount > 1 ? `**${pName} #${currentIdx}**` : `**${pName}**`;
    const planBadge = p.plan ? ` \`${p.plan}\`` : '';

    if (typeof p.bankedResetCredits === 'number' && p.bankedResetCredits > 0) {
      creditsNotes.push(`${pName}: 🔄 **${p.bankedResetCredits}** reset credits banked`);
    }

    const rows = extractQuotaRows(p.quotas || {}, compact, options.filter);
    for (const r of rows) {
      let badge = '🟢';
      if (r.remainingPct < 20) {
        badge = '🔴';
      } else if (r.remainingPct <= 50) {
        badge = '🟡';
      }

      const resetStr = r.unlimited ? 'unlimited' : formatRelativeTimePlain(r.resetAt);
      chunks.push(`| ${pLabel}${planBadge} · ${r.name} | ${badge} **${r.remainingPct.toFixed(1)}%** | ${r.used}/${r.total} | ${resetStr} |`);
    }
  }

  const metaParts: string[] = [];
  if (creditsNotes.length > 0) {
    metaParts.push(creditsNotes.join(' · '));
  }
  metaParts.push(`Updated ${new Date().toLocaleTimeString([], { hour12: false })}`);

  chunks.push(`\n*${metaParts.join(' • ')}*`);
  return chunks.join('\n');
}
