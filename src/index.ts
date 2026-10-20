import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@oh-my-pi/pi-coding-agent';
import { fetchUsage, refreshAllConnections } from './api.ts';
import { formatSummaryMarkdown, formatUsageReport, formatWidgetLines } from './formatter.ts';
import { showQuotaPanel } from './panel.ts';
import type { OmniUsageResponse } from './types.ts';

export default function omniStatusExtension(pi: ExtensionAPI): void {
  const z = pi.zod;

  pi.setLabel('OmniRoute Quotas');

  type TimerHandle = unknown;
  let widgetActive = false;
  let widgetTimer: TimerHandle | null = null;

  async function updateWidget(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;
    try {
      const data = await fetchUsage({ compact: true });
      const lines = formatWidgetLines(data, 6);
      ctx.ui.setWidget?.('omni-quota', lines, { placement: 'aboveEditor' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.setWidget?.('omni-quota', [`OmniRoute error: ${msg}`], { placement: 'aboveEditor' });
    }
  }

  function clearWidget(ctx: ExtensionContext): void {
    if (widgetTimer !== null) {
      ctx.clearTimer?.(widgetTimer as Parameters<NonNullable<ExtensionContext['clearTimer']>>[0]);
      widgetTimer = null;
    }
    ctx.ui.setWidget?.('omni-quota', undefined);
    widgetActive = false;
  }

  async function handleOmniCommand(rawArgs: string, ctx: ExtensionCommandContext): Promise<void> {
    const args = rawArgs.trim().split(/\s+/).filter(Boolean);

    if (args.includes('--clear-widget') || args.includes('--no-widget')) {
      clearWidget(ctx);
      ctx.ui.notify('OmniRoute widget disabled.', 'info');
      return;
    }

    if (args.includes('--widget')) {
      widgetActive = true;
      await updateWidget(ctx);
      if (ctx.setInterval) {
        widgetTimer = ctx.setInterval(() => {
          void updateWidget(ctx);
        }, 60000);
      }
      ctx.ui.notify('OmniRoute widget enabled above editor (updates every 60s).', 'info');
      return;
    }

    const doRefresh = args.includes('-r') || args.includes('--refresh') || args.includes('refresh');
    const compact = !args.includes('-a') && !args.includes('--all') && !args.includes('--full');
    const raw = args.includes('--raw') || args.includes('--ansi');
    const filter = args.find((a) => !a.startsWith('-') && a !== 'refresh') || '';

    try {
      if (ctx.mode === 'tui') {
        await showQuotaPanel(ctx, { compact, filter }, doRefresh);
        return;
      }
      if (doRefresh) {
        ctx.ui.notify('Refreshing OmniRoute upstream quotas...', 'info');
        await refreshAllConnections();
      }

      const data: OmniUsageResponse = await fetchUsage({ compact, filter });
      const content = raw
        ? formatUsageReport(data, { compact, filter })
        : formatSummaryMarkdown(data, { compact, filter });

      pi.sendMessage(
        {
          customType: 'omni-quota-report',
          content,
          display: true,
          attribution: 'agent',
        },
        { triggerTurn: false }
      );

      const activeBadge = data.allowed ? 'active' : 'restricted';
      ctx.ui.notify(`OmniRoute quotas updated (${activeBadge})`, 'info');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`OmniRoute status failed: ${msg}`, 'error');
    }
  }

  // Register /omni and /quota slash commands
  pi.registerCommand('omni', {
    description: 'Open quota panel (Esc closes, r refreshes; --all shows every model)',
    handler: handleOmniCommand,
  });

  pi.registerCommand('quota', {
    description: 'Alias for /omni',
    handler: handleOmniCommand,
  });

  // Register LLM-callable tool
  pi.registerTool({
    name: 'omni_status',
    label: 'OmniRoute Quotas',
    description:
      'Check current model and provider quota limits, token balances and reset countdowns from OmniRoute. Use before running heavy token workflows or when encountering rate limits.',
    parameters: z.object({
      provider: z.string().optional().describe('Filter by provider name (e.g. codex, agy)'),
      compact: z.boolean().optional().default(true).describe('Collapse identical quota pools into compact summary'),
      refresh: z.boolean().optional().describe('Force refresh upstream provider quotas before reading'),
      format: z.enum(['markdown', 'text', 'json']).optional().default('markdown').describe('Output format'),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        if (params.refresh) {
          await refreshAllConnections();
        }
        const filter = params.provider || '';
        const compact = params.compact ?? true;
        const data = await fetchUsage({ compact, filter });

        if (params.format === 'json') {
          return {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            details: { allowed: data.allowed, providersCount: data.providers?.length ?? (data.provider ? 1 : 0) },
          };
        }

        if (params.format === 'text') {
          const report = formatUsageReport(data, { compact, filter });
          return {
            content: [{ type: 'text', text: report }],
            details: { allowed: data.allowed },
          };
        }

        const md = formatSummaryMarkdown(data, { compact, filter });
        return {
          content: [{ type: 'text', text: md }],
          details: { allowed: data.allowed },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to fetch OmniRoute quotas: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  });

  // Cleanup on session shutdown
  pi.on('session_shutdown', () => {
    if (widgetTimer !== null) {
      widgetTimer = null;
    }
  });
}
