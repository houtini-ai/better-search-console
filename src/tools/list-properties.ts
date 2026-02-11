import { existsSync } from 'fs';
import { join } from 'path';
import { GscClient } from '../core/GscClient.js';
import { Database } from '../core/Database.js';
import type { PropertyStatus } from '../types/index.js';
import { sanitizeSiteUrl, getDataDir } from './helpers.js';

export async function listProperties(gscClient: GscClient): Promise<PropertyStatus[]> {
  const properties = await gscClient.listProperties();
  const dataDir = getDataDir();
  const results: PropertyStatus[] = [];

  for (const prop of properties) {
    const dbFilename = sanitizeSiteUrl(prop.siteUrl) + '.db';
    const dbPath = join(dataDir, dbFilename);
    let lastSyncedAt: string | null = null;
    let rowCount: number | null = null;

    if (existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        const meta = db.getPropertyMeta(prop.siteUrl);
        lastSyncedAt = meta?.lastSyncedAt || null;
        rowCount = db.getRowCount();
      } finally {
        db.close();
      }
    }

    results.push({
      siteUrl: prop.siteUrl,
      permissionLevel: prop.permissionLevel,
      lastSyncedAt,
      rowCount,
      dbPath: existsSync(dbPath) ? dbPath : null,
    });
  }

  return results;
}
