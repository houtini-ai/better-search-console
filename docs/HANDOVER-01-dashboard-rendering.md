# Better Search Console - Handover: Fix Overview & Dashboard Rendering

**Date:** 11 February 2026  
**Status:** Overview and Dashboard tools return data but render nothing in Claude Desktop  
**Priority:** High - these are the flagship visual features

---

## The Problem

### What works
All data-returning tools work perfectly:
- `list_properties` - returns JSON, 23 properties visible
- `sync_gsc_data` - syncs data, incremental sync works
- `query_gsc_data` - raw SQL works, returns structured JSON
- `get_insights` (all 16 types) - returns structured JSON correctly
- `compare_periods` - returns structured JSON correctly

### What doesn't work
- `get_dashboard` - returns `"Dashboard for sc-domain:rcr.com.au (3m)"` as plain text. No UI renders.
- `get_overview` - returns `"Overview: 1 properties (3m)"` as plain text. No UI renders.

The user sees only the text string in the tool response. No iframe, no chart, no interactive widget. Expanding "view as code" shows the params and the text response string - nothing else.

### Root Cause Analysis

The tools use `@modelcontextprotocol/ext-apps` (v1.0.1) which relies on:
1. `registerAppTool` - registers a tool with `_meta.ui.resourceUri` pointing to a `ui://` resource
2. `registerAppResource` - serves bundled HTML as an iframe resource
3. `structuredContent` in the tool response - passes data to the iframe via postMessage

The tool handlers return both:
```typescript
content: [{ type: 'text', text: `Dashboard for ${args.siteUrl}...` }],  // fallback text
structuredContent: data,  // data payload for the iframe
```

**The iframe UI never loads.** The `structuredContent` and `ui://` resource mechanism appears to not be supported or is broken in the current Claude Desktop build. The ext-apps spec says it's supported in "Claude (web + desktop), VS Code Insiders, ChatGPT, Goose" but the reality on the ground is that only the `content` text field is displayed.

---

## The Fix: Return Rich Text Content Instead

Since the ext-apps iframe rendering isn't working, the tools should return **structured text content** that Claude can display directly - the same way all the working tools do it. The data is already being computed correctly (the `getDashboardData()` and `getOverviewData()` functions return full datasets). The only problem is that data gets put into `structuredContent` which goes nowhere, whilst `content` gets a throwaway summary string.

### Strategy: Dual-mode response

Keep the ext-apps registration for future compatibility, but also return the full data as formatted JSON in the `content` field so it always works:

```typescript
// In server.ts - get_dashboard handler
async (args) => {
  try {
    const data = getDashboardData(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      structuredContent: data,  // keep for ext-apps if it ever works
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
      isError: true,
    };
  }
}
```

Same pattern for `get_overview`:

```typescript
// In server.ts - get_overview handler
async (args) => {
  try {
    const data = await getOverviewData(gscClient, args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      structuredContent: data as any,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
      isError: true,
    };
  }
}
```

This is the minimum viable fix. It makes both tools immediately useful by returning the same structured JSON that all the other tools return.

---

## Phase 2: Smarter Overview Response

The overview should be more than a JSON dump. Since we're returning text content that Claude will interpret, we can format it for maximum usefulness.

### Proposed Overview Behaviour

1. Query all synced properties (skip unsynced ones)
2. For each property, compute:
   - Summary metrics (clicks, impressions, CTR, avg position) for the requested period
   - Period-over-period % changes  
   - Daily clicks as a simple sparkline array (for Claude to interpret trends)
3. Return a structured JSON response with all properties

The `getOverviewData()` function already does exactly this - it computes `PropertyOverview[]` with sparkline data, change percentages, and sorted results. The only change needed is piping that JSON into the `content` text field.

### Clickable Site Navigation

The original spec wanted clicking a site card to open its dashboard. In the text-content world, this translates to:

- Claude sees the overview data and can recommend drilling into a specific site
- The user says "show me the dashboard for rcr.com.au" 
- Claude calls `get_dashboard` with that siteUrl

This is actually a natural conversational flow and works better than hidden iframe navigation.

---

## Phase 3: Consider ASCII Sparklines (Optional Enhancement)

For the overview, we could render mini ASCII sparklines in the text response to give a visual sense of trend without needing iframes:

```
rcr.com.au
  Clicks: 294 (-31.6%)  |  Impressions: 4,082 (-26.8%)
  Trend: ▂▃▅▃▂▄▃▂▅▆▃▄▃▂▁▂▃▅▆▃▂▃▅▃▂▃▄▃
```

This would require a small utility function:

```typescript
function asciiSparkline(data: number[]): string {
  if (data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const blocks = ' ▁▂▃▄▅▆▇█';
  return data.map(v => blocks[Math.round(((v - min) / range) * 8)]).join('');
}
```

This is a nice-to-have, not essential. The JSON data alone is sufficient for Claude to interpret and summarise.

---

## Implementation Checklist

### Minimum fix (do this first)
- [ ] In `server.ts`, change `get_dashboard` handler to return `JSON.stringify(data, null, 2)` in the `content` text field
- [ ] In `server.ts`, change `get_overview` handler to return `JSON.stringify(data, null, 2)` in the `content` text field
- [ ] `npm run build`
- [ ] Restart Claude Desktop
- [ ] Test: `get_overview` should now return full property data
- [ ] Test: `get_dashboard` should now return full dashboard data

### Keep for future
- [ ] Keep `registerAppTool` and `registerAppResource` registrations intact
- [ ] Keep `structuredContent` in responses
- [ ] Keep the Vite UI build pipeline and HTML/JS files
- [ ] When ext-apps rendering works in Claude Desktop, the iframe UI will activate automatically

### Optional enhancements
- [ ] ASCII sparklines in overview text response
- [ ] Formatted summary text (not just raw JSON) for dashboard
- [ ] Consider whether `get_dashboard` data payload is too large and should be trimmed for text-only mode

---

## Files to Change

| File | Change |
|---|---|
| `src/server.ts` | Lines ~232 and ~267: Change `content` text from summary string to `JSON.stringify(data, null, 2)` |

That's it. One file, two line changes, rebuild, restart.

---

## Testing After Fix

```
1. get_overview dateRange="28d"
   Expected: JSON with properties array containing rcr.com.au metrics + sparkline

2. get_dashboard siteUrl="sc-domain:rcr.com.au" dateRange="3m"
   Expected: JSON with summary, dailyTrend, topQueries, topPages, countries, rankingBuckets, newQueries, lostQueries

3. get_dashboard siteUrl="sc-domain:rcr.com.au" dateRange="3m" brandTerms=["rcr"]
   Expected: Same as above plus brandedSplit object
```

---

## Context: What the Data Looks Like

The `getDashboardData()` function returns a rich object with:
- `summary` - current/prior period metrics with % changes
- `dailyTrend` - array of {date, clicks, impressions, ctr, avg_position}
- `priorDailyTrend` - same for comparison period (dashed overlay data)
- `topQueries` - top 100 queries with current/prior metrics
- `topPages` - top 100 pages with current/prior metrics
- `countries` - country breakdown with change %
- `rankingBuckets` - {1-3, 4-10, 11-20, 21-50, 51-100, 100+} counts
- `newQueries` - queries appearing in current but not prior period
- `lostQueries` - queries in prior but not current period
- `brandedSplit` - branded vs non-branded if brandTerms provided

The `getOverviewData()` function returns:
- `properties[]` - array of PropertyOverview objects, each with:
  - `siteUrl`, `domain`, `lastSyncedAt`
  - `current` - {clicks, impressions, ctr, avgPosition}
  - `changes` - {clicksPct, impressionsPct, ctrPct, avgPositionPct}
  - `sparkline` - array of {date, clicks, impressions}

All the hard work is done. The data functions are solid. Just need to pipe the output to where Claude can see it.
