import { google } from 'googleapis';
import type { GscProperty, GscApiRow, FetchOptions } from '../types/index.js';

const ROW_LIMIT = 25000; // GSC API max per request
const DEFAULT_DIMENSIONS = ['query', 'page', 'date', 'device', 'country'];
const MAX_RETRIES = 3;
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503];

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.code || err?.response?.status || err?.status;
      const isRetryable = RETRYABLE_STATUS_CODES.includes(Number(status));
      if (!isRetryable || attempt === retries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.error(`[GSC] Retryable error (${status}), attempt ${attempt + 1}/${retries}, waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

export interface PageResult {
  rows: GscApiRow[];
  totalSoFar: number;
  startRow: number;
}

export class GscClient {
  private auth: any;
  private searchconsole: any;

  constructor(credentialsPath: string) {
    this.auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    this.searchconsole = google.searchconsole({ version: 'v1', auth: this.auth });
  }

  async listProperties(): Promise<GscProperty[]> {
    const response: any = await withRetry(() => this.searchconsole.sites.list());
    const sites = response.data.siteEntry || [];
    return sites.map((site: any) => ({
      siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel,
    }));
  }

  /**
   * Fetch search analytics with streaming page callback.
   *
   * Each 25k-row page from the API triggers the onPage callback
   * so callers can commit to the database immediately rather than
   * accumulating everything in memory.
   *
   * Returns the total number of rows fetched across all pages.
   */
  async fetchSearchAnalytics(
    siteUrl: string,
    options: FetchOptions,
    signal?: AbortSignal,
    onPage?: (page: PageResult) => void
  ): Promise<number> {
    const dimensions = options.dimensions || DEFAULT_DIMENSIONS;
    let totalRows = 0;
    let startRow = 0;

    while (true) {
      if (signal?.aborted) {
        console.error(`[GSC] Sync aborted after ${totalRows} rows`);
        break;
      }

      const response: any = await withRetry(() => this.searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: options.startDate,
          endDate: options.endDate,
          dimensions,
          rowLimit: options.rowLimit || ROW_LIMIT,
          startRow,
          dataState: options.dataState || 'all',
          ...(options.searchType ? { type: options.searchType } : {}),
        },
      }));

      const rows: GscApiRow[] = (response.data.rows || []).map((row: any) => ({
        keys: row.keys,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      }));

      totalRows += rows.length;

      // Fire callback so caller can commit this page immediately
      if (onPage && rows.length > 0) {
        onPage({ rows, totalSoFar: totalRows, startRow });
      }

      if (rows.length < (options.rowLimit || ROW_LIMIT)) {
        break;
      }

      startRow += rows.length;
      console.error(`[GSC] Fetched ${totalRows} rows so far (page at startRow=${startRow})...`);
    }

    return totalRows;
  }
}
