import { Database } from './Database.js';
import { GscClient } from './GscClient.js';
import type { SearchAnalyticsRow, SyncResult, ChunkResult } from '../types/index.js';

const DEFAULT_DIMENSIONS = ['query', 'page', 'date', 'device', 'country'];
const CHUNK_DAYS = 90;

export class DataSync {
  constructor(
    private db: Database,
    private gscClient: GscClient
  ) {}

  async syncProperty(
    siteUrl: string,
    dateFrom: string,
    dateTo: string,
    dimensions: string[] = DEFAULT_DIMENSIONS,
    searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video',
    signal?: AbortSignal
  ): Promise<SyncResult> {
    const daySpan = this.daysBetween(dateFrom, dateTo);

    if (daySpan > CHUNK_DAYS) {
      return this.syncChunked(siteUrl, dateFrom, dateTo, dimensions, searchType, signal);
    }
    return this.syncSinglePass(siteUrl, dateFrom, dateTo, dimensions, searchType, signal);
  }

  /**
   * Chunked sync: splits date range into ~90-day chunks.
   * Each API page (25k rows) is committed to SQLite immediately
   * so partial progress survives timeouts.
   */
  private async syncChunked(
    siteUrl: string,
    dateFrom: string,
    dateTo: string,
    dimensions: string[],
    searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video',
    signal?: AbortSignal
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const chunks = this.buildChunks(dateFrom, dateTo);

    console.error(`[Sync] Chunked sync for ${siteUrl}: ${dateFrom} → ${dateTo} (${chunks.length} chunks of ~${CHUNK_DAYS} days)`);

    const syncLogId = this.db.createSyncLog({
      syncType: 'search_analytics',
      dimensions: dimensions.join(','),
      dateFrom,
      dateTo,
      rowsFetched: 0,
      rowsInserted: 0,
      status: 'running',
      errorMessage: null,
    });

    let totalFetched = 0;
    let totalInserted = 0;
    const chunkResults: ChunkResult[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = Date.now();

      if (signal?.aborted) {
        console.error(`[Sync] Aborted before chunk ${i + 1}/${chunks.length} — returning partial results`);
        break;
      }

      console.error(`[Sync] Chunk ${i + 1}/${chunks.length}: ${chunk.from} → ${chunk.to}...`);

      try {
        let chunkFetched = 0;
        let chunkInserted = 0;

        // Stream: each 25k page commits to DB immediately
        const rowsFetched = await this.gscClient.fetchSearchAnalytics(
          siteUrl,
          {
            startDate: chunk.from,
            endDate: chunk.to,
            dimensions,
            ...(searchType ? { searchType } : {}),
          },
          signal,
          (page) => {
            const dbRows = page.rows.map((row) => this.transformRow(row, dimensions));
            chunkInserted += this.db.insertSearchAnalyticsBatch(dbRows);
            chunkFetched += page.rows.length;
          }
        );

        totalFetched += chunkFetched;
        totalInserted += chunkInserted;

        const chunkMs = Date.now() - chunkStart;
        console.error(`[Sync] Chunk ${i + 1}/${chunks.length}: ${chunkInserted} rows in ${chunkMs}ms (total: ${totalInserted})`);

        chunkResults.push({
          chunkIndex: i,
          dateFrom: chunk.from,
          dateTo: chunk.to,
          rowsFetched: chunkFetched,
          rowsInserted: chunkInserted,
          durationMs: chunkMs,
          status: 'completed',
        });

        this.db.updateSyncLog(syncLogId, {
          rowsFetched: totalFetched,
          rowsInserted: totalInserted,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const chunkMs = Date.now() - chunkStart;

        console.error(`[Sync] Chunk ${i + 1}/${chunks.length}: ERROR — ${errorMessage}`);

        chunkResults.push({
          chunkIndex: i,
          dateFrom: chunk.from,
          dateTo: chunk.to,
          rowsFetched: 0,
          rowsInserted: 0,
          durationMs: chunkMs,
          status: 'error',
          error: errorMessage,
        });

        lastError = errorMessage;
      }
    }

    // Finalise
    const completedChunks = chunkResults.filter(c => c.status === 'completed').length;
    const allSucceeded = completedChunks === chunks.length;
    const wasCancelled = signal?.aborted === true;
    const finalStatus = wasCancelled
      ? 'cancelled'
      : allSucceeded
        ? 'completed'
        : (completedChunks > 0 ? 'completed' : 'error');

    this.db.updateSyncLog(syncLogId, {
      rowsFetched: totalFetched,
      rowsInserted: totalInserted,
      status: finalStatus,
      ...(lastError && !allSucceeded ? { errorMessage: `${chunks.length - completedChunks} chunk(s) failed. Last: ${lastError}` } : {}),
    });

    if (totalInserted > 0) {
      this.db.updateLastSynced(siteUrl);
    }

    const durationMs = Date.now() - startTime;
    console.error(`[Sync] Chunked sync complete: ${totalInserted} rows from ${completedChunks}/${chunks.length} chunks in ${durationMs}ms`);

    return {
      siteUrl,
      dateFrom,
      dateTo,
      rowsFetched: totalFetched,
      rowsInserted: totalInserted,
      durationMs,
      status: finalStatus as SyncResult['status'],
      ...(lastError && !allSucceeded ? { error: `${chunks.length - completedChunks} chunk(s) failed. Last: ${lastError}` } : {}),
      chunks: chunkResults,
    };
  }

  /**
   * Single-pass sync for short ranges (<=90 days).
   * Each API page commits to DB immediately.
   */
  private async syncSinglePass(
    siteUrl: string,
    dateFrom: string,
    dateTo: string,
    dimensions: string[],
    searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video',
    signal?: AbortSignal
  ): Promise<SyncResult> {
    const startTime = Date.now();

    const syncLogId = this.db.createSyncLog({
      syncType: 'search_analytics',
      dimensions: dimensions.join(','),
      dateFrom,
      dateTo,
      rowsFetched: 0,
      rowsInserted: 0,
      status: 'running',
      errorMessage: null,
    });

    try {
      console.error(`[Sync] Fetching ${siteUrl} from ${dateFrom} to ${dateTo}...`);

      let totalFetched = 0;
      let totalInserted = 0;

      await this.gscClient.fetchSearchAnalytics(
        siteUrl,
        {
          startDate: dateFrom,
          endDate: dateTo,
          dimensions,
          ...(searchType ? { searchType } : {}),
        },
        signal,
        (page) => {
          const dbRows = page.rows.map((row) => this.transformRow(row, dimensions));
          totalInserted += this.db.insertSearchAnalyticsBatch(dbRows);
          totalFetched += page.rows.length;
          console.error(`[Sync] Committed page: ${page.rows.length} rows (total: ${totalInserted})`);
        }
      );

      const wasCancelled = signal?.aborted === true;

      this.db.updateSyncLog(syncLogId, {
        rowsFetched: totalFetched,
        rowsInserted: totalInserted,
        status: wasCancelled ? 'cancelled' : 'completed',
      });

      if (totalInserted > 0) {
        this.db.updateLastSynced(siteUrl);
      }

      const durationMs = Date.now() - startTime;
      console.error(`[Sync] Complete: ${totalInserted} rows in ${durationMs}ms`);

      return {
        siteUrl,
        dateFrom,
        dateTo,
        rowsFetched: totalFetched,
        rowsInserted: totalInserted,
        durationMs,
        status: wasCancelled ? 'cancelled' : 'completed',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.db.updateSyncLog(syncLogId, {
        status: 'error',
        errorMessage,
      });

      return {
        siteUrl,
        dateFrom,
        dateTo,
        rowsFetched: 0,
        rowsInserted: 0,
        durationMs: Date.now() - startTime,
        status: 'error',
        error: errorMessage,
      };
    }
  }

  // --- Helpers ---

  private transformRow(
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

  private buildChunks(dateFrom: string, dateTo: string): Array<{ from: string; to: string }> {
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
