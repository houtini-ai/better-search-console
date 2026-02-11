import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Sanitize a GSC site URL into a safe filename.
 * e.g. "sc-domain:simracingcockpit.gg" → "simracingcockpit.gg"
 * e.g. "https://www.example.com/" → "www.example.com"
 */
export function sanitizeSiteUrl(siteUrl: string): string {
  let name = siteUrl;
  // Remove sc-domain: prefix
  name = name.replace(/^sc-domain:/, '');
  // Remove protocol
  name = name.replace(/^https?:\/\//, '');
  // Remove trailing slash
  name = name.replace(/\/+$/, '');
  // Replace unsafe chars
  name = name.replace(/[^a-zA-Z0-9.-]/g, '_');
  return name;
}

/**
 * Get the data directory from BSC_DATA_DIR env var, with fallback.
 */
export function getDataDir(): string {
  const dataDir = process.env.BSC_DATA_DIR || join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * Get the database path for a given site URL.
 */
export function getDbPath(siteUrl: string): string {
  return join(getDataDir(), sanitizeSiteUrl(siteUrl) + '.db');
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Parse a date range shorthand into start/end dates.
 * Supports: "7d", "14d", "28d", "3m", "6m", "8m", "12m", "16m",
 * plus named presets: "1d", "lw", "tm", "lm", "tq", "lq", "ytd"
 */
export function parseDateRange(range: string, referenceDate?: Date): { startDate: string; endDate: string } {
  const now = referenceDate || new Date();
  const today = formatDate(now);

  // Named presets
  switch (range) {
    case 'lw': { // Last Week (Mon-Sun)
      const d = new Date(now);
      const day = d.getDay() || 7; // convert Sunday=0 to 7
      d.setDate(d.getDate() - day - 6); // Monday of last week
      const start = formatDate(d);
      d.setDate(d.getDate() + 6); // Sunday of last week
      return { startDate: start, endDate: formatDate(d) };
    }
    case 'tm': { // This Month
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: formatDate(d), endDate: today };
    }
    case 'lm': { // Last Month
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }
    case 'tq': { // This Quarter
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return { startDate: formatDate(qStart), endDate: today };
    }
    case 'lq': { // Last Quarter
      const qm = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qm - 3, 1);
      const end = new Date(now.getFullYear(), qm, 0);
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }
    case 'ytd': { // Year to Date
      const start = new Date(now.getFullYear(), 0, 1);
      return { startDate: formatDate(start), endDate: today };
    }
  }

  // Numeric presets: "7d", "3m", etc.
  const match = range.match(/^(\d+)(d|m)$/);
  if (!match) {
    throw new Error(`Invalid date range: "${range}". Use format like "7d", "28d", "3m", "6m", "12m", "16m", or named presets: "lw", "tm", "lm", "tq", "lq", "ytd".`);
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const start = new Date(now);
  if (unit === 'd') {
    start.setDate(start.getDate() - amount);
  } else if (unit === 'm') {
    start.setMonth(start.getMonth() - amount);
  }

  return { startDate: formatDate(start), endDate: today };
}

export type ComparisonMode = 'previous_period' | 'year_over_year' | 'previous_month' | 'disabled';

/**
 * Get current + prior period date ranges from a date range shorthand.
 * Supports multiple comparison modes.
 */
export function getPeriodDates(
  range: string,
  referenceDate?: Date,
  comparisonMode: ComparisonMode = 'previous_period',
  matchWeekdays: boolean = false
): {
  current: { startDate: string; endDate: string };
  prior: { startDate: string; endDate: string };
} {
  const current = parseDateRange(range, referenceDate);

  if (comparisonMode === 'disabled') {
    // Return empty prior period — callers should check for this
    return {
      current,
      prior: { startDate: current.startDate, endDate: current.startDate },
    };
  }

  const startMs = new Date(current.startDate).getTime();
  const endMs = new Date(current.endDate).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const durationMs = endMs - startMs;

  let priorStart: Date;
  let priorEnd: Date;

  switch (comparisonMode) {
    case 'year_over_year': {
      const s = new Date(current.startDate);
      const e = new Date(current.endDate);
      s.setFullYear(s.getFullYear() - 1);
      e.setFullYear(e.getFullYear() - 1);
      priorStart = s;
      priorEnd = e;
      break;
    }
    case 'previous_month': {
      const s = new Date(current.startDate);
      const e = new Date(current.endDate);
      s.setMonth(s.getMonth() - 1);
      e.setMonth(e.getMonth() - 1);
      priorStart = s;
      priorEnd = e;
      break;
    }
    case 'previous_period':
    default: {
      priorEnd = new Date(startMs - DAY);
      priorStart = new Date(priorEnd.getTime() - durationMs);
      break;
    }
  }

  // Match weekdays: shift prior period so that the start day-of-week matches
  if (matchWeekdays) {
    const currentStartDay = new Date(current.startDate).getDay();
    const priorStartDay = priorStart.getDay();
    let diff = currentStartDay - priorStartDay;
    // Find the closest shift that aligns weekdays (within ±3 days)
    if (diff > 3) diff -= 7;
    if (diff < -3) diff += 7;
    priorStart = new Date(priorStart.getTime() + diff * DAY);
    priorEnd = new Date(priorEnd.getTime() + diff * DAY);
  }

  return {
    current,
    prior: {
      startDate: formatDate(priorStart),
      endDate: formatDate(priorEnd),
    },
  };
}

/**
 * Default start date: 3 months ago for fast initial sync.
 * Users can pass startDate explicitly for longer ranges (up to 16 months).
 */
export function defaultStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return formatDate(d);
}

/**
 * Default end date: today.
 */
export function defaultEndDate(): string {
  return formatDate(new Date());
}


/**
 * Render an ASCII sparkline from an array of numbers.
 * Uses Unicode block characters for a compact visual trend.
 */
export function asciiSparkline(data: number[]): string {
  if (data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const blocks = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
  return data.map(v => blocks[Math.round(((v - min) / range) * 8)]).join('');
}

/**
 * Format a number with k/M suffixes for compact display.
 */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

/**
 * Format a percentage change with sign and arrow.
 */
export function formatChange(pct: number | null): string {
  if (pct === null) return 'n/a';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}
