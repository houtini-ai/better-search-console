import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';

import { GscClient } from './core/GscClient.js';
import { SyncManager } from './core/SyncManager.js';
import { DataRetention } from './core/DataRetention.js';
import { listProperties } from './tools/list-properties.js';
import { queryData } from './tools/query-data.js';
import { getInsights } from './tools/get-insights.js';
import { comparePeriods } from './tools/compare-periods.js';
import { getDashboardData } from './tools/get-dashboard.js';
import { getOverviewData } from './tools/get-overview.js';
import { asciiSparkline, formatCompact, formatChange } from './tools/helpers.js';

const SERVER_NAME = 'better-search-console';
const SERVER_VERSION = '0.3.0';

export function createServer(): { server: McpServer; run: () => Promise<void> } {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. See README for setup instructions.');
  }

  const gscClient = new GscClient(credentialsPath);
  const syncManager = new SyncManager(gscClient);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
  );

  // ============================================================
  // Resource URIs (declared upfront for tool registrations)
  // ============================================================
  const syncResourceUri = 'ui://sync/progress.html';
  const dashboardResourceUri = 'ui://dashboard/main.html';
  const overviewResourceUri = 'ui://dashboard/overview.html';

  // ============================================================
  // Tool 1: setup — FIRST-RUN EXPERIENCE
  // ============================================================
  // This is deliberately registered first so it appears at the top
  // of the tool list. It orchestrates: list → sync all → overview.

  registerAppTool(
    server,
    'setup',
    {
      title: 'Setup — First Run',
      description: 'First time? Start here. Connects to Google Search Console, syncs all your properties (fetches up to 3 months of data), and shows a visual overview of every site. Takes a few minutes depending on how many properties you have. After setup, use get_overview to see all sites at a glance, or get_dashboard to drill into one.',
      inputSchema: {},
      _meta: { ui: { resourceUri: overviewResourceUri } },
    },
    async () => {
      try {
        // Step 1: List properties to show what we found
        const properties = await listProperties(gscClient);

        if (properties.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No Google Search Console properties found. Check that the service account has been granted access to your GSC properties. See: https://search.google.com/search-console/users',
            }],
          };
        }

        const propertyNames = properties.map(p => p.siteUrl);
        const alreadySynced = properties.filter(p => p.lastSyncedAt);
        const needsSync = properties.filter(p => !p.lastSyncedAt);

        // Step 2: Start syncing all properties
        const jobId = await syncManager.startSyncAll({});

        // Step 3: Wait for sync to complete (poll every 2s, timeout after 10 min)
        const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
        const setupStart = Date.now();
        let status = syncManager.getStatus(jobId) as any;
        while (status.status === 'queued' || status.status === 'syncing') {
          if (Date.now() - setupStart > SETUP_TIMEOUT_MS) {
            console.error('[BSC] Setup sync timed out after 10 minutes');
            syncManager.cancelJob(jobId);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          status = syncManager.getStatus(jobId) as any;
        }

        // Step 4: Generate the overview
        const overviewData = await getOverviewData(gscClient, { dateRange: '3m', sortBy: 'clicks' });

        // Build a helpful text summary
        const lines: string[] = [
          `Setup complete! Found ${properties.length} properties, synced ${status.completedProperties}.`,
          '',
        ];

        if (status.error) {
          lines.push(`Note: ${status.error}`, '');
        }

        for (const p of overviewData.properties) {
          const spark = asciiSparkline(p.sparkline.map((s: any) => s.clicks));
          lines.push(
            `${p.domain}`,
            `  Clicks: ${formatCompact(p.current.clicks)} (${formatChange(p.changes.clicksPct)})  |  Impressions: ${formatCompact(p.current.impressions)} (${formatChange(p.changes.impressionsPct)})  |  CTR: ${(p.current.ctr * 100).toFixed(1)}%  |  Pos: ${p.current.avgPosition != null ? p.current.avgPosition.toFixed(1) : 'n/a'}`,
            `  Trend: ${spark}`,
            '',
          );
        }

        lines.push(
          '---',
          'What would you like to do next?',
          '',
          '- **See a dashboard** for any property above (e.g. get_dashboard for your top site)',
          '- **Find opportunities** — queries ranking on page 2 that could reach page 1',
          '- **Compare periods** — see what changed between two date ranges',
          '- **Run a custom SQL query** against any property\'s data',
          '- **Get insights** — pre-built reports like top queries, growing/declining pages, device breakdown',
        );

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: overviewData as any,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 2: get_overview — ALL SITES AT A GLANCE
  // ============================================================

  registerAppTool(
    server,
    'get_overview',
    {
      title: 'All Properties Overview',
      description: 'See all your sites at a glance. Shows an interactive grid of every synced GSC property with clicks, impressions, CTR, position, percentage changes, and sparkline trends. Click any property card to open its full dashboard. If no data appears, run setup first to sync your properties.',
      inputSchema: {
        dateRange: z.string().optional().describe('Date range: "7d", "28d", "3m", "6m", "12m", "16m". Default: "28d".'),
        sortBy: z.enum(['alpha', 'clicks', 'impressions', 'ctr', 'position']).optional().describe('Sort order for property cards. Default: "alpha".'),
        search: z.string().optional().describe('Filter properties by domain name substring.'),
      },
      _meta: { ui: { resourceUri: overviewResourceUri } },
    },
    async (args) => {
      try {
        const data = await getOverviewData(gscClient, args);

        if (data.properties.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No synced properties found. Run setup to connect and sync your Google Search Console properties.',
            }],
            structuredContent: data as any,
          };
        }

        const lines: string[] = [
          `GSC Overview: ${data.properties.length} properties (${data.dateRange})`,
          '',
        ];

        for (const p of data.properties) {
          const spark = asciiSparkline(p.sparkline.map((s: any) => s.clicks));
          lines.push(
            `${p.domain}`,
            `  Clicks: ${formatCompact(p.current.clicks)} (${formatChange(p.changes.clicksPct)})  |  Impressions: ${formatCompact(p.current.impressions)} (${formatChange(p.changes.impressionsPct)})  |  CTR: ${(p.current.ctr * 100).toFixed(1)}%  |  Pos: ${p.current.avgPosition != null ? p.current.avgPosition.toFixed(1) : 'n/a'}`,
            `  Trend: ${spark}`,
            `  siteUrl: ${p.siteUrl}`,
            '',
          );
        }

        lines.push('Use get_dashboard with a siteUrl above to drill into any property.');

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: data as any,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 3: get_dashboard — DEEP DIVE INTO ONE SITE
  // ============================================================

  registerAppTool(
    server,
    'get_dashboard',
    {
      title: 'Search Console Dashboard',
      description: 'Drill into a single property. Shows an interactive dashboard with hero metrics, trend chart, top queries, top pages, country breakdown, ranking distribution, new/lost queries, and branded split. Use the siteUrl from get_overview results. Requires synced data — run setup first if needed.',
      inputSchema: {
        siteUrl: z.string().describe('GSC property URL, e.g. "sc-domain:example.com". Get this from the overview or list_properties.'),
        dateRange: z.string().optional().describe('Date range: "7d", "28d", "3m", "6m", "12m", "16m", or named presets: "lw", "tm", "lm", "tq", "lq", "ytd". Default: "3m".'),
        comparisonMode: z.enum(['previous_period', 'year_over_year', 'previous_month', 'disabled']).optional().describe('Comparison mode. Default: "previous_period".'),
        matchWeekdays: z.boolean().optional().describe('Align comparison period to match weekday patterns. Default: false.'),
        brandTerms: z.array(z.string()).optional().describe('Brand terms for branded/non-branded split (e.g. ["mysite", "my site"]).'),
      },
      _meta: { ui: { resourceUri: dashboardResourceUri } },
    },
    async (args) => {
      try {
        const data = getDashboardData(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 4: get_insights — PRE-BUILT REPORTS
  // ============================================================

  server.tool(
    'get_insights',
    'Run pre-built analytical queries against synced GSC data. Choose from 16 insight types: summary, top_queries, top_pages, growing_queries, declining_queries, growing_pages, declining_pages, opportunities (queries ranking 5-20 with high impressions — your quick wins), device_breakdown, country_breakdown, page_queries, query_pages, daily_trend, new_queries, lost_queries, branded_split. Requires synced data — run setup first if needed.',
    {
      siteUrl: z.string().describe('GSC property URL.'),
      insight: z.enum([
        'summary', 'top_queries', 'top_pages',
        'growing_queries', 'declining_queries',
        'growing_pages', 'declining_pages',
        'opportunities', 'device_breakdown', 'country_breakdown',
        'page_queries', 'query_pages', 'daily_trend',
        'new_queries', 'lost_queries', 'branded_split',
      ]).describe('Insight type to run.'),
      dateRange: z.string().optional().describe('Date range: "7d", "28d", "3m", "6m", "12m", "16m". Default: "28d".'),
      pageFilter: z.string().optional().describe('Filter by URL path (uses LIKE). e.g. "/blog/"'),
      queryFilter: z.string().optional().describe('Filter by query text (uses LIKE).'),
      device: z.string().optional().describe('Filter by device: DESKTOP, MOBILE, TABLET.'),
      country: z.string().optional().describe('Filter by ISO country code.'),
      brandTerms: z.array(z.string()).optional().describe('Brand terms for branded_split insight.'),
      limit: z.number().optional().describe('Max rows returned. Default: 50.'),
      minClicks: z.number().optional().describe('Minimum clicks threshold.'),
      minImpressions: z.number().optional().describe('Minimum impressions threshold.'),
    },
    async (args) => {
      try {
        const result = getInsights(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );



  // ============================================================
  // Tool 5: compare_periods — DATE RANGE COMPARISON
  // ============================================================

  server.tool(
    'compare_periods',
    'Compare two arbitrary date ranges side-by-side across any dimension (query, page, device, country). Shows absolute and percentage changes. Useful for before/after analysis, seasonal comparisons, or measuring the impact of changes. Requires synced data — run setup first if needed.',
    {
      siteUrl: z.string().describe('GSC property URL.'),
      period1Start: z.string().describe('Period 1 start date (YYYY-MM-DD).'),
      period1End: z.string().describe('Period 1 end date (YYYY-MM-DD).'),
      period2Start: z.string().describe('Period 2 start date (YYYY-MM-DD).'),
      period2End: z.string().describe('Period 2 end date (YYYY-MM-DD).'),
      dimension: z.enum(['query', 'page', 'device', 'country']).optional().describe('Dimension to group by. Default: "query".'),
      limit: z.number().optional().describe('Max rows. Default: 50.'),
      pageFilter: z.string().optional().describe('Filter by URL path (uses LIKE).'),
    },
    async (args) => {
      try {
        const result = comparePeriods(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  // ============================================================
  // Tool 6: query_gsc_data — CUSTOM SQL QUERIES
  // ============================================================

  server.tool(
    'query_gsc_data',
    'Run a read-only SQL query against a synced GSC property database. Supports any SELECT query. INSERT/UPDATE/DELETE/DROP/ALTER/CREATE are blocked. The table is "search_analytics" with columns: date, query, page, device, country, clicks, impressions, ctr, position. Requires synced data — run setup first if needed.',
    {
      siteUrl: z.string().describe('GSC property URL.'),
      sql: z.string().describe('SQL SELECT query to run against the search_analytics table.'),
      params: z.array(z.any()).optional().describe('Optional parameterised query values.'),
    },
    async (args) => {
      try {
        const result = queryData(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  // ============================================================
  // Tool 7: list_properties — CHECK AVAILABLE PROPERTIES
  // ============================================================

  server.tool(
    'list_properties',
    'List all Google Search Console properties accessible via the service account, with permission level and local sync status. Usually not needed — setup handles this automatically.',
    {},
    async () => {
      try {
        const properties = await listProperties(gscClient);
        return { content: [{ type: 'text', text: JSON.stringify(properties, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  // ============================================================
  // Tool 8: sync_gsc_data — SYNC A SINGLE PROPERTY
  // ============================================================

  registerAppTool(
    server,
    'sync_gsc_data',
    {
      title: 'Sync Property Data',
      description: 'Fetch Google Search Console search analytics data into a local SQLite database. Supports full pagination to capture ALL rows (no 1,000-row limit). Default date range is 3 months. Pass explicit startDate for longer ranges (up to 16 months). Returns immediately with a job ID — use check_sync_status to monitor progress.',
      inputSchema: {
        siteUrl: z.string().describe('GSC property URL, e.g. "sc-domain:example.com" or "https://www.example.com/"'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD). Defaults to 3 months ago.'),
        endDate: z.string().optional().describe('End date (YYYY-MM-DD). Defaults to today.'),
        dimensions: z.array(z.string()).optional().describe('Dimensions to fetch. Defaults to ["query","page","date","device","country"].'),
        searchType: z.enum(['web', 'discover', 'googleNews', 'image', 'video']).optional().describe('Search type filter. Default: web.'),
      },
      _meta: { ui: { resourceUri: syncResourceUri } },
    },
    async (args: any) => {
      try {
        const jobId = syncManager.startSync(args);
        const status = syncManager.getStatus(jobId);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          structuredContent: status as any,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 9: sync_all_properties — SYNC EVERYTHING
  // ============================================================

  registerAppTool(
    server,
    'sync_all_properties',
    {
      title: 'Sync All Properties',
      description: 'Sync search analytics data for ALL accessible GSC properties in one call. Syncs up to 2 properties in parallel for faster completion. Returns immediately with a job ID — use check_sync_status to monitor progress.',
      inputSchema: {
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD). Defaults to 3 months ago (or incremental from last sync).'),
        endDate: z.string().optional().describe('End date (YYYY-MM-DD). Defaults to today.'),
        dimensions: z.array(z.string()).optional().describe('Dimensions to fetch. Defaults to ["query","page","date","device","country"].'),
        searchType: z.enum(['web', 'discover', 'googleNews', 'image', 'video']).optional().describe('Search type filter. Default: web.'),
      },
      _meta: { ui: { resourceUri: syncResourceUri } },
    },
    async (args: any) => {
      try {
        const jobId = await syncManager.startSyncAll(args);
        const status = syncManager.getStatus(jobId);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          structuredContent: status as any,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 10: check_sync_status — MONITOR SYNC PROGRESS
  // ============================================================

  server.tool(
    'check_sync_status',
    'Check the status of a background sync job. If no jobId provided, returns all active and recent jobs. Use after sync_gsc_data or sync_all_properties to monitor progress.',
    {
      jobId: z.string().optional().describe('Job ID from sync_gsc_data or sync_all_properties. Omit to see all jobs.'),
    },
    async (args) => {
      try {
        const status = syncManager.getStatus(args.jobId);
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  // ============================================================
  // Tool 11: cancel_sync — STOP A SYNC
  // ============================================================

  server.tool(
    'cancel_sync',
    'Cancel a running sync job. The job will stop gracefully after completing the current API call.',
    {
      jobId: z.string().describe('Job ID to cancel.'),
    },
    async (args) => {
      try {
        const cancelled = syncManager.cancelJob(args.jobId);
        if (cancelled) {
          const status = syncManager.getStatus(args.jobId);
          return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Job ${args.jobId} not found or already finished.` }) }], isError: true };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  // ============================================================
  // Tool 12: prune_database — APPLY RETENTION POLICY
  // ============================================================

  server.tool(
    'prune_database',
    'Apply data retention policy to a synced property database. Removes low-value rows (zero clicks, low impressions) from older data while preserving all recent data and actionable historical data. Runs VACUUM afterwards to reclaim disk space. This runs automatically after each sync, but you can also trigger it manually. Use preview_prune first to see what would be deleted.',
    {
      siteUrl: z.string().describe('GSC property URL to prune.'),
      recentDays: z.number().optional().describe('Days of recent data to keep in full (default: 90).'),
      targetMinImpressions: z.number().optional().describe('For target countries: min impressions to keep zero-click rows (default: 5).'),
      preview: z.boolean().optional().describe('If true, show what would be deleted without actually deleting. Default: false.'),
    },
    async (args) => {
      try {
        const policy: any = {};
        if (args.recentDays !== undefined) policy.recentDays = args.recentDays;
        if (args.targetMinImpressions !== undefined) policy.targetMinImpressions = args.targetMinImpressions;

        if (args.preview) {
          const preview = DataRetention.preview(args.siteUrl, policy);
          const lines = [
            `Prune preview for ${args.siteUrl}:`,
            `  Total rows: ${preview.totalRows.toLocaleString()}`,
            `  Would delete: ${preview.wouldDelete.toLocaleString()} (${preview.reductionPct}%)`,
            `  Would keep: ${preview.wouldKeep.toLocaleString()}`,
            '',
            'Breakdown:',
            `  Target country low-value rows: ${preview.breakdown.targetLowValue.toLocaleString()}`,
            `  Non-target country zero-click rows: ${preview.breakdown.nonTargetZeroClick.toLocaleString()}`,
            `  Recent rows (protected): ${preview.breakdown.recentProtected.toLocaleString()}`,
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        const result = DataRetention.prune(args.siteUrl, policy);
        const lines = [
          `Prune completed for ${args.siteUrl}:`,
          `  Rows before: ${result.rowsBefore.toLocaleString()}`,
          `  Rows deleted: ${result.rowsDeleted.toLocaleString()}`,
          `  Rows after: ${result.rowsAfter.toLocaleString()}`,
          `  DB size: ${(result.dbSizeBefore / 1024 / 1024).toFixed(0)} MB -> ${(result.dbSizeAfter / 1024 / 1024).toFixed(0)} MB`,
          `  Space saved: ${((result.dbSizeBefore - result.dbSizeAfter) / 1024 / 1024).toFixed(0)} MB`,
          `  Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
          result.vacuumed ? '  VACUUM: completed' : '  VACUUM: skipped (no changes)',
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  // ============================================================
  // Resources — HTML UIs served to ext-apps iframes
  // ============================================================

  // Dashboard UI Resource
  registerAppResource(
    server,
    'Dashboard View',
    dashboardResourceUri,
    {},
    async () => {
      const htmlPath = path.join(
        path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'),
        'src', 'ui', 'dashboard.html'
      );
      const html = await fs.readFile(htmlPath, 'utf-8');
      return {
        contents: [{
          uri: dashboardResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
        }],
      };
    }
  );

  // Overview UI Resource
  registerAppResource(
    server,
    'Overview Grid',
    overviewResourceUri,
    {},
    async () => {
      const htmlPath = path.join(
        path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'),
        'overview', 'src', 'ui', 'overview.html'
      );
      const html = await fs.readFile(htmlPath, 'utf-8');
      return {
        contents: [{
          uri: overviewResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
        }],
      };
    }
  );

  // Sync Progress UI Resource
  registerAppResource(
    server,
    'Sync Progress',
    syncResourceUri,
    {},
    async () => {
      const htmlPath = path.join(
        path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'),
        'sync-progress', 'src', 'ui', 'sync-progress.html'
      );
      const html = await fs.readFile(htmlPath, 'utf-8');
      return {
        contents: [{
          uri: syncResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
        }],
      };
    }
  );

  // ============================================================
  // Server startup
  // ============================================================

  const run = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
  };

  return { server, run };
}
