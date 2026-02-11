import { existsSync } from 'fs';
import { Database } from '../core/Database.js';
import { getDbPath } from './helpers.js';

export interface QueryDataArgs {
  siteUrl: string;
  sql: string;
  params?: any[];
}

export interface QueryDataResult {
  columns: string[];
  rows: any[];
  rowCount: number;
}

export function queryData(args: QueryDataArgs): QueryDataResult {
  const { siteUrl, sql, params = [] } = args;
  const dbPath = getDbPath(siteUrl);

  if (!existsSync(dbPath)) {
    throw new Error(`No database found for "${siteUrl}". Run sync_gsc_data first.`);
  }

  const db = new Database(dbPath);
  try {
    const rows = db.executeReadOnlyQuery(sql, params);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows, rowCount: rows.length };
  } finally {
    db.close();
  }
}
