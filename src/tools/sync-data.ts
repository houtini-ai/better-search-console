import { Database } from '../core/Database.js';
import { GscClient } from '../core/GscClient.js';
import { DataSync } from '../core/DataSync.js';
import type { SyncResult } from '../types/index.js';
import { getDbPath, defaultStartDate, defaultEndDate } from './helpers.js';

export interface SyncDataArgs {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video';
}

// Track active syncs to prevent duplicate concurrent syncs
const activeSyncs = new Set<string>();

export async function syncData(
  gscClient: GscClient,
  args: SyncDataArgs,
  signal?: AbortSignal
): Promise<SyncResult> {
  const {
    siteUrl,
    endDate = defaultEndDate(),
    dimensions,
  } = args;

  let { startDate } = args;

  // Prevent duplicate syncs for the same property
  if (activeSyncs.has(siteUrl)) {
    return {
      siteUrl,
      dateFrom: startDate || '',
      dateTo: endDate,
      rowsFetched: 0,
      rowsInserted: 0,
      durationMs: 0,
      status: 'error',
      error: `A sync is already running for ${siteUrl}. Wait for it to complete or restart Claude Desktop to cancel it.`,
    };
  }

  const dbPath = getDbPath(siteUrl);
  const db = new Database(dbPath);
  activeSyncs.add(siteUrl);

  try {
    // Incremental sync: if no explicit start date, resume from last synced date
    if (!startDate) {
      const lastDate = db.getLastSyncDate(siteUrl);
      if (lastDate) {
        const d = new Date(lastDate);
        d.setDate(d.getDate() + 1);
        const nextDay = d.toISOString().slice(0, 10);
        if (nextDay <= endDate) {
          startDate = nextDay;
        } else {
          return {
            siteUrl,
            dateFrom: lastDate,
            dateTo: endDate,
            rowsFetched: 0,
            rowsInserted: 0,
            durationMs: 0,
            status: 'already_current',
          };
        }
      } else {
        startDate = defaultStartDate();
      }
    }

    db.upsertPropertyMeta(siteUrl, 'syncing');

    const sync = new DataSync(db, gscClient);
    const result = await sync.syncProperty(
      siteUrl, startDate, endDate, dimensions, args.searchType, signal
    );

    return result;
  } finally {
    activeSyncs.delete(siteUrl);
    db.close();
  }
}
