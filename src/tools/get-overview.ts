import { existsSync } from 'fs';
import { join } from 'path';
import { GscClient } from '../core/GscClient.js';
import { Database } from '../core/Database.js';
import { sanitizeSiteUrl, getDataDir, getPeriodDates } from './helpers.js';

export interface OverviewParams {
  dateRange?: string;
  sortBy?: 'alpha' | 'clicks' | 'impressions' | 'ctr' | 'position';
  search?: string;
}

interface PropertyOverview {
  siteUrl: string;
  domain: string;
  lastSyncedAt: string | null;
  current: {
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number | null;
  };
  changes: {
    clicksPct: number | null;
    impressionsPct: number | null;
    ctrPct: number | null;
    avgPositionPct: number | null;
  };
  sparkline: Array<{ date: string; clicks: number; impressions: number }>;
}

interface OverviewData {
  dateRange: string;
  sortBy: string;
  properties: PropertyOverview[];
}

export async function getOverviewData(
  gscClient: GscClient,
  params: OverviewParams
): Promise<OverviewData> {
  const { dateRange = '28d', sortBy = 'alpha', search } = params;
  const { current, prior } = getPeriodDates(dateRange);
  const dataDir = getDataDir();

  // Get all properties from GSC API
  const allProperties = await gscClient.listProperties();
  const properties: PropertyOverview[] = [];

  const pctChange = (curr: number, prev: number): number | null =>
    prev === 0 ? null : Math.round(((curr - prev) / prev) * 1000) / 10;

  for (const prop of allProperties) {
    const dbFilename = sanitizeSiteUrl(prop.siteUrl) + '.db';
    const dbPath = join(dataDir, dbFilename);

    // Skip properties without synced data
    if (!existsSync(dbPath)) continue;

    // Extract clean domain
    let domain = prop.siteUrl
      .replace(/^sc-domain:/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    // Filter by search substring
    if (search && !domain.toLowerCase().includes(search.toLowerCase())) continue;

    const db = new Database(dbPath);
    try {
      // Summary for current period
      const currentSummary = db.queryOne(`
        SELECT
          COALESCE(SUM(clicks), 0) as clicks,
          COALESCE(SUM(impressions), 0) as impressions,
          ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
          ROUND(AVG(position), 1) as avg_position
        FROM search_analytics
        WHERE date BETWEEN ? AND ?
      `, [current.startDate, current.endDate]);

      // Summary for prior period
      const priorSummary = db.queryOne(`
        SELECT
          COALESCE(SUM(clicks), 0) as clicks,
          COALESCE(SUM(impressions), 0) as impressions,
          ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
          ROUND(AVG(position), 1) as avg_position
        FROM search_analytics
        WHERE date BETWEEN ? AND ?
      `, [prior.startDate, prior.endDate]);

      // Skip if no data at all
      if (currentSummary.clicks === 0 && currentSummary.impressions === 0 &&
          priorSummary.clicks === 0 && priorSummary.impressions === 0) continue;

      // Daily sparkline data
      const sparkline = db.query(`
        SELECT date,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions
        FROM search_analytics
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [current.startDate, current.endDate]);

      // Last synced
      const meta = db.getPropertyMeta(prop.siteUrl);

      properties.push({
        siteUrl: prop.siteUrl,
        domain,
        lastSyncedAt: meta?.lastSyncedAt ?? null,
        current: {
          clicks: currentSummary.clicks,
          impressions: currentSummary.impressions,
          ctr: currentSummary.ctr ?? 0,
          avgPosition: currentSummary.avg_position ?? null,
        },
        changes: {
          clicksPct: pctChange(currentSummary.clicks, priorSummary.clicks),
          impressionsPct: pctChange(currentSummary.impressions, priorSummary.impressions),
          ctrPct: pctChange(currentSummary.ctr ?? 0, priorSummary.ctr ?? 0),
          avgPositionPct: (currentSummary.avg_position != null && priorSummary.avg_position != null)
            ? pctChange(currentSummary.avg_position, priorSummary.avg_position)
            : null,
        },
        sparkline,
      });
    } finally {
      db.close();
    }
  }

  // Sort
  switch (sortBy) {
    case 'clicks':
      properties.sort((a, b) => b.current.clicks - a.current.clicks);
      break;
    case 'impressions':
      properties.sort((a, b) => b.current.impressions - a.current.impressions);
      break;
    case 'ctr':
      properties.sort((a, b) => b.current.ctr - a.current.ctr);
      break;
    case 'position':
      properties.sort((a, b) => (a.current.avgPosition ?? 999) - (b.current.avgPosition ?? 999)); // lower is better, null sorts last
      break;
    case 'alpha':
    default:
      properties.sort((a, b) => a.domain.localeCompare(b.domain));
      break;
  }

  return { dateRange, sortBy, properties };
}
