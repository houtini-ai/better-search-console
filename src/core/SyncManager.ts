import { randomUUID } from 'node:crypto';
import { GscClient } from './GscClient.js';
import { Database } from './Database.js';
import { getDbPath, defaultStartDate, defaultEndDate } from '../tools/helpers.js';

export type SyncJobStatus = 'queued' | 'syncing' | 'completed' | 'failed' | 'cancelled';

export interface SyncJobResult {
  siteUrl: string;
  status: 'completed' | 'failed' | 'skipped' | 'cancelled';
  rowsFetched: number;
  rowsInserted: number;
  durationMs: number;
  error?: string;
}

export interface SyncStatus {
  jobId: string;
  status: SyncJobStatus;

  // Overall progress (for sync_all)
  totalProperties: number;
  completedProperties: number;
  currentProperty: string | null;

  // Current property progress
  rowsFetched: number;
  estimatedTotalRows: number | null;
  apiCallsMade: number;

  // Timing
  startedAt: string;
  elapsedMs: number;

  // Results (populated as properties complete)
  results: SyncJobResult[];

  // Error info
  error?: string;
}

interface SyncJob {
  id: string;
  status: SyncJobStatus;
  cancelled: boolean;

  // Properties to sync
  properties: Array<{ siteUrl: string; startDate?: string; endDate?: string; dimensions?: string[]; searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video' }>;
  totalProperties: number;
  completedProperties: number;
  currentProperty: string | null;

  // Current property progress
  rowsFetched: number;
  estimatedTotalRows: number | null;
  apiCallsMade: number;

  // Timing
  startedAt: number; // Date.now()

  // Results
  results: SyncJobResult[];

  // Error
  error?: string;
}

const MAX_JOB_HISTORY = 50;

export class SyncManager {
  private jobs = new Map<string, SyncJob>();
  private jobOrder: string[] = []; // track insertion order for cleanup

  constructor(private gscClient: GscClient) {}

  /**
   * Start a background sync for a single property.
   * Returns immediately with a job ID.
   */
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

  /**
   * Start a background sync for all properties.
   * Returns immediately with a job ID.
   */
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

  /**
   * Get status of a specific job, or all active/recent jobs.
   */
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

    // Return all jobs
    return this.jobOrder.map(id => this.jobToStatus(this.jobs.get(id)!));
  }

  /**
   * Cancel a running job.
   */
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

  private createJob(
    properties: SyncJob['properties']
  ): SyncJob {
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
      // Only prune completed/failed/cancelled jobs
      if (oldJob && (oldJob.status === 'completed' || oldJob.status === 'failed' || oldJob.status === 'cancelled')) {
        this.jobs.delete(oldId);
      } else {
        // Put it back, prune the next one
        this.jobOrder.unshift(oldId);
        break;
      }
    }
  }

  /**
   * Run the job in the background. Does NOT block - uses async + setImmediate
   * to yield to the event loop between API calls.
   */
  private async runJob(job: SyncJob): Promise<void> {
    job.status = 'syncing';

    for (const prop of job.properties) {
      if (job.cancelled) break;

      job.currentProperty = prop.siteUrl;
      const propStart = Date.now();

      try {
        const result = await this.syncOneProperty(job, prop);
        job.results.push(result);
        job.completedProperties++;
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
        job.completedProperties++;
      }

      // Yield to event loop between properties
      await new Promise(resolve => setImmediate(resolve));
    }

    job.currentProperty = null;

    if (job.cancelled) {
      job.status = 'cancelled';
    } else {
      const anyFailed = job.results.some(r => r.status === 'failed');
      const allFailed = job.results.every(r => r.status === 'failed');
      job.status = allFailed ? 'failed' : 'completed';
      if (anyFailed && !allFailed) {
        const failCount = job.results.filter(r => r.status === 'failed').length;
        job.error = `${failCount} of ${job.totalProperties} properties failed`;
      }
    }
  }

  /**
   * Sync a single property, updating job progress as pages arrive.
   * Uses the existing DataSync/Database infrastructure.
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

      // Create an AbortController that checks the job's cancelled flag
      const abortController = new AbortController();
      const checkCancel = setInterval(() => {
        if (job.cancelled) abortController.abort();
      }, 500);

      const propStartTime = Date.now();
      let propRowsFetched = 0;
      let propRowsInserted = 0;

      try {
        const DEFAULT_DIMS = ['query', 'page', 'date', 'device', 'country'];
        const dims = dimensions || DEFAULT_DIMS;

        // Build date chunks like DataSync does
        const daySpan = this.daysBetween(startDate, endDate);
        const CHUNK_DAYS = 90;
        const chunks = daySpan > CHUNK_DAYS
          ? this.buildChunks(startDate, endDate)
          : [{ from: startDate, to: endDate }];

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

        for (const chunk of chunks) {
          if (job.cancelled) break;

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
              // Transform and insert rows
              const dbRows = page.rows.map(row => this.transformRow(row, dims));
              const inserted = db.insertSearchAnalyticsBatch(dbRows);
              propRowsFetched += page.rows.length;
              propRowsInserted += inserted;
              job.rowsFetched += page.rows.length;
              job.apiCallsMade++;

              // Estimate: if we got a full page (25k), there are more
              if (page.rows.length === 25000) {
                job.estimatedTotalRows = (job.estimatedTotalRows || 0) + 25000;
              }
            }
          );

          // Yield between chunks
          await new Promise(resolve => setImmediate(resolve));
        }

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

        return {
          siteUrl,
          status: job.cancelled ? 'cancelled' : 'completed',
          rowsFetched: propRowsFetched,
          rowsInserted: propRowsInserted,
          durationMs: Date.now() - propStartTime,
        };
      } finally {
        clearInterval(checkCancel);
      }
    } finally {
      db.close();
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

  // --- Helpers (mirrored from DataSync to avoid tight coupling) ---

  private transformRow(
    row: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number },
    dimensions: string[]
  ): { date: string; query: string | null; page: string | null; device: string | null; country: string | null; searchAppearance: string | null; clicks: number; impressions: number; ctr: number; position: number } {
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

  private buildChunks(dateFrom: string, dateTo: string): Array<{ from: string; to: string }> {
    const CHUNK_DAYS = 90;
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

  private daysBetween(dateFrom: string, dateTo: string): number {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }
}
