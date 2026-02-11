import { existsSync } from 'fs';
import { Database } from '../core/Database.js';
import { getDbPath, getPeriodDates, type ComparisonMode } from './helpers.js';

export interface DashboardParams {
  siteUrl: string;
  dateRange?: string;
  comparisonMode?: ComparisonMode;
  matchWeekdays?: boolean;
  brandTerms?: string[];
}

export function getDashboardData(params: DashboardParams): any {
  const { siteUrl, dateRange = '3m', comparisonMode = 'previous_period', matchWeekdays = false, brandTerms } = params;
  const dbPath = getDbPath(siteUrl);

  if (!existsSync(dbPath)) {
    throw new Error(`No database found for "${siteUrl}". Run sync_gsc_data first.`);
  }

  const { current, prior } = getPeriodDates(dateRange, undefined, comparisonMode, matchWeekdays);
  const comparisonDisabled = comparisonMode === 'disabled';
  const db = new Database(dbPath);

  try {
    // 1. Summary metrics
    const currentSummary = db.queryOne(`
      SELECT
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(impressions), 0) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
    `, [current.startDate, current.endDate]);

    const priorSummary = db.queryOne(`
      SELECT
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(impressions), 0) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
    `, [prior.startDate, prior.endDate]);

    // 2. Daily trend (with CTR and position for metric toggles)
    const dailyTrend = db.query(`
      SELECT date,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date ASC
    `, [current.startDate, current.endDate]);

    // 2b. Prior period daily trend (for dashed overlay)
    const priorDailyTrend = comparisonDisabled ? [] : db.query(`
      SELECT date,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date ASC
    `, [prior.startDate, prior.endDate]);

    // 3. Top queries with change + CTR + position
    const topQueries = db.query(`
      SELECT query,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as impressions,
        ROUND(CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL) /
          NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4) as ctr,
        ROUND(AVG(CASE WHEN date BETWEEN ? AND ? THEN position ELSE NULL END), 1) as avg_position,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as prior_impressions,
        ROUND(CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL) /
          NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4) as prior_ctr,
        ROUND(AVG(CASE WHEN date BETWEEN ? AND ? THEN position ELSE NULL END), 1) as prior_avg_position,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as clicks_change_pct
      FROM search_analytics
      WHERE query IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)
      GROUP BY query
      HAVING clicks > 0
      ORDER BY clicks DESC
      LIMIT 100
    `, [
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
    ]);

    // 4. Top pages with change + CTR + position
    const topPages = db.query(`
      SELECT page,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as impressions,
        ROUND(CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL) /
          NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4) as ctr,
        ROUND(AVG(CASE WHEN date BETWEEN ? AND ? THEN position ELSE NULL END), 1) as avg_position,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as prior_impressions,
        ROUND(CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL) /
          NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4) as prior_ctr,
        ROUND(AVG(CASE WHEN date BETWEEN ? AND ? THEN position ELSE NULL END), 1) as prior_avg_position,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as clicks_change_pct
      FROM search_analytics
      WHERE page IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)
      GROUP BY page
      HAVING clicks > 0
      ORDER BY clicks DESC
      LIMIT 100
    `, [
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
    ]);

    // 5. Country breakdown
    const countries = db.query(`
      SELECT country,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as impressions,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as prior_impressions,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as clicks_change_pct
      FROM search_analytics
      WHERE country IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)
      GROUP BY country
      HAVING clicks > 0
      ORDER BY clicks DESC
      LIMIT 50
    `, [
      current.startDate, current.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
    ]);

    // 6. Ranking buckets
    const bucketRows = db.query(`
      SELECT query, AVG(position) as avg_pos
      FROM search_analytics
      WHERE date BETWEEN ? AND ? AND query IS NOT NULL
      GROUP BY query
    `, [current.startDate, current.endDate]);

    const bucketCounts: Record<string, number> = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '100+': 0 };
    for (const r of bucketRows) {
      const p = r.avg_pos;
      if (p <= 3) bucketCounts['1-3']++;
      else if (p <= 10) bucketCounts['4-10']++;
      else if (p <= 20) bucketCounts['11-20']++;
      else if (p <= 50) bucketCounts['21-50']++;
      else if (p <= 100) bucketCounts['51-100']++;
      else bucketCounts['100+']++;
    }
    const rankingBuckets = Object.entries(bucketCounts).map(([bucket, count]) => ({ bucket, count }));

    // 7. New queries (in current but not in prior)
    const newQueries = comparisonDisabled ? [] : db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
        AND query IS NOT NULL
        AND query NOT IN (
          SELECT DISTINCT query FROM search_analytics
          WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        )
      GROUP BY query
      HAVING clicks > 0
      ORDER BY clicks DESC
      LIMIT 50
    `, [current.startDate, current.endDate, prior.startDate, prior.endDate]);

    // 8. Lost queries (in prior but not in current)
    const lostQueries = comparisonDisabled ? [] : db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
        AND query IS NOT NULL
        AND query NOT IN (
          SELECT DISTINCT query FROM search_analytics
          WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        )
      GROUP BY query
      HAVING clicks > 0
      ORDER BY clicks DESC
      LIMIT 50
    `, [prior.startDate, prior.endDate, current.startDate, current.endDate]);

    // 9. Branded split (if brandTerms provided)
    let brandedSplit = null;
    if (brandTerms && brandTerms.length > 0) {
      const brandConditions = brandTerms.map(() => 'LOWER(query) LIKE ?').join(' OR ');
      const brandValues = brandTerms.map(t => `%${t.toLowerCase()}%`);

      const splitSummary = db.query(`
        SELECT
          CASE WHEN ${brandConditions} THEN 'branded' ELSE 'non-branded' END as segment,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions
        FROM search_analytics
        WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        GROUP BY segment
      `, [...brandValues, current.startDate, current.endDate]);

      const priorSplitSummary = comparisonDisabled ? [] : db.query(`
        SELECT
          CASE WHEN ${brandConditions} THEN 'branded' ELSE 'non-branded' END as segment,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions
        FROM search_analytics
        WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        GROUP BY segment
      `, [...brandValues, prior.startDate, prior.endDate]);

      const splitTrend = db.query(`
        SELECT date,
          CASE WHEN ${brandConditions} THEN 'branded' ELSE 'non-branded' END as segment,
          SUM(clicks) as clicks
        FROM search_analytics
        WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        GROUP BY date, segment
        ORDER BY date ASC
      `, [...brandValues, current.startDate, current.endDate]);

      brandedSplit = { summary: splitSummary, priorSummary: priorSplitSummary, trend: splitTrend };
    }

    // 10. Last synced timestamp
    const meta = db.getPropertyMeta(siteUrl);
    const lastSyncedAt = meta?.lastSyncedAt ?? null;

    const pctChange = (curr: number, prev: number): number | null =>
      prev === 0 ? null : Math.round(((curr - prev) / prev) * 1000) / 10;

    return {
      siteUrl,
      dateRange,
      comparisonMode,
      matchWeekdays,
      lastSyncedAt,
      period: { current, prior },
      summary: {
        current: {
          clicks: currentSummary.clicks,
          impressions: currentSummary.impressions,
          ctr: currentSummary.ctr,
          avgPosition: currentSummary.avg_position,
        },
        prior: {
          clicks: priorSummary.clicks,
          impressions: priorSummary.impressions,
          ctr: priorSummary.ctr,
          avgPosition: priorSummary.avg_position,
        },
        changes: {
          clicksPct: pctChange(currentSummary.clicks, priorSummary.clicks),
          impressionsPct: pctChange(currentSummary.impressions, priorSummary.impressions),
          ctrPct: pctChange(currentSummary.ctr ?? 0, priorSummary.ctr ?? 0),
          avgPositionPct: pctChange(currentSummary.avg_position ?? 0, priorSummary.avg_position ?? 0),
        },
      },
      dailyTrend,
      priorDailyTrend,
      topQueries,
      topPages,
      countries,
      rankingBuckets,
      newQueries,
      lostQueries,
      brandedSplit,
    };
  } finally {
    db.close();
  }
}
