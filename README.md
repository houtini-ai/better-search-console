# Better Search Console

[![npm version](https://img.shields.io/npm/v/@houtini/better-search-console.svg?style=flat-square)](https://www.npmjs.com/package/@houtini/better-search-console)
[![Known Vulnerabilities](https://snyk.io/test/github/houtini-ai/better-search-console/badge.svg)](https://snyk.io/test/github/houtini-ai/better-search-console)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue?style=flat-square)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

**Ask Claude to analyse your Google Search Console data and get real SEO recommendations.**

The GSC API caps responses at 1,000 rows. Most tools work within that limit, so the AI only sees a fraction of your data. This MCP server syncs your *entire* Search Console dataset into a local SQLite database &mdash; every query, every page, every country, every device &mdash; then lets Claude query it directly. Complete data in, accurate recommendations out.

![Dashboard showing 82K clicks, 3.5M impressions, trend chart, and metric toggles for simracingcockpit.gg](images/header-screenshot.png)

<p align="center">
  <a href="https://glama.ai/mcp/servers/@houtini-ai/better-search-console">
    <img width="380" height="200" src="https://glama.ai/mcp/servers/@houtini-ai/better-search-console/badge" alt="Better Search Console MCP server" />
  </a>
</p>

## What makes this different

Most GSC integrations pipe raw API rows into the context window. You burn tokens on data and get analysis based on a 1,000-row sample. This server flips that:

1. **Full sync, no row limits.** Background pagination pulls every row the API has. A 28-day sync of a mid-size site fetches ~950K rows. Three months can exceed 1.7 million.
2. **Local SQLite storage.** One database per property, stored on your machine. Queries run in milliseconds. Your data never leaves your computer.
3. **Claude queries the database, not the raw data.** Pre-built SQL for 16 standard SEO analyses, plus custom SQL for anything else. Claude sees compact result sets (top 50 declining pages, not 50,000 raw rows), so answers are precise and token-efficient.
4. **Interactive dashboards rendered in Claude Desktop.** Chart.js visualisations built with Vite and served as single-file HTML via the ext-apps protocol. Light and dark theme, metric toggles, regex filtering, period comparison.

The charts give you the visual overview. The real value is what happens next &mdash; ask Claude to interpret the data:

> *"Which pages are losing clicks and what should I do about them?"*
>
> *"Find queries ranking 5-20 with high impressions. Which are worth targeting?"*
>
> *"Compare this month vs last month. What changed?"*

![Top queries table with regex filter, showing fov calculator at 9.6K clicks](images/top-queries.png)

![Position distribution buckets and new rankings table](images/position-distribution.png)

Claude analyses the full dataset and returns prioritised, specific recommendations:

![Claude providing detailed SEO recommendations: doubling down on FOV calculator ecosystem, fixing CTR problems on high-impression pages, and identifying affiliate opportunities](images/recomendations-2.png)

## Quick Start

### Step 1: Set Up Google Credentials

You need a Google Cloud service account with Search Console API access.

#### Create a Google Cloud project and enable the API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Go to **APIs and Services > Library**
4. Search for **Google Search Console API** and click **Enable**

#### Create a service account

1. Go to **APIs and Services > Credentials**
2. Click **Create Credentials > Service account**
3. Give it a name (e.g. `search-console-mcp`) and click **Create and Continue**
4. Skip the optional role and user access steps, click **Done**
5. Click on the service account you just created
6. Go to the **Keys** tab
7. Click **Add Key > Create new key > JSON**
8. Save the downloaded JSON file somewhere safe (e.g. `~/credentials/gsc-service-account.json`)

For full details, see the [Google Workspace credentials guide](https://developers.google.com/workspace/guides/create-credentials).

#### Grant the service account access to Search Console

1. Open the JSON key file and copy the `client_email` value
2. Go to [Google Search Console](https://search.google.com/search-console/)
3. Select a property
4. Go to **Settings > Users and permissions > Add user**
5. Paste the service account email and set permission to **Full**
6. Repeat for each property you want to access

### Step 2: Add to Claude Desktop

Add this to your Claude Desktop config file:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "better-search-console": {
      "command": "npx",
      "args": ["-y", "@houtini/better-search-console"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/your-service-account.json"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add \
  -e GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account.json \
  -s user \
  better-search-console -- npx -y @houtini/better-search-console
```

Verify with `claude mcp get better-search-console` &mdash; you should see `Status: Connected`.

### Step 3: Start talking to your data

Tell Claude: *"Show me my search console data"*

The `setup` tool discovers your properties, syncs them in the background, and shows an overview. Initial sync takes 30 seconds to a few minutes depending on data volume. Then ask questions:

- *"What are my fastest-growing queries this month?"*
- *"Show me pages with high impressions but low CTR"*
- *"Which queries am I ranking 11-20 for? What would it take to reach page one?"*
- *"Compare last 28 days vs the 28 days before. What's improving?"*

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | &mdash; | Path to the service account JSON key file |
| `BSC_DATA_DIR` | No | `~/seo-audits/better-search-console` | Where SQLite databases are stored |

## Tools

### Setup and Sync

| Tool | Description |
|------|-------------|
| `setup` | First-run experience. Lists properties, syncs all, returns overview |
| `sync_gsc_data` | Sync a single property. Full pagination, no row limits |
| `sync_all_properties` | Sync every accessible property (up to 2 in parallel) |
| `check_sync_status` | Poll sync progress. Omit job ID to see all jobs |
| `cancel_sync` | Stop a running sync |

### Analysis

| Tool | Description |
|------|-------------|
| `get_overview` | All properties at a glance with sparkline trends |
| `get_dashboard` | Deep dive: metrics, trend chart, top queries/pages, countries, ranking distribution, new/lost queries, branded split |
| `get_insights` | 16 pre-built analytical queries (see below) |
| `compare_periods` | Compare two date ranges across any dimension |
| `query_gsc_data` | Run any SELECT query against the raw data |
| `prune_database` | Apply data retention policy (preview mode available) |

### Insight Types

| Insight | Description |
|---------|-------------|
| `summary` | Aggregate metrics with period-over-period changes |
| `top_queries` | Highest-traffic queries |
| `top_pages` | Highest-traffic pages |
| `growing_queries` | Queries gaining clicks |
| `declining_queries` | Queries losing clicks |
| `growing_pages` | Pages gaining clicks |
| `declining_pages` | Pages losing clicks |
| `opportunities` | Queries ranking 5-20 with high impressions &mdash; your quick wins |
| `device_breakdown` | Desktop vs mobile vs tablet |
| `country_breakdown` | Traffic by country |
| `page_queries` | All queries driving traffic to a specific page |
| `query_pages` | All pages ranking for a specific query |
| `daily_trend` | Day-by-day metrics |
| `new_queries` | Queries that appeared in the current period |
| `lost_queries` | Queries that disappeared |
| `branded_split` | Branded vs non-branded traffic |

## Dashboard Rendering

The interactive dashboards are built with **Chart.js** and **Vite**, bundled into self-contained HTML files using `vite-plugin-singlefile`, and served via the MCP **ext-apps** protocol. They render inside Claude Desktop as embedded iframes.

Features include metric toggles (clicks, impressions, CTR, position), period comparison with dashed overlays, regex query/page filtering, date range presets, and automatic light/dark theme matching your system preference. Site logos are loaded dynamically via logo.dev.

If your MCP client doesn't support ext-apps, all tools return structured data that Claude can analyse directly in text.

## Custom SQL

The `query_gsc_data` tool accepts any SELECT against the `search_analytics` table:

```sql
search_analytics (
  date       TEXT,     -- YYYY-MM-DD
  query      TEXT,
  page       TEXT,
  device     TEXT,     -- DESKTOP, MOBILE, TABLET
  country    TEXT,     -- ISO 3166-1 alpha-3 lowercase
  clicks     INTEGER,
  impressions INTEGER,
  ctr        REAL,
  position   REAL
)
```

**Find cannibalisation** (multiple pages ranking for the same query):

```sql
SELECT query, COUNT(DISTINCT page) as pages, SUM(clicks) as clicks
FROM search_analytics
WHERE date >= '2025-01-01'
GROUP BY query HAVING pages > 1
ORDER BY clicks DESC LIMIT 20
```

**Content decay detection:**

```sql
SELECT page,
  SUM(CASE WHEN date >= date('now', '-28 days') THEN clicks END) as recent,
  SUM(CASE WHEN date BETWEEN date('now', '-56 days') AND date('now', '-29 days') THEN clicks END) as prior
FROM search_analytics
GROUP BY page HAVING prior > 10
ORDER BY (recent * 1.0 / NULLIF(prior, 0)) ASC LIMIT 20
```

## Data Retention

Large properties generate millions of rows. The retention system prunes automatically after each sync:

- **Recent data** (last 90 days) is never touched
- **Target countries** (US, UK, EU, AU, CA): zero-click rows kept only if 5+ impressions
- **Non-target countries**: zero-click rows deleted entirely
- **Rows with clicks are never deleted**

On a 9.8M row database, initial prune removed 6.3M rows (64%), reduced size from 6GB to 2.2GB, and preserved every click.

Run manually with `prune_database` (use `preview=true` to see what would be deleted first).

## Development

```bash
git clone https://github.com/houtini-ai/better-search-console.git
cd better-search-console
npm install
npm run build
```

| Command | Description |
|---------|-------------|
| `npm run build` | Build everything (server + UI bundles) |
| `npm run build:server` | TypeScript compilation only |
| `npm run build:ui` | Vite builds for all three UI views |
| `npm run dev` | Watch mode for server TypeScript |
| `npm start` | Run the compiled server |

## Troubleshooting

**"No Google Search Console properties found"** &mdash; The service account needs to be added as a user on each property in Search Console > Settings > Users and permissions.

**Sync takes a long time** &mdash; Large properties with years of data can have millions of rows. Initial sync for 10M rows takes 5-10 minutes. Subsequent syncs are incremental.

**ext-apps UI not rendering** &mdash; The dashboards require Claude Desktop with ext-apps support. Text-based fallback responses still contain all the data.

## Licence

Apache-2.0. See [LICENSE](LICENSE) for details.

---

Built by [Houtini](https://houtini.ai) for the Model Context Protocol community.
