# Better Search Console — Execution Plan

**Package name:** `better-search-console`
**Working directory:** `C:\MCP\better-search-console`
**Purpose:** MCP server that syncs Google Search Console data into a local SQLite database and serves an interactive dashboard UI via the MCP Apps extension directly inside Claude Desktop.

---

## Pre-Flight: Library Verification

Before writing any code, check Context7 and Gemini MCP (with grounding disabled) for the latest stable versions of these packages. Pin exact versions in package.json — do not use `latest` or loose ranges.

**Packages to verify:**
- `@modelcontextprotocol/sdk` — expected ~1.26.x. Use Context7 library ID `/modelcontextprotocol/ext-apps` for MCP Apps patterns.
- `@modelcontextprotocol/ext-apps` — the MCP Apps extension for UI. Check npm for current version.
- `better-sqlite3` — native SQLite binding. Expected ~12.x.
- `googleapis` — Google API client for Node.js. Need `google.searchconsole` and `google.auth`.
- `zod` — schema validation, used by MCP SDK tool registration.
- `vite` + `vite-plugin-singlefile` — for bundling UI into a single HTML resource file.
- `chart.js` — for dashboard charts (bundled into the UI, not a server dependency).

Use `gemini_chat` with `grounding: false` to cross-check any version uncertainties against npm.

---

## Tooling & File I/O

Use **Desktop Commander** for all file operations throughout the build:
- `write_file` for creating source files (chunk at 25-30 lines, append mode for longer files)
- `read_file` to inspect existing files
- `start_process` + `interact_with_process` for running `npm install`, `npm run build`, shell commands
- `edit_block` for surgical edits to existing files
- `list_directory` to verify structure

Do NOT use `console.log` in any MCP server code — it corrupts the JSON-RPC stdio transport. Use `console.error` for debug output if needed.

---

## Architecture

### Design Principles
- **Separation of concerns** — each file does one job
- **Modular services** — database, API client, sync orchestrator, tools, and UI are independent layers
- **SQLite-first** — all GSC data lands in SQLite before anything queries it
- **Read-only tools by default** — only `sync_gsc_data` writes; everything else reads
- **MCP Apps for UI** — interactive dashboard rendered in Claude Desktop via sandboxed iframe

### Reference Implementation
The SQLite + MCP pattern is proven in `C:\MCP\seo-crawler-mcp`. Key files to reference:
- `src/core/CrawlDatabase.ts` — Database class pattern (constructor creates tables, WAL mode, prepared statements, batch transactions)
- `src/index.ts` — MCP server setup (Server, StdioServerTransport, tool registration)
- `package.json` — ES module config (`"type": "module"`)

### Project Structure
```
C:\MCP\better-search-console\
├── src/
│   ├── index.ts                    # Entry point: create server, connect StdioServerTransport
│   ├── server.ts                   # McpServer factory: register all tools + UI resources
│   ├── core/
│   │   ├── Database.ts             # SQLite schema, all queries, inserts, reads
│   │   ├── GscClient.ts            # Google Search Console API wrapper (googleapis)
│   │   └── DataSync.ts             # Orchestrates: paginated fetch → batch insert
│   ├── tools/
│   │   ├── sync-data.ts            # Tool: fetch GSC data into SQLite
│   │   ├── query-data.ts           # Tool: run SQL against the warehouse
│   │   ├── list-properties.ts      # Tool: list GSC properties + sync status
│   │   ├── get-insights.ts         # Tool: pre-built analytical queries
│   │   └── compare-periods.ts      # Tool: period-over-period comparison
│   ├── ui/
│   │   ├── dashboard.html          # Main UI entry (HTML shell)
│   │   ├── dashboard.ts            # Client-side MCP App logic (ext-apps App class)
│   │   └── styles.css              # Dashboard styles (dark theme)
│   └── types/
│       └── index.ts                # Shared TypeScript interfaces
├── dist/                           # Compiled output (gitignored)
├── data/                           # SQLite databases per property (gitignored)
├── temp/                           # Reference UI screenshots + HTML (gitignored)
├── package.json
├── tsconfig.json
├── tsconfig.server.json            # Server-only TS config (excludes UI)
├── vite.config.ts                  # Vite config for UI bundling
├── ARCHITECTURE.md
├── UI_REFERENCE.md
└── README.md
```

---

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "better-search-console": {
      "command": "node",
      "args": ["C:\\MCP\\better-search-console\\dist\\index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "C:\\MCP\\gsc-access-mcp-2eafbdf43abd.json",
        "BSC_DATA_DIR": "C:\\MCP\\better-search-console\\data"
      }
    }
  }
}
```

---

## Database Schema

Uses `better-sqlite3` with WAL journal mode. One database file per GSC property, stored in `BSC_DATA_DIR`.

Database filename pattern: `{sanitised-domain}.db` (e.g. `simracingcockpit.gg.db`)

```sql
CREATE TABLE IF NOT EXISTS property_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_url TEXT UNIQUE NOT NULL,
    permission_level TEXT,
    last_synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    query TEXT,
    page TEXT,
    device TEXT,
    country TEXT,
    search_appearance TEXT,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    ctr REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_unique
    ON search_analytics(date, query, page, device, country);

CREATE INDEX IF NOT EXISTS idx_sa_date ON search_analytics(date);
CREATE INDEX IF NOT EXISTS idx_sa_query ON search_analytics(query);
CREATE INDEX IF NOT EXISTS idx_sa_page ON search_analytics(page);
CREATE INDEX IF NOT EXISTS idx_sa_clicks ON search_analytics(clicks DESC);
CREATE INDEX IF NOT EXISTS idx_sa_impressions ON search_analytics(impressions DESC);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,
    dimensions TEXT NOT NULL,
    date_from TEXT,
    date_to TEXT,
    rows_fetched INTEGER DEFAULT 0,
    rows_inserted INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    error_message TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);
```

### Database.ts Pattern (from seo-crawler-mcp)
- Constructor takes `dbPath`, opens with `new Database(dbPath)`, sets `pragma('journal_mode = WAL')`
- `initializeTables()` runs all CREATE TABLE/INDEX statements
- Prepared statements for inserts (reused across batch)
- Batch inserts wrapped in `db.transaction()`
- Query methods return typed objects, not raw rows
- `close()` method for cleanup

---

## Core Modules

### GscClient.ts
Wraps the `googleapis` package for Search Console API access.

```
Constructor: Takes credentials path from GOOGLE_APPLICATION_CREDENTIALS env var
Auth: google.auth.GoogleAuth with searchconsole scope
Methods:
  - listProperties(): Returns array of {siteUrl, permissionLevel}
  - fetchSearchAnalytics(siteUrl, options): Paginated fetch with:
      - dateRange (startDate, endDate as YYYY-MM-DD)
      - dimensions: ['query', 'page', 'date', 'device', 'country']
      - rowLimit: 25000 (API max per request)
      - startRow: for pagination (keep fetching until rows < rowLimit)
      - dataState: 'all' (includes fresh data)
    Returns: array of {keys: string[], clicks, impressions, ctr, position}
```

GSC API pagination: request with `startRow=0`, if response has 25,000 rows, request again with `startRow=25000`, repeat until response rows < 25,000.

### DataSync.ts
Orchestrates the fetch-and-store pipeline.

```
Constructor: Takes Database instance and GscClient instance
Methods:
  - syncProperty(siteUrl, dateFrom, dateTo): Full pipeline
      1. Create sync_log entry (status: running)
      2. Paginated fetch via GscClient
      3. Transform API rows into DB rows
      4. Batch insert via Database.insertSearchAnalytics()
      5. Update sync_log (status: completed, rows counts)
      6. Update property_meta.last_synced_at
  - Error handling: catch, update sync_log with error, re-throw
```

---

## MCP Tools

### Tool 1: `list_properties`
**Input:** none
**Output:** Array of GSC properties with permission level and last sync timestamp
**Implementation:** Call GscClient.listProperties(), cross-reference with local database files to show sync status

### Tool 2: `sync_gsc_data`
**Input:**
- `siteUrl` (string, required) — GSC property URL (e.g. `sc-domain:simracingcockpit.gg`)
- `startDate` (string, optional) — YYYY-MM-DD, defaults to 16 months ago
- `endDate` (string, optional) — YYYY-MM-DD, defaults to today
- `dimensions` (string[], optional) — defaults to `['query', 'page', 'date', 'device', 'country']`

**Output:** Sync summary (rows fetched, rows inserted, duration)
**Implementation:** Creates/opens the property database, runs DataSync.syncProperty()

### Tool 3: `query_gsc_data`
**Input:**
- `siteUrl` (string, required)
- `sql` (string, required) — SQL query to run against the property's database
- `params` (any[], optional) — parameterised query values

**Output:** Query results as JSON array
**Safety:** Read-only. Reject any SQL containing INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.

### Tool 4: `get_insights`
**Input:**
- `siteUrl` (string, required)
- `dateRange` (string, optional) — '7d', '28d', '3m', '6m', '12m'. Default '28d'
- `insight` (string, required) — one of:
  - `top_queries` — highest click queries
  - `top_pages` — highest click pages
  - `growing_queries` — queries with biggest click increase vs prior period
  - `declining_queries` — queries with biggest click decrease vs prior period
  - `growing_pages` — pages with biggest click increase
  - `declining_pages` — pages with biggest click decrease
  - `opportunities` — high impression, low CTR (position 5-20)
  - `device_breakdown` — clicks/impressions by device
  - `country_breakdown` — clicks/impressions by country
  - `summary` — hero metrics (total clicks, impressions, avg CTR, avg position with % change)

**Output:** Structured JSON with the insight data
**Implementation:** Each insight maps to a pre-built SQL query against the property database

### Tool 5: `compare_periods`
**Input:**
- `siteUrl` (string, required)
- `period1Start`, `period1End` (string, required) — YYYY-MM-DD
- `period2Start`, `period2End` (string, required) — YYYY-MM-DD
- `dimension` (string, optional) — 'query', 'page', 'device', 'country'. Default 'query'
- `limit` (number, optional) — default 50

**Output:** Side-by-side comparison with absolute and percentage changes

### Tool 6: `get_dashboard` (MCP App — Phase 3)
**Input:**
- `siteUrl` (string, required)
- `dateRange` (string, optional) — default '3m'

**Output:** Dashboard data payload + interactive UI resource
**Implementation:** Uses `registerAppTool` with `_meta.ui.resourceUri` pointing to `ui://dashboard/main.html`

---

## MCP App UI (Phase 3)

### Architecture
- UI source lives in `src/ui/`
- Built with Vite + `vite-plugin-singlefile` into a single HTML file
- Served as a `ui://` resource via `registerAppResource`
- Client-side uses `@modelcontextprotocol/ext-apps` `App` class
- Chart.js bundled inline for visualisations

### Build Pipeline
```
src/ui/dashboard.html + dashboard.ts + styles.css
    → vite build (vite-plugin-singlefile)
    → dist/dashboard.html (single file, all JS/CSS inlined)
    → served via registerAppResource as ui://dashboard/main.html
```

### UI Design (from reference screenshots)
Dark theme dashboard with:
- **Hero metrics bar**: Total clicks, impressions, CTR, position — each with % change vs prior period. Colour-coded: cyan (clicks), purple (impressions), orange (CTR), orange (position). Green/red for positive/negative change.
- **Time series chart**: Dual Y-axis. Clicks (left axis, cyan line) + impressions (right axis, purple line). Date on X-axis. Optional: dashed comparison period overlay.
- **Queries table** (left column): Sortable by clicks/impressions. Shows % change. Tabs: All | Growing | Decaying.
- **Pages table** (right column): Same structure as queries table. URL paths as identifiers.
- **Expandable modals**: Click EXPAND to see full table with CTR + Position columns added.
- **Date range selector**: 7d, 28d, 3m, 6m, 12m, 16m.

### Bidirectional Communication
```typescript
// Client-side (dashboard.ts)
import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Better Search Console', version: '1.0.0' });

// Receive data when tool is called
app.ontoolresult = (result) => {
  const data = result.structuredContent;
  renderDashboard(data);
};

// User clicks a query → drill down
async function onQueryClick(query: string) {
  const result = await app.callServerTool({
    name: 'get_insights',
    arguments: { siteUrl: currentSite, insight: 'top_pages', filterQuery: query }
  });
  renderDrillDown(result);
}

// Tell Claude what the user selected
await app.updateModelContext({
  content: [{ type: 'text', text: `User is viewing data for query: "${query}"` }]
});

app.connect();
```

---

## Build Configuration

### package.json
```json
{
  "name": "better-search-console",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "better-search-console": "dist/index.js"
  },
  "scripts": {
    "build:server": "tsc -p tsconfig.server.json",
    "build:ui": "cross-env INPUT=src/ui/dashboard.html vite build",
    "build": "npm run build:server && npm run build:ui",
    "dev": "concurrently \"tsc -p tsconfig.server.json --watch\" \"cross-env NODE_ENV=development INPUT=src/ui/dashboard.html vite build --watch\"",
    "start": "node dist/index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### tsconfig.server.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/ui/**"]
}
```

### vite.config.ts
```typescript
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const INPUT = process.env.INPUT;
if (!INPUT) throw new Error('INPUT env var required');

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    rollupOptions: { input: INPUT },
    outDir: 'dist',
    emptyOutDir: false,
  },
});
```

---

## Execution Phases

### Phase 1 — Core Data Pipeline
Build order:
1. `package.json` + `tsconfig.server.json` + install dependencies
2. `src/types/index.ts` — shared interfaces
3. `src/core/Database.ts` — SQLite schema + all CRUD methods
4. `src/core/GscClient.ts` — googleapis wrapper with pagination
5. `src/core/DataSync.ts` — orchestrator
6. `src/tools/list-properties.ts`
7. `src/tools/sync-data.ts`
8. `src/tools/query-data.ts`
9. `src/server.ts` — register tools with McpServer
10. `src/index.ts` — entry point with StdioServerTransport
11. Build, add to Claude Desktop config, restart, test

**Test checkpoint:** Sync simracingcockpit.gg data, run a SQL query, verify results.

### Phase 2 — Analytical Tools
1. `src/tools/get-insights.ts` — all pre-built SQL queries
2. `src/tools/compare-periods.ts` — period comparison logic
3. Update `src/server.ts` with new tool registrations
4. Build, restart, test

**Test checkpoint:** Run insights and comparisons, verify growing/decaying calculations.

### Phase 3 — MCP App Dashboard
1. `vite.config.ts` + UI build pipeline setup
2. `src/ui/dashboard.html` — HTML shell
3. `src/ui/styles.css` — dark theme
4. `src/ui/dashboard.ts` — App class + chart rendering
5. Update `src/server.ts`: use `registerAppTool` + `registerAppResource` for dashboard tool
6. Build (server + UI), restart, test

**Test checkpoint:** Dashboard renders in Claude Desktop with live data from SQLite.

### Phase 4 — Polish
1. Error handling, edge cases, empty states
2. README.md
3. npm publish preparation if desired

---

## Critical Reminders

- **No console.log** — corrupts MCP stdio. Use `console.error` for debug.
- **ES modules throughout** — `"type": "module"` in package.json, `.js` extensions in all imports.
- **File I/O via Desktop Commander** — not cat/type/echo.
- **Restart Claude Desktop** after any change to claude_desktop_config.json or after rebuilding the MCP server. Ask the user to restart — you cannot do this yourself.
- **Check Context7** for `@modelcontextprotocol/ext-apps` patterns before writing MCP App code.
- **Check Gemini MCP** (grounding disabled) for any version/API uncertainties.
- **Reference seo-crawler-mcp** at `C:\MCP\seo-crawler-mcp\src\core\CrawlDatabase.ts` for the proven SQLite + MCP pattern.
- **UI reference screenshots** in `C:\MCP\better-search-console\` (5 JPGs) — dark theme dashboard with hero metrics, dual-axis charts, sortable tables with Growing/Decaying tabs, expandable modals. Full analysis in `UI_REFERENCE.md`.


---

## User Stories & Query Patterns

These user stories drive the tool design and pre-built SQL queries. Each story maps to
a specific insight or filter that the `get_insights` tool (and eventually the dashboard UI)
must support.

### Story 1: "What's my overall performance?"
**Persona:** Site owner doing a weekly check
**Query:** Total clicks, impressions, average CTR, average position for current period vs prior period
**SQL pattern:**
```sql
-- Current period
SELECT SUM(clicks), SUM(impressions),
       ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
       ROUND(AVG(position), 1) as avg_position
FROM search_analytics WHERE date BETWEEN ? AND ?

-- Prior period (same duration, shifted back)
-- Calculate % change for each metric
```
**Maps to:** `get_insights` → `summary`

### Story 2: "Which queries are growing?"
**Persona:** Content strategist looking for momentum
**Question:** Which queries gained the most clicks compared to the prior period?
**SQL pattern:**
```sql
SELECT query,
       SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as current_clicks,
       SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
       current_clicks - prior_clicks as click_change,
       ROUND((current_clicks - prior_clicks) * 100.0 / NULLIF(prior_clicks, 0), 1) as pct_change
FROM search_analytics
GROUP BY query
HAVING current_clicks > 0
ORDER BY click_change DESC
LIMIT 50
```
**Maps to:** `get_insights` → `growing_queries`

### Story 3: "Which queries are declining?"
**Persona:** SEO monitoring for problems
**Question:** Which queries lost the most clicks? Early warning for content decay or algorithm changes.
**SQL pattern:** Same as Story 2 but `ORDER BY click_change ASC` (biggest losers first)
**Maps to:** `get_insights` → `declining_queries`

### Story 4: "Where are my quick wins?"
**Persona:** SEO looking for low-hanging fruit
**Question:** Queries with high impressions but low CTR, ranking position 4-20 — a small improvement in title/description could yield big click gains.
**SQL pattern:**
```sql
SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
       ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
       ROUND(AVG(position), 1) as avg_position
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY query
HAVING avg_position BETWEEN 4 AND 20
   AND impressions > 100
ORDER BY impressions DESC
LIMIT 50
```
**Maps to:** `get_insights` → `opportunities`

### Story 5: "Which pages are winning/losing?"
**Persona:** Content team prioritising updates
**Question:** Which pages gained or lost the most clicks? Identifies content that needs refreshing vs content riding a wave.
**SQL pattern:** Same period comparison as Story 2/3 but grouped by `page` instead of `query`
**Maps to:** `get_insights` → `growing_pages`, `declining_pages`

### Story 6: "Show me branded vs non-branded"
**Persona:** Marketing lead assessing brand strength vs organic discovery
**Question:** What proportion of clicks come from branded queries? Is non-branded growing?
**Filter:** User provides a list of brand terms (e.g. `simracingcockpit`, `sim racing cockpit`, `src`)
**SQL pattern:**
```sql
SELECT
  CASE WHEN query LIKE '%simracingcockpit%' OR query LIKE '%sim racing cockpit%'
       THEN 'branded' ELSE 'non-branded' END as segment,
  SUM(clicks) as clicks, SUM(impressions) as impressions
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY segment
```
**Maps to:** `get_insights` → `branded_split` (requires brand terms as input parameter)

### Story 7: "What's happening by device?"
**Persona:** Technical SEO checking mobile vs desktop performance
**Question:** How do clicks, impressions, CTR, position break down by device type? Is mobile underperforming?
**SQL pattern:**
```sql
SELECT device,
       SUM(clicks), SUM(impressions),
       ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
       ROUND(AVG(position), 1) as avg_position
FROM search_analytics WHERE date BETWEEN ? AND ?
GROUP BY device ORDER BY SUM(clicks) DESC
```
**Maps to:** `get_insights` → `device_breakdown`

### Story 8: "Which countries drive my traffic?"
**Persona:** International SEO or site owner understanding audience geography
**SQL pattern:** Same as device breakdown but `GROUP BY country`
**Maps to:** `get_insights` → `country_breakdown`

### Story 9: "What queries drive traffic to this specific page?"
**Persona:** Content writer optimising a specific article
**Question:** For `/best-sim-rigs-on-the-market/`, which queries send traffic? What's the position for each?
**SQL pattern:**
```sql
SELECT query, SUM(clicks), SUM(impressions),
       ROUND(AVG(position), 1) as avg_position
FROM search_analytics
WHERE page LIKE '%/best-sim-rigs-on-the-market/%'
  AND date BETWEEN ? AND ?
GROUP BY query ORDER BY SUM(clicks) DESC
```
**Maps to:** `query_gsc_data` (custom SQL) or `get_insights` → `page_queries` with page filter

### Story 10: "Which pages rank for this query?"
**Persona:** SEO checking for keyword cannibalisation
**Question:** Multiple pages ranking for the same query = they compete with each other. Show all pages ranking for "fov calculator".
**SQL pattern:**
```sql
SELECT page, SUM(clicks), SUM(impressions),
       ROUND(AVG(position), 1) as avg_position
FROM search_analytics
WHERE query = 'fov calculator' AND date BETWEEN ? AND ?
GROUP BY page ORDER BY avg_position ASC
```
**Maps to:** `get_insights` → `query_pages` with query filter (cannibalisation detector)

### Story 11: "Show me the daily trend"
**Persona:** Anyone monitoring for traffic drops/spikes
**Question:** Daily clicks and impressions over time — spot anomalies, algorithm updates, seasonal patterns.
**SQL pattern:**
```sql
SELECT date, SUM(clicks), SUM(impressions)
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY date ORDER BY date ASC
```
**Maps to:** Dashboard chart data, also `get_insights` → `daily_trend`

### Story 12: "What's new in my rankings?"
**Persona:** SEO tracking content launch impact
**Question:** Queries that appear in the current period but were absent in the prior period — new rankings.
**SQL pattern:**
```sql
SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
       ROUND(AVG(position), 1) as avg_position
FROM search_analytics
WHERE date BETWEEN ? AND ?
  AND query NOT IN (
    SELECT DISTINCT query FROM search_analytics
    WHERE date BETWEEN ? AND ?
  )
GROUP BY query
ORDER BY impressions DESC
LIMIT 50
```
**Maps to:** `get_insights` → `new_queries`

### Story 13: "What queries did I lose entirely?"
**Persona:** SEO diagnosing a traffic drop
**Question:** Queries present in the prior period but absent in the current period — lost rankings.
**SQL pattern:** Inverse of Story 12
**Maps to:** `get_insights` → `lost_queries`

### Story 14: "Filter by URL path/section"
**Persona:** SEO managing different site sections
**Question:** Show me just `/blog/` performance, or just `/products/`, or just `/guides/`
**Filter:** `page LIKE '/blog/%'` applied to any of the above stories
**Maps to:** Optional `pageFilter` parameter on `get_insights` and `compare_periods`

### Story 15: "Compare this month to last month"
**Persona:** Monthly reporting
**Question:** Side-by-side comparison of two arbitrary date ranges across any dimension
**Maps to:** `compare_periods` tool directly

---

## Revised Insight Types for `get_insights` Tool

Based on the user stories above, the complete list of insight types:

| Insight Key | Description | Stories |
|---|---|---|
| `summary` | Hero metrics with % change vs prior period | 1 |
| `top_queries` | Highest click queries for period | 2, 3 |
| `top_pages` | Highest click pages for period | 5 |
| `growing_queries` | Queries with biggest click increase | 2 |
| `declining_queries` | Queries with biggest click decrease | 3 |
| `growing_pages` | Pages with biggest click increase | 5 |
| `declining_pages` | Pages with biggest click decrease | 5 |
| `opportunities` | High impressions, low CTR, position 4-20 | 4 |
| `device_breakdown` | Metrics by device type | 7 |
| `country_breakdown` | Metrics by country | 8 |
| `page_queries` | Queries for a specific page | 9 |
| `query_pages` | Pages for a specific query (cannibalisation) | 10 |
| `daily_trend` | Daily clicks + impressions time series | 11 |
| `new_queries` | Queries appearing for first time | 12 |
| `lost_queries` | Queries that disappeared | 13 |
| `branded_split` | Branded vs non-branded breakdown | 6 |

### Common Filter Parameters (apply to any insight)

| Parameter | Type | Description |
|---|---|---|
| `dateRange` | string | `7d`, `28d`, `3m`, `6m`, `12m`, `16m` |
| `pageFilter` | string | URL path filter, e.g. `/blog/` (uses LIKE) |
| `queryFilter` | string | Query text filter (uses LIKE) |
| `device` | string | `DESKTOP`, `MOBILE`, `TABLET` |
| `country` | string | ISO country code |
| `brandTerms` | string[] | Brand terms for branded/non-branded split |
| `limit` | number | Max rows returned, default 50 |
| `minClicks` | number | Minimum clicks threshold |
| `minImpressions` | number | Minimum impressions threshold |

---

## GSC Pain Points We Solve

These are the specific frustrations with native Google Search Console that our tool addresses:

1. **1,000-row export limit** → We fetch ALL rows via API pagination and store in SQLite. No limits.
2. **No period comparison in tables** → Every table shows % change vs prior period. Growing/Decaying tabs.
3. **Can't combine query + page easily** → SQLite lets you JOIN and GROUP BY any combination of dimensions.
4. **16-month data cap** → We store locally. Once synced, data persists forever. Historical archive.
5. **2-3 day data delay** → We use `dataState: 'all'` to include fresh/partial data.
6. **No cannibalisation detection** → Story 10: which pages compete for the same query.
7. **No new/lost query tracking** → Stories 12-13: detect new appearances and disappearances.
8. **No branded/non-branded split** → Story 6: user-defined brand terms for segmentation.
9. **No custom SQL** → `query_gsc_data` tool lets you run arbitrary read-only SQL.
10. **No offline access** → Data in SQLite, queryable without internet after initial sync.
