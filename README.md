# Better Search Console

An MCP server that syncs Google Search Console data into local SQLite databases for fast, unlimited analysis. No 1,000-row API limits. No waiting for the GSC web interface. Just your data, locally, queryable with SQL or pre-built insights.

## What it does

- **Syncs GSC data locally** — pulls all search analytics (queries, pages, devices, countries) into SQLite, one database per property
- **Background sync** — large properties with hundreds of thousands of rows sync without blocking, with progress tracking and cancellation
- **Interactive dashboards** — ext-apps iframes render trend charts, sparklines, and metric grids directly in Claude Desktop
- **Pre-built insights** — 16 analytical queries including opportunities (page 2 rankings with high impressions), growing/declining queries, device breakdown, and more
- **Custom SQL** — run any SELECT query against your synced data
- **Period comparison** — compare any two date ranges across queries, pages, devices, or countries

## Quick start

### Prerequisites

1. A Google Cloud service account with Search Console API access
2. The service account email added as a user on your GSC properties
3. Node.js 18+

### Claude Desktop configuration

```json
{
  "mcpServers": {
    "better-search-console": {
      "command": "node",
      "args": ["C:\\MCP\\better-search-console\\dist\\index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "C:\\path\\to\\service-account.json",
        "BSC_DATA_DIR": "C:\\seo-audits\\better-search-console"
      }
    }
  }
}
```

`BSC_DATA_DIR` is optional. If omitted, databases are stored in a cross-platform default:

| OS | Default path |
|---|---|
| Windows | `C:\Users\<you>\seo-audits\better-search-console` |
| macOS | `~/seo-audits/better-search-console` |
| Linux | `~/seo-audits/better-search-console` |

### First run

Tell Claude: *"Show me my search console data"* — it will use the `setup` tool to list your properties, sync them all, and show an overview.

## Tools

| Tool | Purpose |
|---|---|
| `setup` | First-run experience: lists properties, syncs all, shows overview |
| `get_overview` | Grid of all synced properties with sparkline trends |
| `get_dashboard` | Deep dive into a single property with charts and tables |
| `get_insights` | 16 pre-built reports (opportunities, growing queries, etc.) |
| `compare_periods` | Side-by-side comparison of two date ranges |
| `query_gsc_data` | Run custom SQL against the `search_analytics` table |
| `list_properties` | Check which GSC properties are accessible |
| `sync_gsc_data` | Sync a single property (background, with progress) |
| `sync_all_properties` | Sync all properties (background, with progress) |
| `check_sync_status` | Monitor sync job progress |
| `cancel_sync` | Cancel a running sync |

## Database schema

Each property gets its own SQLite database in the data directory (see `BSC_DATA_DIR` above). The main table:

```sql
SELECT date, query, page, device, country, clicks, impressions, ctr, position
FROM search_analytics
WHERE date BETWEEN '2025-01-01' AND '2025-12-31'
  AND query LIKE '%sim racing%'
ORDER BY clicks DESC
LIMIT 20;
```

## Development

```bash
# Build everything (server TypeScript + UI bundles)
npm run build

# Build server only
npm run build:server

# Watch mode
npm run dev
```

### Project structure

```
src/
  core/           Database, GscClient, SyncManager
  tools/          Tool implementations (one file per tool)
  types/          TypeScript type definitions
  ui/             Dashboard, overview, and sync progress UIs (Vite + ext-apps)
  index.ts        Entry point
  server.ts       MCP server setup and tool registration
```

### UI architecture

The three interactive views (dashboard, overview, sync progress) are built with Vite and `vite-plugin-singlefile`, producing self-contained HTML files served via `registerAppResource`. Client-side code uses `@modelcontextprotocol/ext-apps` for bidirectional communication with the MCP server.

## Licence

Apache-2.0
