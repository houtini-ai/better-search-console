# Better Search Console - Architecture & Research

## Research Summary (February 2026)

### MCP SDK State of the Art

- **Current SDK**: `@modelcontextprotocol/sdk` v1.26.0 (stable, production-ready)
- **SDK v2**: Pre-alpha on main branch, stable release expected Q1 2026. Stick with v1.x for now.
- **MCP Spec Version**: 2025-11-25 (latest stable protocol revision)
- **MCP Apps Extension**: `@modelcontextprotocol/ext-apps` - NOW LIVE as official extension (announced 26 Jan 2026)

### MCP Apps - UI in Claude Desktop

This is the big one. MCP servers can now return **interactive UI components** that render
directly in the conversation as sandboxed iframes. This is perfect for a "Better Search Console"
because we can build interactive dashboards, data tables, and charts.

**How it works:**
1. Tool declares `_meta.ui.resourceUri` pointing to a `ui://` resource
2. Server registers both the tool AND the UI resource (bundled HTML/JS)
3. Host fetches resource, renders in sandboxed iframe
4. Bidirectional communication via JSON-RPC over `postMessage`
5. UI can call server tools back, update model context, etc.

**Key packages:**
- `@modelcontextprotocol/ext-apps/server` - Server-side: `registerAppTool`, `registerAppResource`
- `@modelcontextprotocol/ext-apps` - Client-side (in iframe): `App` class
- `vite` + `vite-plugin-singlefile` - Bundle HTML/JS/CSS into single file for resource serving

**Client support:** Claude (web + desktop), VS Code Insiders, ChatGPT, Goose

### Google Search Console Data Extraction

**Decision: Use GSC API directly from Node.js, NOT the Python library**

The `joshcarty/google-searchconsole` Python library is nice but:
- It's Python, our MCP server is TypeScript/Node.js
- We already have service account credentials working (`C:\MCP\gsc-access-mcp-2eafbdf43abd.json`)
- The GSC API is straightforward enough to call directly via `googleapis` npm package
- We need to control the data pipeline into SQLite ourselves anyway

**API capabilities we need:**
- `searchanalytics.query` - The main one. Supports dimensions: query, page, date, device, country, searchAppearance
- `sites.list` - List all properties (already confirmed working)
- `sitemaps.list` / `sitemaps.get` - Sitemap data
- `urlInspection.index.inspect` - URL inspection

**GSC API limits to be aware of:**
- 25,000 rows per request (use `startRow` for pagination)
- 16 months of historical data
- Dimensions can be combined (query + page + date = very granular)
- `dataState: 'all'` includes fresh/unfinished data

### Reference Architecture: seo-crawler-mcp

Our existing `@houtini/seo-crawler-mcp` gives us a proven pattern:
- `better-sqlite3` for storage (WAL mode, prepared statements, transactions)
- Tool-based MCP interface with structured responses
- Clean separation: database layer, tools layer, orchestration layer
- Batch inserts via transactions for performance

---

## Architecture Design

### Core Concept

"Better Search Console" = GSC data warehouse in SQLite + interactive MCP App dashboard

**The pipeline:**
```
GSC API → Fetch all data → SQLite database → Query tools → MCP App UI dashboard
```

### Project Structure

```
src/
├── index.ts                    # MCP server entry point (stdio transport)
├── server.ts                   # McpServer setup, tool + resource registration
├── core/
│   ├── Database.ts             # SQLite schema, queries, inserts (better-sqlite3)
│   ├── GscClient.ts            # Google Search Console API wrapper (googleapis)
│   └── DataSync.ts             # Orchestrates fetching + storing GSC data
├── tools/
│   ├── sync-data.ts            # Fetch GSC data into SQLite
│   ├── query-data.ts           # Run SQL queries against stored data
│   ├── list-properties.ts      # List available GSC properties
│   ├── get-insights.ts         # Pre-built analytical queries
│   └── compare-periods.ts      # Period-over-period comparison
├── ui/
│   ├── mcp-app.html            # Main entry HTML file
│   ├── mcp-app.ts              # Client-side App logic (ext-apps)
│   ├── components/             # UI components (charts, tables, filters)
│   └── styles/                 # CSS
└── types/
    └── index.ts                # TypeScript type definitions
```

### Database Schema (SQLite)

```sql
-- Core tables
CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_url TEXT UNIQUE NOT NULL,
    permission_level TEXT,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE search_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    date TEXT NOT NULL,              -- YYYY-MM-DD
    query TEXT,
    page TEXT,
    device TEXT,                     -- DESKTOP, MOBILE, TABLET
    country TEXT,                    -- ISO 3166-1 alpha-3
    search_appearance TEXT,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    ctr REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id),
    UNIQUE(property_id, date, query, page, device, country)
);

CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    sync_type TEXT NOT NULL,         -- 'full' or 'incremental'
    dimensions TEXT NOT NULL,        -- JSON array of dimensions used
    date_from TEXT,
    date_to TEXT,
    rows_fetched INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',   -- running, completed, failed
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id)
);

-- Performance indexes
CREATE INDEX idx_sa_property_date ON search_analytics(property_id, date);
CREATE INDEX idx_sa_query ON search_analytics(query);
CREATE INDEX idx_sa_page ON search_analytics(page);
CREATE INDEX idx_sa_device ON search_analytics(device);
CREATE INDEX idx_sa_country ON search_analytics(country);
CREATE INDEX idx_sa_clicks ON search_analytics(clicks DESC);
CREATE INDEX idx_sa_impressions ON search_analytics(impressions DESC);
```

### MCP Tools

| Tool | Purpose | UI? |
|------|---------|-----|
| `sync_gsc_data` | Fetch GSC data into SQLite for a property + date range | No |
| `query_gsc_data` | Run custom SQL against the warehouse | Yes - data table |
| `list_properties` | Show available GSC properties + sync status | No |
| `get_dashboard` | Interactive dashboard with key metrics | Yes - full dashboard |
| `get_insights` | Pre-built analytical queries (winners, losers, opportunities) | Yes - insights view |
| `compare_periods` | Period-over-period comparison | Yes - comparison chart |

### MCP App UI Components

The dashboard UI will be a single bundled HTML file (via Vite + vite-plugin-singlefile) that:

1. **Receives tool results** via `app.ontoolresult` callback
2. **Calls server tools** via `app.callServerTool()` for drill-down
3. **Updates model context** via `app.updateModelContext()` so Claude knows what the user selected

**Dashboard features:**
- Top queries by clicks/impressions (sortable table)
- Clicks/impressions trend chart (date-based)
- Device breakdown (pie/bar chart)
- Country breakdown
- Page performance table
- Period comparison (% change highlighting)
- Click-to-filter: click a query to see its pages, click a page to see its queries

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "@modelcontextprotocol/ext-apps": "latest",
    "better-sqlite3": "^12.6.2",
    "googleapis": "^144.0.0",
    "zod": "^3.25.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.0.0",
    "cross-env": "^7.0.3",
    "concurrently": "^9.0.0",
    "tsx": "^4.0.0"
  }
}
```

### Authentication

We already have a service account JSON file: `C:\MCP\gsc-access-mcp-2eafbdf43abd.json`

The MCP server will accept this via environment variable:
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

## Implementation Phases

### Phase 1: Core Data Pipeline (MVP)
- [ ] Project setup (package.json, tsconfig, build pipeline)
- [ ] SQLite database schema + Database class
- [ ] GSC API client (googleapis + service account auth)
- [ ] DataSync orchestrator (pagination, batch inserts)
- [ ] Basic MCP tools: `sync_gsc_data`, `query_gsc_data`, `list_properties`
- [ ] Test with real data from existing GSC properties

### Phase 2: Analytical Tools
- [ ] `get_insights` tool with pre-built queries (top queries, declining pages, etc.)
- [ ] `compare_periods` tool for week-over-week / month-over-month
- [ ] Incremental sync (only fetch new dates)

### Phase 3: MCP App UI Dashboard
- [ ] Vite build setup for UI bundling
- [ ] `@modelcontextprotocol/ext-apps` integration
- [ ] Interactive data table component
- [ ] Trend chart (could use Chart.js bundled inline)
- [ ] Dashboard tool with `registerAppTool` + `registerAppResource`
- [ ] Bidirectional communication (click to drill down)

### Phase 4: Polish & Publish
- [ ] npm package setup (@houtini/better-search-console)
- [ ] Documentation and README
- [ ] Error handling and edge cases
- [ ] Performance optimisation for large datasets

---

## Key Decisions

1. **Node.js googleapis over Python library** - Same ecosystem as MCP server, service account auth already working, full control over data pipeline
2. **SQLite over in-memory** - Persistence between sessions, can query historical data without re-fetching
3. **MCP Apps for UI** - Brand new capability, renders interactive dashboards directly in Claude Desktop conversation
4. **Single database per property** - Stored in BSC_DATA_DIR, one .db file per GSC property
5. **Dimensions stored granularly** - Store query+page+date+device+country, aggregate in SQL at query time
