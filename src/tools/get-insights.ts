import { existsSync } from 'fs';
import { Database } from '../core/Database.js';
import { getDbPath, getPeriodDates } from './helpers.js';
import type { InsightParams } from '../types/index.js';

type InsightHandler = (db: Database, params: InsightParams, current: { startDate: string; endDate: string }, prior: { startDate: string; endDate: string }) => any;

export function getInsights(params: InsightParams): any {
  const { siteUrl, insight, dateRange = '28d' } = params;
  const dbPath = getDbPath(siteUrl);

  if (!existsSync(dbPath)) {
    throw new Error(`No database found for "${siteUrl}". Run sync_gsc_data first.`);
  }

  const handler = insightHandlers[insight];
  if (!handler) {
    throw new Error(`Unknown insight type: "${insight}". Valid types: ${Object.keys(insightHandlers).join(', ')}`);
  }

  const { current, prior } = getPeriodDates(dateRange);
  const db = new Database(dbPath);
  try {
    return handler(db, params, current, prior);
  } finally {
    db.close();
  }
}

/** Build WHERE clause fragments from common filter params */
function buildFilters(params: InsightParams): { clauses: string[]; values: any[] } {
  const clauses: string[] = [];
  const values: any[] = [];

  if (params.pageFilter) {
    clauses.push('page LIKE ?');
    values.push(`%${params.pageFilter}%`);
  }
  if (params.queryFilter) {
    clauses.push('query LIKE ?');
    values.push(`%${params.queryFilter}%`);
  }
  if (params.device) {
    clauses.push('device = ?');
    values.push(params.device);
  }
  if (params.country) {
    clauses.push('country = ?');
    values.push(params.country);
  }
  return { clauses, values };
}

function filterSQL(params: InsightParams): string {
  const { clauses } = buildFilters(params);
  return clauses.length > 0 ? ' AND ' + clauses.join(' AND ') : '';
}

function filterValues(params: InsightParams): any[] {
  return buildFilters(params).values;
}

// --- Insight Handlers ---

const insightHandlers: Record<string, InsightHandler> = {
  summary: (db, params, current, prior) => {
    const f = filterSQL(params);
    const fv = filterValues(params);

    const currentRow = db.queryOne(`
      SELECT
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(impressions), 0) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${f}
    `, [current.startDate, current.endDate, ...fv]);

    const priorRow = db.queryOne(`
      SELECT
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(impressions), 0) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${f}
    `, [prior.startDate, prior.endDate, ...fv]);

    const pctChange = (curr: number, prev: number): number | null =>
      prev === 0 ? null : Math.round(((curr - prev) / prev) * 1000) / 10;

    return {
      insight: 'summary',
      dateRange: { current, prior },
      current: {
        clicks: currentRow.clicks,
        impressions: currentRow.impressions,
        ctr: currentRow.ctr,
        avgPosition: currentRow.avg_position,
      },
      prior: {
        clicks: priorRow.clicks,
        impressions: priorRow.impressions,
        ctr: priorRow.ctr,
        avgPosition: priorRow.avg_position,
      },
      changes: {
        clicks: currentRow.clicks - priorRow.clicks,
        clicksPct: pctChange(currentRow.clicks, priorRow.clicks),
        impressions: currentRow.impressions - priorRow.impressions,
        impressionsPct: pctChange(currentRow.impressions, priorRow.impressions),
        ctr: currentRow.ctr !== null && priorRow.ctr !== null
          ? Math.round((currentRow.ctr - priorRow.ctr) * 10000) / 10000
          : null,
        ctrPct: currentRow.ctr !== null && priorRow.ctr !== null
          ? pctChange(currentRow.ctr, priorRow.ctr)
          : null,
        avgPosition: currentRow.avg_position !== null && priorRow.avg_position !== null
          ? Math.round((currentRow.avg_position - priorRow.avg_position) * 10) / 10
          : null,
        avgPositionPct: currentRow.avg_position !== null && priorRow.avg_position !== null
          ? pctChange(currentRow.avg_position, priorRow.avg_position)
          : null,
      },
    };
  },

  top_queries: (db, params, current, _prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ? AND query IS NOT NULL${f}
      GROUP BY query
      ORDER BY clicks DESC
      LIMIT ?
    `, [current.startDate, current.endDate, ...fv, limit]);

    return { insight: 'top_queries', dateRange: current, rows };
  },

  top_pages: (db, params, current, _prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT page,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ? AND page IS NOT NULL${f}
      GROUP BY page
      ORDER BY clicks DESC
      LIMIT ?
    `, [current.startDate, current.endDate, ...fv, limit]);

    return { insight: 'top_pages', dateRange: current, rows };
  },

  growing_queries: (db, params, current, prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT query,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as current_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
          - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as click_change,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as pct_change,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as current_impressions,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as prior_impressions
      FROM search_analytics
      WHERE query IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)${f}
      GROUP BY query
      HAVING current_clicks > 0
      ORDER BY click_change DESC
      LIMIT ?
    `, [
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      ...fv,
      limit,
    ]);

    return { insight: 'growing_queries', dateRange: { current, prior }, rows };
  },

  declining_queries: (db, params, current, prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT query,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as current_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
          - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as click_change,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as pct_change,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as current_impressions,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as prior_impressions
      FROM search_analytics
      WHERE query IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)${f}
      GROUP BY query
      HAVING prior_clicks > 0
      ORDER BY click_change ASC
      LIMIT ?
    `, [
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      ...fv,
      limit,
    ]);

    return { insight: 'declining_queries', dateRange: { current, prior }, rows };
  },

  growing_pages: (db, params, current, prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT page,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as current_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
          - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as click_change,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as pct_change
      FROM search_analytics
      WHERE page IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)${f}
      GROUP BY page
      HAVING current_clicks > 0
      ORDER BY click_change DESC
      LIMIT ?
    `, [
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      ...fv,
      limit,
    ]);

    return { insight: 'growing_pages', dateRange: { current, prior }, rows };
  },

  declining_pages: (db, params, current, prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT page,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as current_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
        SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
          - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as click_change,
        ROUND(
          (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
           - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
          * 100.0
          / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
          1
        ) as pct_change
      FROM search_analytics
      WHERE page IS NOT NULL
        AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)${f}
      GROUP BY page
      HAVING prior_clicks > 0
      ORDER BY click_change ASC
      LIMIT ?
    `, [
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      prior.startDate, prior.endDate,
      current.startDate, current.endDate,
      prior.startDate, prior.endDate,
      ...fv,
      limit,
    ]);

    return { insight: 'declining_pages', dateRange: { current, prior }, rows };
  },

  opportunities: (db, params, current, _prior) => {
    const limit = params.limit || 50;
    const minImpressions = params.minImpressions || 100;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ? AND query IS NOT NULL${f}
      GROUP BY query
      HAVING avg_position BETWEEN 4 AND 20
        AND impressions > ?
      ORDER BY impressions DESC
      LIMIT ?
    `, [current.startDate, current.endDate, ...fv, minImpressions, limit]);

    return { insight: 'opportunities', dateRange: current, rows };
  },

  device_breakdown: (db, params, current, _prior) => {
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT device,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${f}
      GROUP BY device
      ORDER BY clicks DESC
    `, [current.startDate, current.endDate, ...fv]);

    return { insight: 'device_breakdown', dateRange: current, rows };
  },

  country_breakdown: (db, params, current, _prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT country,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${f}
      GROUP BY country
      ORDER BY clicks DESC
      LIMIT ?
    `, [current.startDate, current.endDate, ...fv, limit]);

    return { insight: 'country_breakdown', dateRange: current, rows };
  },

  page_queries: (db, params, current, _prior) => {
    const limit = params.limit || 50;
    if (!params.pageFilter) {
      throw new Error('page_queries insight requires the "pageFilter" parameter.');
    }
    const fv: any[] = [];
    let extraFilter = '';
    if (params.device) { extraFilter += ' AND device = ?'; fv.push(params.device); }
    if (params.country) { extraFilter += ' AND country = ?'; fv.push(params.country); }

    const rows = db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE page LIKE ? AND date BETWEEN ? AND ? AND query IS NOT NULL${extraFilter}
      GROUP BY query
      ORDER BY clicks DESC
      LIMIT ?
    `, [`%${params.pageFilter}%`, current.startDate, current.endDate, ...fv, limit]);

    return { insight: 'page_queries', dateRange: current, pageFilter: params.pageFilter, rows };
  },

  query_pages: (db, params, current, _prior) => {
    const limit = params.limit || 50;
    if (!params.queryFilter) {
      throw new Error('query_pages insight requires the "queryFilter" parameter.');
    }
    const fv: any[] = [];
    let extraFilter = '';
    if (params.device) { extraFilter += ' AND device = ?'; fv.push(params.device); }
    if (params.country) { extraFilter += ' AND country = ?'; fv.push(params.country); }

    const rows = db.query(`
      SELECT page,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE query = ? AND date BETWEEN ? AND ? AND page IS NOT NULL${extraFilter}
      GROUP BY page
      ORDER BY avg_position ASC
      LIMIT ?
    `, [params.queryFilter, current.startDate, current.endDate, ...fv, limit]);

    return { insight: 'query_pages', dateRange: current, queryFilter: params.queryFilter, rows };
  },

  daily_trend: (db, params, current, _prior) => {
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT date,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions
      FROM search_analytics
      WHERE date BETWEEN ? AND ?${f}
      GROUP BY date
      ORDER BY date ASC
    `, [current.startDate, current.endDate, ...fv]);

    return { insight: 'daily_trend', dateRange: current, rows };
  },

  new_queries: (db, params, current, prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
        AND query IS NOT NULL${f}
        AND query IN (
          SELECT query FROM search_analytics WHERE date BETWEEN ? AND ? AND query IS NOT NULL
          EXCEPT
          SELECT query FROM search_analytics WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        )
      GROUP BY query
      ORDER BY impressions DESC
      LIMIT ?
    `, [current.startDate, current.endDate, ...fv, current.startDate, current.endDate, prior.startDate, prior.endDate, limit]);

    return { insight: 'new_queries', dateRange: { current, prior }, rows };
  },

  lost_queries: (db, params, current, prior) => {
    const limit = params.limit || 50;
    const f = filterSQL(params);
    const fv = filterValues(params);

    const rows = db.query(`
      SELECT query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ?
        AND query IS NOT NULL${f}
        AND query IN (
          SELECT query FROM search_analytics WHERE date BETWEEN ? AND ? AND query IS NOT NULL
          EXCEPT
          SELECT query FROM search_analytics WHERE date BETWEEN ? AND ? AND query IS NOT NULL
        )
      GROUP BY query
      ORDER BY clicks DESC
      LIMIT ?
    `, [prior.startDate, prior.endDate, ...fv, prior.startDate, prior.endDate, current.startDate, current.endDate, limit]);

    return { insight: 'lost_queries', dateRange: { current, prior }, rows };
  },

  branded_split: (db, params, current, _prior) => {
    if (!params.brandTerms || params.brandTerms.length === 0) {
      throw new Error('branded_split insight requires the "brandTerms" parameter (array of brand terms).');
    }

    const f = filterSQL(params);
    const fv = filterValues(params);

    // Build CASE expression for brand matching
    const brandConditions = params.brandTerms
      .map(() => 'LOWER(query) LIKE ?')
      .join(' OR ');
    const brandValues = params.brandTerms.map((t) => `%${t.toLowerCase()}%`);

    const rows = db.query(`
      SELECT
        CASE WHEN (${brandConditions}) THEN 'branded' ELSE 'non-branded' END as segment,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
        ROUND(AVG(position), 1) as avg_position
      FROM search_analytics
      WHERE date BETWEEN ? AND ? AND query IS NOT NULL${f}
      GROUP BY segment
    `, [...brandValues, current.startDate, current.endDate, ...fv]);

    return { insight: 'branded_split', dateRange: current, brandTerms: params.brandTerms, rows };
  },
};
