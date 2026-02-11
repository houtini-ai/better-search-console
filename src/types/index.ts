// Shared TypeScript interfaces for better-search-console

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

export interface PropertyStatus extends GscProperty {
  lastSyncedAt: string | null;
  rowCount: number | null;
  dbPath: string | null;
}

export interface SearchAnalyticsRow {
  date: string;
  query: string | null;
  page: string | null;
  device: string | null;
  country: string | null;
  searchAppearance: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscApiRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface FetchOptions {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  dataState?: string;
  searchType?: 'web' | 'discover' | 'googleNews' | 'image' | 'video';
}

export interface SyncLogEntry {
  id?: number;
  syncType: string;
  dimensions: string;
  dateFrom: string | null;
  dateTo: string | null;
  rowsFetched: number;
  rowsInserted: number;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface InsightParams {
  siteUrl: string;
  insight: string;
  dateRange?: string;
  pageFilter?: string;
  queryFilter?: string;
  device?: string;
  country?: string;
  brandTerms?: string[];
  limit?: number;
  minClicks?: number;
  minImpressions?: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface PeriodDates {
  current: DateRange;
  prior: DateRange;
}

export interface ComparePeriodParams {
  siteUrl: string;
  period1Start: string;
  period1End: string;
  period2Start: string;
  period2End: string;
  dimension?: string;
  limit?: number;
  pageFilter?: string;
}

export interface SummaryMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
}

export interface SummaryInsight {
  current: SummaryMetrics;
  prior: SummaryMetrics;
  changes: {
    clicks: number;
    clicksPct: number | null;
    impressions: number;
    impressionsPct: number | null;
    ctr: number;
    ctrPct: number | null;
    avgPosition: number;
    avgPositionPct: number | null;
  };
}
