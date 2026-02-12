import BetterSqlite3 from 'better-sqlite3';
import { getDbPath } from '../tools/helpers.js';

/**
 * Default target countries: US, UK, EU member states, Australia, Canada.
 * ISO 3166-1 alpha-3 lowercase codes as used by GSC.
 */
const DEFAULT_TARGET_COUNTRIES = [
  'usa', 'gbr', 'aus', 'can',
  // EU member states
  'deu', 'fra', 'ita', 'esp', 'nld', 'bel', 'aut', 'pol', 'swe', 'prt',
  'che', 'dnk', 'nor', 'fin', 'irl', 'cze', 'hun', 'rou', 'bgr', 'hrv',
  'svk', 'svn', 'ltu', 'lva', 'est', 'lux', 'mlt', 'cyp', 'grc',
];

export interface RetentionPolicy {
  /** Days of recent data to keep in full (all rows). Default: 90 */
  recentDays: number;
  /** For older target-country rows: minimum impressions to keep when clicks=0. Default: 5 */
  targetMinImpressions: number;
  /** For older non-target-country rows: only keep rows with clicks > 0. */
  pruneNonTargetZeroClicks: boolean;
  /** ISO alpha-3 country codes considered "target". */
  targetCountries: string[];
}

export interface PruneResult {
  siteUrl: string;
  rowsBefore: number;
  rowsDeleted: number;
  rowsAfter: number;
  dbSizeBefore: number;
  dbSizeAfter: number;
  vacuumed: boolean;
  durationMs: number;
}

const DEFAULT_POLICY: RetentionPolicy = {
  recentDays: 90,
  targetMinImpressions: 5,
  pruneNonTargetZeroClicks: true,
  targetCountries: DEFAULT_TARGET_COUNTRIES,
};

export class DataRetention {

  /**
   * Apply retention policy to a site's database.
   * 
   * Rules applied to rows OLDER than recentDays:
   * 1. Target countries: delete rows where clicks=0 AND impressions < targetMinImpressions
   * 2. Non-target countries: delete rows where clicks=0
   * 
   * Recent data (last recentDays) is never touched.
   * Rows with clicks > 0 are never deleted regardless of age or country.
   */
  static prune(
    siteUrl: string,
    policy: Partial<RetentionPolicy> = {},
    onProgress?: (message: string) => void
  ): PruneResult {
    const p = { ...DEFAULT_POLICY, ...policy };
    const dbPath = getDbPath(siteUrl);
    const startTime = Date.now();

    const log = (msg: string) => {
      if (onProgress) onProgress(msg);
      console.error(`[Retention] ${msg}`);
    };

    const db = new BetterSqlite3(dbPath);
    db.pragma('journal_mode = WAL');

    try {
      // Measure before
      const pageCountBefore = (db.prepare('PRAGMA page_count').get() as any).page_count;
      const pageSize = (db.prepare('PRAGMA page_size').get() as any).page_size;
      const dbSizeBefore = pageCountBefore * pageSize;
      const rowsBefore = (db.prepare('SELECT COUNT(*) as cnt FROM search_analytics').get() as any).cnt;

      log(`${siteUrl}: ${rowsBefore.toLocaleString()} rows, ${(dbSizeBefore / 1024 / 1024).toFixed(0)} MB`);

      // Calculate cutoff date
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - p.recentDays);
      const cutoffDate = cutoff.toISOString().slice(0, 10);

      log(`Cutoff date: ${cutoffDate} (keeping all data newer than this)`);

      // Build target country placeholders
      const lowerTargets = p.targetCountries.map(c => c.toLowerCase());
      const placeholders = lowerTargets.map(() => '?').join(',');

      // Step 1: Delete old target-country rows with no clicks and low impressions
      const deleteTargetSql = `
        DELETE FROM search_analytics
        WHERE date < ?
          AND clicks = 0
          AND impressions < ?
          AND LOWER(country) IN (${placeholders})
      `;
      const targetParams = [cutoffDate, p.targetMinImpressions, ...lowerTargets];
      const targetResult = db.prepare(deleteTargetSql).run(...targetParams);
      log(`Target countries: deleted ${targetResult.changes.toLocaleString()} low-value rows`);

      // Step 2: Delete old non-target-country rows with no clicks
      let nonTargetDeleted = 0;
      if (p.pruneNonTargetZeroClicks) {
        const deleteNonTargetSql = `
          DELETE FROM search_analytics
          WHERE date < ?
            AND clicks = 0
            AND LOWER(country) NOT IN (${placeholders})
        `;
        const nonTargetParams = [cutoffDate, ...lowerTargets];
        const nonTargetResult = db.prepare(deleteNonTargetSql).run(...nonTargetParams);
        nonTargetDeleted = nonTargetResult.changes;
        log(`Non-target countries: deleted ${nonTargetDeleted.toLocaleString()} zero-click rows`);
      }

      const totalDeleted = (targetResult.changes as number) + nonTargetDeleted;
      const rowsAfter = rowsBefore - totalDeleted;

      log(`Total deleted: ${totalDeleted.toLocaleString()} rows (${rowsAfter.toLocaleString()} remaining)`);

      // Step 3: VACUUM to reclaim disk space
      let vacuumed = false;
      let dbSizeAfter = dbSizeBefore;

      if (totalDeleted > 0) {
        log('Running VACUUM to reclaim disk space (this may take a moment)...');
        db.exec('VACUUM');
        vacuumed = true;

        // Re-run ANALYZE after major changes
        db.exec('ANALYZE');

        const pageCountAfter = (db.prepare('PRAGMA page_count').get() as any).page_count;
        dbSizeAfter = pageCountAfter * pageSize;
        const savedMB = ((dbSizeBefore - dbSizeAfter) / 1024 / 1024).toFixed(0);
        log(`VACUUM complete: ${(dbSizeAfter / 1024 / 1024).toFixed(0)} MB (saved ${savedMB} MB)`);
      } else {
        log('No rows to delete - database is already clean');
      }

      const durationMs = Date.now() - startTime;
      log(`Completed in ${(durationMs / 1000).toFixed(1)}s`);

      return {
        siteUrl,
        rowsBefore,
        rowsDeleted: totalDeleted,
        rowsAfter,
        dbSizeBefore,
        dbSizeAfter,
        vacuumed,
        durationMs,
      };
    } finally {
      db.close();
    }
  }

  /**
   * Preview what a prune would delete without actually deleting anything.
   */
  static preview(
    siteUrl: string,
    policy: Partial<RetentionPolicy> = {}
  ): {
    siteUrl: string;
    totalRows: number;
    wouldDelete: number;
    wouldKeep: number;
    reductionPct: number;
    breakdown: {
      targetLowValue: number;
      nonTargetZeroClick: number;
      recentProtected: number;
    };
  } {
    const p = { ...DEFAULT_POLICY, ...policy };
    const dbPath = getDbPath(siteUrl);
    const db = new BetterSqlite3(dbPath, { readonly: true });

    try {
      const totalRows = (db.prepare('SELECT COUNT(*) as cnt FROM search_analytics').get() as any).cnt;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - p.recentDays);
      const cutoffDate = cutoff.toISOString().slice(0, 10);

      const lowerTargets = p.targetCountries.map(c => c.toLowerCase());
      const placeholders = lowerTargets.map(() => '?').join(',');

      const targetLowValue = (db.prepare(`
        SELECT COUNT(*) as cnt FROM search_analytics
        WHERE date < ? AND clicks = 0 AND impressions < ?
          AND LOWER(country) IN (${placeholders})
      `).get(cutoffDate, p.targetMinImpressions, ...lowerTargets) as any).cnt;

      const nonTargetZeroClick = (db.prepare(`
        SELECT COUNT(*) as cnt FROM search_analytics
        WHERE date < ? AND clicks = 0
          AND LOWER(country) NOT IN (${placeholders})
      `).get(cutoffDate, ...lowerTargets) as any).cnt;

      const recentProtected = (db.prepare(`
        SELECT COUNT(*) as cnt FROM search_analytics WHERE date >= ?
      `).get(cutoffDate) as any).cnt;

      const wouldDelete = targetLowValue + (p.pruneNonTargetZeroClicks ? nonTargetZeroClick : 0);

      return {
        siteUrl,
        totalRows,
        wouldDelete,
        wouldKeep: totalRows - wouldDelete,
        reductionPct: totalRows > 0 ? Math.round((wouldDelete / totalRows) * 100) : 0,
        breakdown: {
          targetLowValue,
          nonTargetZeroClick,
          recentProtected,
        },
      };
    } finally {
      db.close();
    }
  }
}
