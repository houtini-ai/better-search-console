import { existsSync } from 'fs';
import { Database } from '../core/Database.js';
import { getDbPath } from './helpers.js';
import type { ComparePeriodParams } from '../types/index.js';

export function comparePeriods(params: ComparePeriodParams): any {
  const {
    siteUrl,
    period1Start,
    period1End,
    period2Start,
    period2End,
    dimension = 'query',
    limit = 50,
    pageFilter,
  } = params;

  const dbPath = getDbPath(siteUrl);
  if (!existsSync(dbPath)) {
    throw new Error(`No database found for "${siteUrl}". Run sync_gsc_data first.`);
  }

  const validDimensions = ['query', 'page', 'device', 'country'];
  if (!validDimensions.includes(dimension)) {
    throw new Error(`Invalid dimension: "${dimension}". Valid: ${validDimensions.join(', ')}`);
  }

  const db = new Database(dbPath);
  try {
    let pageFilterClause = '';
    const extraValues: any[] = [];
    if (pageFilter) {
      pageFilterClause = ' AND page LIKE ?';
      extraValues.push(`%${pageFilter}%`);
    }

    // Summary totals for each period
    const period1Summary = db.queryOne(`
      SELECT
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(impressions), 0) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${pageFilterClause}
    `, [period1Start, period1End, ...extraValues]);

    const period2Summary = db.queryOne(`
      SELECT
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(impressions), 0) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${pageFilterClause}
    `, [period2Start, period2End, ...extraValues]);

    // Dimension breakdown
    const dimFilter = dimension === 'query' ? ' AND query IS NOT NULL' :
                      dimension === 'page' ? ' AND page IS NOT NULL' : '';

    const rows = db.query(`
      SELECT
        ${dimension} as dimension_value,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as period1_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as period1_impressions,
        ROUND(
          CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL)
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4
        ) as period1_ctr,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as period2_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as period2_impressions,
        ROUND(
          CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL)
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4
        ) as period2_ctr,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
          - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as click_change,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as click_change_pct
      FROM search_analytics
      WHERE (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)${dimFilter}${pageFilterClause}
      GROUP BY ${dimension}
      HAVING period1_clicks > 0 OR period2_clicks > 0
      ORDER BY period2_clicks DESC
      LIMIT ?
    `, [
      // period1 clicks
      period1Start, period1End,
      // period1 impressions
      period1Start, period1End,
      // period1 ctr numerator
      period1Start, period1End,
      // period1 ctr denominator
      period1Start, period1End,
      // period2 clicks
      period2Start, period2End,
      // period2 impressions
      period2Start, period2End,
      // period2 ctr numerator
      period2Start, period2End,
      // period2 ctr denominator
      period2Start, period2End,
      // click_change
      period2Start, period2End,
      period1Start, period1End,
      // click_change_pct numerator
      period2Start, period2End,
      period1Start, period1End,
      // click_change_pct denominator
      period1Start, period1End,
      // WHERE date ranges
      period1Start, period1End,
      period2Start, period2End,
      ...extraValues,
      limit,
    ]);

    const pctChange = (curr: number, prev: number): number | null =>
      prev === 0 ? null : Math.round(((curr - prev) / prev) * 1000) / 10;

    return {
      dimension,
      period1: { startDate: period1Start, endDate: period1End },
      period2: { startDate: period2Start, endDate: period2End },
      summary: {
        period1: period1Summary,
        period2: period2Summary,
        changes: {
          clicks: period2Summary.clicks - period1Summary.clicks,
          clicksPct: pctChange(period2Summary.clicks, period1Summary.clicks),
          impressions: period2Summary.impressions - period1Summary.impressions,
          impressionsPct: pctChange(period2Summary.impressions, period1Summary.impressions),
        },
      },
      rows,
    };
  } finally {
    db.close();
  }
}
