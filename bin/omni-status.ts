#!/usr/bin/env node
import { fetchUsage } from '../src/api.ts';
import { formatUsageReport } from '../src/formatter.ts';

async function main() {
  const args = process.argv.slice(2);
  const compact = args.includes('-c') || args.includes('--compact');
  const json = args.includes('--json');
  const filterArg = args.find((a) => !a.startsWith('-')) || '';

  try {
    const data = await fetchUsage({ compact, filter: filterArg });

    if (json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(formatUsageReport(data, { compact, filter: filterArg }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31mError:\x1b[0m ${msg}`);
    process.exit(1);
  }
}

main();
