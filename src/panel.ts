import type { ExtensionCommandContext } from '@oh-my-pi/pi-coding-agent';
import { matchesKey, truncateToWidth, visibleWidth } from '@oh-my-pi/pi-tui';
import { fetchUsage, refreshAllConnections } from './api.ts';
import { extractQuotaRows } from './formatter.ts';
import type { OmniConfig, OmniUsageResponse } from './types.ts';

export async function showQuotaPanel(ctx: ExtensionCommandContext, options: Partial<OmniConfig>, refresh: boolean): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let data: OmniUsageResponse | undefined;
    let error = '';
    let loading = false;
    let closed = false;
    let scroll = 0;
    let maxScroll = 0;
    let pageSize = 1;
    let updatedAt = '';

    async function load(forceRefresh: boolean): Promise<void> {
      if (loading || closed) return;
      loading = true;
      error = '';
      tui.requestRender();
      try {
        if (forceRefresh) await refreshAllConnections();
        const result = await fetchUsage(options);
        if (!closed) {
          data = result;
          updatedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }
      } catch (cause: unknown) {
        if (!closed) error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        loading = false;
        if (!closed) tui.requestRender();
      }
    }

    void load(refresh);

    return {
      render(width: number): readonly string[] {
        const innerWidth = Math.max(1, width - 4);
        const body: string[] = [];
        const providers = data?.providers?.length ? data.providers : data?.provider ? [data.provider] : [];
        const counts = new Map<string, number>();
        const seen = new Map<string, number>();
        for (const provider of providers) counts.set(provider.provider, (counts.get(provider.provider) ?? 0) + 1);

        for (const provider of providers) {
          const providerName = provider.provider.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
          const filter = options.filter?.toLowerCase() ?? '';
          const rows = extractQuotaRows(provider.quotas, options.compact, providerName.toLowerCase().includes(filter) ? '' : filter);
          const index = (seen.get(provider.provider) ?? 0) + 1;
          seen.set(provider.provider, index);
          if (rows.length === 0) continue;
          if (body.length > 0) body.push('');
          const account = (counts.get(provider.provider) ?? 0) > 1 ? ` #${index}` : '';
          const plan = provider.plan ? ` · ${provider.plan.replace(/[\x00-\x1f\x7f-\x9f]/g, '')}` : '';
          const credits = provider.bankedResetCredits === undefined ? '' : ` · ${provider.bankedResetCredits} resets`;
          body.push(theme.bold(theme.fg('accent', `${providerName.toUpperCase()}${account}`)) + theme.fg('muted', `${plan}${credits}`));

          for (const row of rows) {
            const name = row.name.replace(/[\x00-\x1f\x7f-\x9f*]/g, '');
            const pct = Math.max(0, Math.min(100, row.remainingPct));
            const color = pct < 20 ? 'error' : pct <= 50 ? 'warning' : 'success';
            const remaining = row.unlimited ? '∞' : `${pct.toFixed(1)}%`;
            let reset = 'no reset';
            if (row.unlimited) {
              reset = 'unlimited';
            } else if (row.resetAt) {
              const minutes = Math.ceil((Date.parse(row.resetAt) - Date.now()) / 60000);
              if (!Number.isFinite(minutes)) reset = 'unknown reset';
              else if (minutes <= 0) reset = 'reset due';
              else if (minutes >= 1440) reset = `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
              else if (minutes >= 60) reset = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
              else reset = `${minutes}m`;
            }

            if (innerWidth >= 60) {
              const nameWidth = innerWidth - 32;
              const label = truncateToWidth(name, nameWidth);
              const filled = Math.round(pct / 10);
              const bar = theme.fg(color, '━'.repeat(filled)) + theme.fg('dim', '─'.repeat(10 - filled));
              body.push(`  ${label}${' '.repeat(Math.max(0, nameWidth - visibleWidth(label)))} ${bar} ${theme.fg(color, remaining.padStart(6))}  ${theme.fg('muted', reset)}`);
            } else {
              body.push(`  ${theme.fg(color, remaining.padStart(6))}  ${name}`);
              body.push(theme.fg('muted', `          reset: ${reset}`));
            }
          }
        }

        if (!data && loading) body.push(theme.fg('muted', 'Loading quotas…'));
        else if (data && body.length === 0) body.push(theme.fg('muted', 'No matching quotas.'));
        if (error) body.unshift(theme.fg('error', error.replace(/[\x00-\x1f\x7f-\x9f]/g, '')));
        if (data && !data.allowed) body.unshift(theme.fg('warning', 'OmniRoute access restricted'));

        pageSize = Math.max(1, tui.terminal.rows - 10);
        maxScroll = Math.max(0, body.length - pageSize);
        scroll = Math.min(scroll, maxScroll);
        const horizontal = theme.symbol('boxRound.horizontal');
        const border = theme.fg('borderMuted', horizontal.repeat(Math.max(1, width)));
        const status = loading ? ' · refreshing…' : updatedAt ? ` · ${updatedAt}` : '';
        const position = maxScroll > 0 ? ` · ${scroll + 1}–${Math.min(scroll + pageSize, body.length)}/${body.length}` : '';
        const lines = [
          border,
          `  ${theme.bold(theme.fg('accent', 'OmniRoute quotas'))}${theme.fg('muted', `${status}${position}`)}`,
          '',
          ...body.slice(scroll, scroll + pageSize).map(line => `  ${line}`),
          '',
          `  ${theme.fg('muted', 'esc close · r refresh · ↑↓ scroll')}`,
          border,
        ];
        return lines.map(line => truncateToWidth(line, width));
      },
      handleInput(input: string): void {
        if (matchesKey(input, 'escape') || matchesKey(input, 'ctrl+c')) {
          if (!closed) {
            closed = true;
            done();
          }
          return;
        }
        if (input === 'r' || input === 'R') {
          void load(true);
          return;
        }
        if (matchesKey(input, 'up')) scroll = Math.max(0, scroll - 1);
        else if (matchesKey(input, 'down')) scroll = Math.min(maxScroll, scroll + 1);
        else if (matchesKey(input, 'pageUp')) scroll = Math.max(0, scroll - pageSize);
        else if (matchesKey(input, 'pageDown')) scroll = Math.min(maxScroll, scroll + pageSize);
        else if (matchesKey(input, 'home')) scroll = 0;
        else if (matchesKey(input, 'end')) scroll = maxScroll;
        else return;
        tui.requestRender();
      },
      dispose(): void {
        closed = true;
      },
    };
  }, { overlay: true });
}
