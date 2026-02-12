import { randomUUID } from 'node:crypto';
import { GscClient } from './GscClient.js';
import { Database } from './Database.js';
import { DataRetention } from './DataRetention.js';
import { getDbPath, defaultStartDate, defaultEndDate } from '../tools/helpers.js';
import type { SearchAnalyticsRow } from '../types/index.js';

// Concurrency limits
const CHUNK_CONCURRENCY = 3;   // parallel date-range chunks per property
const PROPERTY_CONCURRENCY = 2; // parallel properties in sync_all

const CHUNK_DAYS = 90;
const DEFAULT_DIMS = ['query', 'page', 'date', 'device', 'country'];

export type SyncJobStatus = 'queued' | 'syncing' | 'completed' | 'failed' | 'cancelled';

export interface SyncJobResult {
  siteUrl: string;
  status: 'completed' | 'failed' | 'skipped' | 'cancelled';
  rowsFetched: number;
  rowsInserted: number;
  durationMs: number;
  error?: string;
  pruned?: {
    rowsDeleted: number;
    rowsAfter: number;
    spaceSavedMB: number;
  };
}

export interface SyncStatus {
  jobId: string;
  status: SyncJobStatus;
  totalProperties: number;
  completedProperties: number;
  currentProperty: string | null;
  rowsFetched: number;
  estimatedTotalRows: number | null;
  apiCallsMade: number;
  startedAt: string;
  elapsedMs: number;
  results: SyncJobResult[];
  error?: string;
}

interface SyncJob {
  id: string;
  status: SyncJobStatus;
  cancelled: boolean;
  properties: Array<{
    siteUrl: string;
    startDate?: string;
    endDate?: string;
    dimensions?: string[];
    searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video';
  }>;
  totalProperties: number;
  completedProperties: number;
  currentProperty: string | null;
  rowsFetched: number;
  estimatedTotalRows: number | null;
  apiCallsMade: number;
  startedAt: number;
  results: SyncJobResult[];
  error?: string;
}

const MAX_JOB_HISTORY = 50;

export class SyncManager {
  private jobs = new Map<string, SyncJob>();
  private jobOrder: string[] = [];

  constructor(private gscClient: GscClient) {}

  startSync(args: {
    siteUrl: string;
    startDate?: string;
    endDate?: string;
    dimensions?: string[];
    searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video';
  }): string {
    const job = this.createJob([args]);
    this.runJob(job);
    return job.id;
  }

  async startSyncAll(args: {
    startDate?: string;
    endDate?: string;
    dimensions?: string[];
    searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video';
  }): Promise<string> {
    const properties = await this.gscClient.listProperties();
    const propertyArgs = properties.map(p => ({
      siteUrl: p.siteUrl,
      startDate: args.startDate,
      endDate: args.endDate,
      dimensions: args.dimensions,
      searchType: args.searchType,
    }));
    const job = this.createJob(propertyArgs);
    this.runJob(job);
    return job.id;
  }

  getStatus(jobId?: string): SyncStatus | SyncStatus[] {
    if (jobId) {
      const job = this.jobs.get(jobId);
      if (!job) {
        return {
          jobId,
          status: 'failed',
          totalProperties: 0,
          completedProperties: 0,
          currentProperty: null,
          rowsFetched: 0,
          estimatedTotalRows: null,
          apiCallsMade: 0,
          startedAt: '',
          elapsedMs: 0,
          results: [],
          error: `Job ${jobId} not found. It may have expired from history.`,
        };
      }
      return this.jobToStatus(job);
    }
    return this.jobOrder.map(id => this.jobToStatus(this.jobs.get(id)!));
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }
    job.cancelled = true;
    job.status = 'cancelled';
    return true;
  }

  // --- Private ---

  private createJob(properties: SyncJob['properties']): SyncJob {
    const id = randomUUID().slice(0, 8);
    const job: SyncJob = {
      id,
      status: 'queued',
      cancelled: false,
      properties,
      totalProperties: properties.length,
      completedProperties: 0,
      currentProperty: null,
      rowsFetched: 0,
      estimatedTotalRows: null,
      apiCallsMade: 0,
      startedAt: Date.now(),
      results: [],
    };

    this.jobs.set(id, job);
    this.jobOrder.push(id);
    this.pruneHistory();
    return job;
  }

  private pruneHistory(): void {
    while (this.jobOrder.length > MAX_JOB_HISTORY) {
      const oldId = this.jobOrder.shift()!;
      const oldJob = this.jobs.get(oldId);
      if (oldJob && (oldJob.status === 'completed' || oldJob.status === 'failed' || oldJob.status === 'cancelled')) {
        this.jobs.delete(oldId);
      } else {
        this.jobOrder.unshift(oldId);
        break;
      }
    }
  }

  /**
   * Run the job in the background with parallel property syncing.
   * Up to PROPERTY_CONCURRENCY properties sync concurrently.
   */
  private async runJob(job: SyncJob): Promise<void> {
    job.status = 'syncing';

    const activeProperties = new Set<string>();

    const syncProperty = async (prop: SyncJob['properties'][0]): Promise<void> => {
      if (job.cancelled) return;

      activeProperties.add(prop.siteUrl);
      job.currentProperty = [...activeProperties].join(', ');
      const propStart = Date.now();

      try {
        const result = await this.syncOneProperty(job, prop);
        job.results.push(result);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        job.results.push({
          siteUrl: prop.siteUrl,
          status: 'failed',
          rowsFetched: 0,
          rowsInserted: 0,
          durationMs: Date.now() - propStart,
          error: errorMessage,
        });
      }

      job.completedProperties++;
      activeProperties.delete(prop.siteUrl);
      job.currentProperty = activeProperties.size > 0 ? [...activeProperties].join(', ') : null;
    };

    await runWithConcurrency(job.properties, PROPERTY_CONCURRENCY, syncProperty);

    job.currentProperty = null;

    if (job.cancelled) {
      job.status = 'cancelled';
    } else {
      const anyFailed = job.results.some(r => r.status === 'failed');
      const allFailed = job.results.length > 0 && job.results.every(r => r.status === 'failed');
      job.status = allFailed ? 'failed' : 'completed';
      if (anyFailed && !allFailed) {
        const failCount = job.results.filter(r => r.status === 'failed').length;
        job.error = `${failCount} of ${job.totalProperties} properties failed`;
      }
    }
  }

  /**
   * Sync a single property with parallel chunk fetching.
   * Up to CHUNK_CONCURRENCY date-range chunks fetch concurrently.
   * Each chunk's DB writes are serialized (SQLite is single-writer)
   * but API fetches overlap.
   */
  private async syncOneProperty(
    job: SyncJob,
    prop: SyncJob['properties'][0]
  ): Promise<SyncJobResult> {
    const {
      siteUrl,
      endDate = defaultEndDate(),
      dimensions,
    } = prop;

    let startDate = prop.startDate;
    const dbPath = getDbPath(siteUrl);
    const db = new Database(dbPath);
    let dbClosed = false;

    try {
      // Incremental sync: resume from last synced date if no explicit start
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
              status: 'skipped',
              rowsFetched: 0,
              rowsInserted: 0,
              durationMs: 0,
            };
          }
        } else {
          startDate = defaultStartDate();
        }
      }

      db.upsertPropertyMeta(siteUrl, 'syncing');

      const abortController = new AbortController();
      const checkCancel = setInterval(() => {
        if (job.cancelled) abortController.abort();
      }, 500);

      const propStartTime = Date.now();
      let propRowsFetched = 0;
      let propRowsInserted = 0;

      try {
        const dims = dimensions || DEFAULT_DIMS;

        const daySpan = daysBetween(startDate, endDate);
        const chunks = daySpan > CHUNK_DAYS
          ? buildChunks(startDate, endDate)
          : [{ from: startDate, to: endDate }];

        console.error(`[Sync] ${siteUrl}: ${startDate} → ${endDate} (${chunks.length} chunk${chunks.length > 1 ? 's' : ''}, concurrency ${Math.min(chunks.length, CHUNK_CONCURRENCY)})`);

        const syncLogId = db.createSyncLog({
          syncType: 'search_analytics',
          dimensions: dims.join(','),
          dateFrom: startDate,
          dateTo: endDate,
          rowsFetched: 0,
          rowsInserted: 0,
          status: 'running',
          errorMessage: null,
        });

        // Fetch chunks in parallel, but serialize DB writes per chunk
        await runWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk) => {
          if (job.cancelled) return;

          // Fetch all pages for this chunk from the API
          const chunkRows: SearchAnalyticsRow[] = [];

          await this.gscClient.fetchSearchAnalytics(
            siteUrl,
            {
              startDate: chunk.from,
              endDate: chunk.to,
              dimensions: dims,
              ...(prop.searchType ? { searchType: prop.searchType } : {}),
            },
            abortController.signal,
            (page) => {
              const dbRows = page.rows.map(row => transformRow(row, dims));
              chunkRows.push(...dbRows);
              job.apiCallsMade++;

              if (page.rows.length === 25000) {
                job.estimatedTotalRows = (job.estimatedTotalRows || 0) + 25000;
              }
            }
          );

          // Write this chunk's rows to DB (serialized — SQLite is single-writer)
          if (chunkRows.length > 0) {
            const inserted = db.insertSearchAnalyticsBatch(chunkRows);
            propRowsFetched += chunkRows.length;
            propRowsInserted += inserted;
            job.rowsFetched += chunkRows.length;

            console.error(`[Sync] ${siteUrl} chunk ${chunk.from}→${chunk.to}: ${inserted} rows`);
          }
        });

        // Finalise sync log
        const finalStatus = job.cancelled ? 'cancelled' : 'completed';
        db.updateSyncLog(syncLogId, {
          rowsFetched: propRowsFetched,
          rowsInserted: propRowsInserted,
          status: finalStatus,
        });

        if (propRowsInserted > 0) {
          db.updateLastSynced(siteUrl);
        }

        const result: SyncJobResult = {
          siteUrl,
          status: job.cancelled ? 'cancelled' : 'completed',
          rowsFetched: propRowsFetched,
          rowsInserted: propRowsInserted,
          durationMs: Date.now() - propStartTime,
        };

        // Auto-prune after successful sync (not on cancel)
        if (!job.cancelled && propRowsInserted > 0) {
          try {
            // Close DB before pruning (DataRetention opens its own connection)
            db.close();
            dbClosed = true;
            const pruneResult = DataRetention.prune(siteUrl);
            if (pruneResult.rowsDeleted > 0) {
              result.pruned = {
                rowsDeleted: pruneResult.rowsDeleted,
                rowsAfter: pruneResult.rowsAfter,
                spaceSavedMB: Math.round((pruneResult.dbSizeBefore - pruneResult.dbSizeAfter) / 1024 / 1024),
              };
            }
          } catch (pruneErr) {
            console.error(`[Retention] Auto-prune failed for ${siteUrl}: ${pruneErr}`);
          }
        }

        return result;
      } finally {
        clearInterval(checkCancel);
      }
    } finally {
      if (!dbClosed) db.close();
    }
  }

  private jobToStatus(job: SyncJob): SyncStatus {
    return {
      jobId: job.id,
      status: job.status,
      totalProperties: job.totalProperties,
      completedProperties: job.completedProperties,
      currentProperty: job.currentProperty,
      rowsFetched: job.rowsFetched,
      estimatedTotalRows: job.estimatedTotalRows,
      apiCallsMade: job.apiCallsMade,
      startedAt: new Date(job.startedAt).toISOString(),
      elapsedMs: Date.now() - job.startedAt,
      results: job.results,
      error: job.error,
    };
  }
}

// --- Shared helpers ---

function transformRow(
  row: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number },
  dimensions: string[]
): SearchAnalyticsRow {
  const keyMap: Record<string, string | null> = {
    query: null,
    page: null,
    date: '',
    device: null,
    country: null,
  };
  dimensions.forEach((dim, idx) => {
    keyMap[dim] = row.keys[idx] || null;
  });
  return {
    date: keyMap.date || '',
    query: keyMap.query,
    page: keyMap.page,
    device: keyMap.device,
    country: keyMap.country,
    searchAppearance: null,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

function buildChunks(dateFrom: string, dateTo: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = new Date(dateFrom);
  const end = new Date(dateTo);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
    const effectiveEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: effectiveEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(effectiveEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

function daysBetween(dateFrom: string, dateTo: string): number {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Run async tasks with a concurrency limit.
 * Processes items from the array, keeping up to `limit` in flight at once.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}
