# Better Search Console - Handover: Setup Flow & Broken server.ts

**Date:** 11 February 2026  
**Status:** CODE IS BROKEN — server.ts truncated, build fails  
**Priority:** CRITICAL — must fix before anything else  
**Depends on:** HANDOVER-03 (iframe fix) — that work is complete and should be preserved

---

## What Happened

A refactoring of `src/server.ts` was started to improve the first-time user experience. The goal was to reorder tool registrations and add a `setup` command. The file was being rewritten but the process was interrupted, leaving the file **truncated at 270 lines** (original was 404 lines).

### Build Error
```
src/server.ts(270,1): error TS1005: '}' expected.
```

### What's Missing from server.ts

The file cuts off after the `get_insights` tool registration. Everything below that is gone:

1. **`compare_periods` tool** — period comparison across dimensions
2. **`query_gsc_data` tool** — raw SQL queries against synced data
3. **`list_properties` tool** — list accessible GSC properties
4. **`sync_gsc_data` tool** (registerAppTool with sync-progress UI)
5. **`sync_all_properties` tool** (registerAppTool with sync-progress UI)
6. **`check_sync_status` tool** — poll sync job progress
7. **`cancel_sync` tool** — cancel running sync
8. **All 3 `registerAppResource` calls** — dashboard HTML, overview HTML, sync-progress HTML
9. **The `run()` function** — stdio transport connection
10. **The closing `return { server, run }` and `}`** — the createServer export

### What Was Successfully Changed (and should be kept)

These changes in the first 270 lines are good and represent the design intent:

1. **Version bumped** to `0.3.0`
2. **Resource URIs declared upfront** (lines 47-49) — cleaner than inline
3. **New `setup` tool added** (Tool 1) — first-run experience that:
   - Lists properties via `listProperties(gscClient)`
   - Starts `syncManager.startSyncAll({})`
   - Polls sync status every 2s until complete
   - Generates overview data sorted by clicks, 3m range
   - Returns text summary with "What would you like to do next?" menu
   - Uses overview iframe as its UI (`_meta.ui.resourceUri: overviewResourceUri`)
4. **`get_overview` rewritten** (Tool 2) — better description, empty-state message pointing to `setup`
5. **`get_dashboard` rewritten** (Tool 3) — description references the flow ("Get siteUrl from overview")
6. **`get_insights` rewritten** (Tool 4) — better description mentioning `opportunities` specifically

### What Needs to Happen

**Option A: Complete the rewrite** — add the missing tools back after `get_insights`, preserving:
- The new setup tool and improved descriptions from the first 270 lines
- All original tool functionality (compare_periods, query_gsc_data, sync tools)
- All 3 registerAppResource calls (CRITICAL for iframes — see HANDOVER-03)
- The run() function and createServer export

**Option B: Restore from the known-good state** — the original 404-line server.ts was captured in this conversation's earlier messages. It's in the chat history if the next session reads HANDOVER-03 context.

---

## The Design Intent (for whoever continues)

### Problem Being Solved
A new user installing better-search-console sees 10 tools with no guidance on where to start. The tool descriptions don't explain the prerequisite chain (list -> sync -> overview -> dashboard).

### Desired First-Use Flow

```
User: "Show me my search console data"
Claude: Uses `setup` tool
  1. Lists properties (shows what GSC accounts are connected)
  2. Syncs all properties (pulls data into local SQLite)
  3. Shows overview iframe (visual grid of all sites with sparklines)
  4. Text response includes "What next?" menu inviting:
     - get_dashboard for a specific site
     - get_insights for opportunities
     - compare_periods for trend analysis
     - query_gsc_data for custom SQL
```

### Tool Registration Order (intentional)
The tools should be registered in this order to reflect the user journey:

1. `setup` — "First time? Start here"
2. `get_overview` — "See all sites at a glance"
3. `get_dashboard` — "Drill into one site"
4. `get_insights` — "Pre-built reports"
5. `compare_periods` — "Compare date ranges"
6. `query_gsc_data` — "Custom SQL queries"
7. `list_properties` — "Check available properties"
8. `sync_gsc_data` — "Sync a single property"
9. `sync_all_properties` — "Sync everything"
10. `check_sync_status` — "Monitor sync progress"
11. `cancel_sync` — "Stop a sync"

### Tool Description Philosophy
Each description should:
- Lead with WHAT it does in plain language
- Mention prerequisites ("Requires synced data — run setup first if needed")
- Suggest what to do next ("Use get_dashboard to drill into any property")
- Avoid jargon where possible

---

## Files Changed

| File | Status | Detail |
|---|---|---|
| `src/server.ts` | **BROKEN — truncated** | 270 lines, missing tools 5-11, all resources, run() |

## Files NOT Changed
Everything else is untouched from HANDOVER-03 state:
- All UI files (dashboard.ts, overview.ts, sync-progress.ts) — working
- All core files (SyncManager, DataSync, GscClient, Database) — working
- All tool implementation files (get-overview.ts, get-dashboard.ts, etc.) — working
- All HTML and CSS files — working
- package.json — NOT changed (still says 0.1.0, version bump was only in server.ts const)

---

## How to Fix

### Step 1: Read the current server.ts (270 lines — the good part)
The first 270 lines contain the new setup tool, improved get_overview, get_dashboard, and get_insights. These are correct and should be kept.

### Step 2: Append the missing tools
After the `get_insights` tool (ends around line 269), add back:

- `compare_periods` — use improved description style matching the new pattern
- `query_gsc_data` — same
- `list_properties` — demote in description ("Check which properties are accessible. Usually not needed — setup handles this automatically.")
- `sync_gsc_data` with registerAppTool + syncResourceUri
- `sync_all_properties` with registerAppTool + syncResourceUri
- `check_sync_status`
- `cancel_sync`

### Step 3: Add back all 3 registerAppResource calls
CRITICAL — without these, the iframes won't render. Copy exactly from the original (the resource handlers haven't changed, they just need to be present):

```typescript
// Dashboard UI Resource
registerAppResource(server, 'Dashboard View', dashboardResourceUri, ...);

// Overview UI Resource  
registerAppResource(server, 'Overview Grid', overviewResourceUri, ...);

// Sync Progress UI Resource
registerAppResource(server, 'Sync Progress', syncResourceUri, ...);
```

### Step 4: Add back run() and export
```typescript
  const run = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
  };

  return { server, run };
}
```

### Step 5: Build and test
```bash
cd C:\MCP\better-search-console && npm run build
```

Then restart Claude Desktop and test:
```
better-search-console:get_overview dateRange="28d"
```

---

## Reference: Original server.ts Tool Registrations

For the tools that need restoring, here are the original descriptions and schemas. Update descriptions to match the new style but keep schemas identical:

### compare_periods (original)
- Description: "Compare two arbitrary date ranges side-by-side across any dimension (query, page, device, country). Shows absolute and percentage changes."
- Schema: siteUrl, period1Start, period1End, period2Start, period2End, dimension?, limit?, pageFilter?

### query_gsc_data (original)
- Description: "Run a read-only SQL query against a synced GSC property database. Supports any SELECT query. INSERT/UPDATE/DELETE/DROP/ALTER/CREATE are blocked."
- Schema: siteUrl, sql, params?

### list_properties (original)
- Description: "List all Google Search Console properties accessible via the service account, with permission level and local sync status."
- Schema: {} (no params)
- NOTE: This was a plain server.tool(), not registerAppTool

### sync_gsc_data (original)
- Uses registerAppTool with syncResourceUri
- Schema: siteUrl, startDate?, endDate?, dimensions?, searchType?

### sync_all_properties (original)
- Uses registerAppTool with syncResourceUri  
- Schema: startDate?, endDate?, dimensions?, searchType?

### check_sync_status (original)
- Plain server.tool()
- Schema: jobId?

### cancel_sync (original)
- Plain server.tool()
- Schema: jobId (required)

---

## Quick Resume Commands

```bash
# Check current state
cd C:\MCP\better-search-console && npm run build 2>&1

# Key file to fix
C:\MCP\better-search-console\src\server.ts

# After fix, test
better-search-console:get_overview dateRange="28d"
better-search-console:get_dashboard siteUrl="sc-domain:simracingcockpit.gg"
```

---

## Lessons Learned

1. **Never rewrite a 400-line file in one go** — append in chunks, build between each
2. **Git commit before refactoring** — this repo has no commits, so there's no rollback
3. **The refactoring design is sound** — the setup flow, tool ordering, and description improvements are all good. Just need to finish writing the file.
