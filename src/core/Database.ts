import BetterSqlite3 from 'better-sqlite3';
import type { SearchAnalyticsRow, SyncLogEntry } from '../types/index.js';

export class Database {
  private db: BetterSqlite3.Database;
  private insertStmt: BetterSqlite3.Statement | null = null;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');     // wait up to 5s for concurrent writers
    this.db.pragma('cache_size = -65536');     // 64MB cache (default is ~2MB)
    this.db.pragma('temp_store = MEMORY');     // temp tables in RAM
    this.db.pragma('mmap_size = 4294967296');  // 4GB mmap for large DBs
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS property_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_url TEXT UNIQUE NOT NULL,
        permission_level TEXT,
        last_synced_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        query TEXT,
        page TEXT,
        device TEXT,
        country TEXT,
        search_appearance TEXT,
        clicks INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER NOT NULL DEFAULT 0,
        ctr REAL NOT NULL DEFAULT 0,
        position REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.db.exec(`
      -- Primary uniqueness constraint (also serves as composite index for date-first lookups)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_unique
        ON search_analytics(date, query, page, device, country);

      -- Single-column indexes for standalone filtering
      CREATE INDEX IF NOT EXISTS idx_sa_date ON search_analytics(date);
      CREATE INDEX IF NOT EXISTS idx_sa_query ON search_analytics(query);
      CREATE INDEX IF NOT EXISTS idx_sa_page ON search_analytics(page);
      CREATE INDEX IF NOT EXISTS idx_sa_clicks ON search_analytics(clicks DESC);
      CREATE INDEX IF NOT EXISTS idx_sa_impressions ON search_analytics(impressions DESC);

      -- Composite indexes for dashboard query patterns
      CREATE INDEX IF NOT EXISTS idx_sa_date_query ON search_analytics(date, query, clicks, impressions, position);
      CREATE INDEX IF NOT EXISTS idx_sa_date_page ON search_analytics(date, page, clicks, impressions, position);
      CREATE INDEX IF NOT EXISTS idx_sa_date_country ON search_analytics(date, country, clicks, impressions);
      CREATE INDEX IF NOT EXISTS idx_sa_query_date ON search_analytics(query, date);

      -- Covering index for summary aggregations
      CREATE INDEX IF NOT EXISTS idx_sa_date_metrics ON search_analytics(date, clicks, impressions, ctr, position);
    `);

    // Update query planner statistics only when needed
    // sqlite_stat1 may not exist if ANALYZE has never run, so check safely
    const statExists = this.db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1' LIMIT 1`
    ).get();
    const hasStats = statExists && this.db.prepare(
      `SELECT 1 FROM sqlite_stat1 WHERE tbl = 'search_analytics' AND idx = 'idx_sa_date_metrics' LIMIT 1`
    ).get();
    if (!hasStats) {
      this.db.exec('ANALYZE;');
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_type TEXT NOT NULL,
        dimensions TEXT NOT NULL,
        date_from TEXT,
        date_to TEXT,
        rows_fetched INTEGER DEFAULT 0,
        rows_inserted INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        error_message TEXT,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `);
  }

  // --- Property Meta ---

  upsertPropertyMeta(siteUrl: string, permissionLevel: string): void {
    this.db.prepare(`
      INSERT INTO property_meta (site_url, permission_level)
      VALUES (?, ?)
      ON CONFLICT(site_url) DO UPDATE SET permission_level = excluded.permission_level
    `).run(siteUrl, permissionLevel);
  }

  updateLastSynced(siteUrl: string): void {
    this.db.prepare(`
      UPDATE property_meta SET last_synced_at = datetime('now') WHERE site_url = ?
    `).run(siteUrl);
  }

  getPropertyMeta(siteUrl: string): { siteUrl: string; permissionLevel: string; lastSyncedAt: string | null } | null {
    const row = this.db.prepare(`
      SELECT site_url, permission_level, last_synced_at FROM property_meta WHERE site_url = ?
    `).get(siteUrl) as any;
    if (!row) return null;
    return {
      siteUrl: row.site_url,
      permissionLevel: row.permission_level,
      lastSyncedAt: row.last_synced_at,
    };
  }

  getLastSyncDate(siteUrl: string): string | null {
    const row = this.db.prepare(`
      SELECT MAX(date) as max_date FROM search_analytics
    `).get() as any;
    return row?.max_date ?? null;
  }

  // --- Search Analytics ---

  private getInsertStmt(): BetterSqlite3.Statement {
    if (!this.insertStmt) {
      this.insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO search_analytics
          (date, query, page, device, country, search_appearance, clicks, impressions, ctr, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    return this.insertStmt;
  }

  insertSearchAnalyticsBatch(rows: SearchAnalyticsRow[]): number {
    let inserted = 0;
    const stmt = this.getInsertStmt();
    const transaction = this.db.transaction((rows: SearchAnalyticsRow[]) => {
      for (const row of rows) {
        stmt.run(
          row.date,
          row.query,
          row.page,
          row.device,
          row.country,
          row.searchAppearance,
          row.clicks,
          row.impressions,
          row.ctr,
          row.position
        );
        inserted++;
      }
    });
    transaction(rows);
    return inserted;
  }

  getRowCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM search_analytics').get() as any;
    return result.count;
  }

  getDateRange(): { minDate: string; maxDate: string } | null {
    const result = this.db.prepare(
      'SELECT MIN(date) as min_date, MAX(date) as max_date FROM search_analytics'
    ).get() as any;
    if (!result || !result.min_date) return null;
    return { minDate: result.min_date, maxDate: result.max_date };
  }

  // --- Sync Log ---

  createSyncLog(entry: Omit<SyncLogEntry, 'id' | 'startedAt' | 'completedAt'>): number {
    const result = this.db.prepare(`
      INSERT INTO sync_log (sync_type, dimensions, date_from, date_to, rows_fetched, rows_inserted, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.syncType,
      entry.dimensions,
      entry.dateFrom,
      entry.dateTo,
      entry.rowsFetched,
      entry.rowsInserted,
      entry.status,
      entry.errorMessage
    );
    return Number(result.lastInsertRowid);
  }

  updateSyncLog(id: number, updates: Partial<SyncLogEntry>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.rowsFetched !== undefined) { fields.push('rows_fetched = ?'); values.push(updates.rowsFetched); }
    if (updates.rowsInserted !== undefined) { fields.push('rows_inserted = ?'); values.push(updates.rowsInserted); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage); }
    if (updates.status === 'completed' || updates.status === 'error') {
      fields.push("completed_at = datetime('now')");
    }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE sync_log SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  // --- Raw Query (read-only) ---

  executeReadOnlyQuery(sql: string, params: any[] = [], maxRows: number = 10000): any[] {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA)\b/i;
    if (forbidden.test(sql)) {
      throw new Error('Only SELECT queries are allowed. Write operations and PRAGMA are blocked.');
    }
    // Enforce a result size limit to prevent memory exhaustion
    const hasLimit = /\bLIMIT\b/i.test(sql);
    const safeSql = hasLimit ? sql : `${sql} LIMIT ${maxRows}`;
    return this.db.prepare(safeSql).all(...params);
  }

  // --- Generic query helper for insights ---

  query(sql: string, params: any[] = []): any[] {
    return this.db.prepare(sql).all(...params);
  }

  queryOne(sql: string, params: any[] = []): any {
    return this.db.prepare(sql).get(...params);
  }

  close(): void {
    this.db.close();
  }
}
