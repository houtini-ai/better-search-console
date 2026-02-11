# Better Search Console - Handover: ext-apps iframe rendering

**Date:** 11 February 2026
**Status:** Background sync WORKING, iframe UI BUILT but not rendering
**Priority:** Medium - functional via text fallback, iframe is UX upgrade
**Depends on:** HANDOVER (background sync) — COMPLETED AND TESTED

---

## What Was Done Today

### Phase 1+2: Background Sync (COMPLETE, TESTED, WORKING)

Created `src/core/SyncManager.ts` — background job runner with:
- Job queue (`Map<jobId, SyncJob>`), max 50 job history
- Non-blocking via `async/await` + `setImmediate` yields between API calls
- Live progress: `rowsFetched`, `apiCallsMade`, `estimatedTotalRows`, `currentProperty`
- Cancellation via flag checked every 500ms on AbortController
- Incremental sync preserved (checks last sync date, skips if current)

Modified `src/server.ts`:
- `sync_gsc_data` — starts background job, returns immediately with job ID
- `sync_all_properties` — queues all properties, returns immediately
- `check_sync_status` (NEW) — reads job state with live progress
- `cancel_sync` (NEW) — graceful cancellation
- Both sync tools converted to `registerAppTool` with `structuredContent` and `ui://sync/progress.html`
- Sync progress UI resource registered
- Version bumped to 0.2.0
- Removed `syncData` import (old blocking module)

### Test Results (all passing)

1. `sync_gsc_data` for rcr.com.au — returned instantly, completed in background (already current)
2. `sync_gsc_data` for simracingcockpit.gg — returned instantly, skipped (already current, 800k rows)
3. `sync_all_properties` — queued 23 properties, returned instantly, live progress showed 10/23 mid-sync with 145k rows
4. `cancel_sync` — cancelled at 12/23 properties (1.4M rows fetched), stopped gracefully
5. Error handling — rcr.nz permission error caught, job continued to next property

### Phase 3: Progress UI (BUILT, NOT RENDERING)

Created three files:
- `src/ui/sync-progress.html` — layout with progress bars, status badge, results list, cancel button
- `src/ui/sync-progress-styles.css` — dark theme matching dashboard/overview
- `src/ui/sync-progress.ts` — ext-apps client using `App` from `@modelcontextprotocol/ext-apps`

Added build script in `package.json`:
```
"build:ui:sync": "cross-env INPUT=src/ui/sync-progress.html vite build --outDir dist/sync-progress --emptyOutDir"
```

Full build passes cleanly. Vite bundles to `dist/sync-progress/src/ui/sync-progress.html` (375KB, 91KB gzip).

---

## The Iframe Problem

### Current state
- ext-apps iframes DO render in Claude Desktop as of Jan 26, 2026 launch
- Our existing dashboard/overview UIs also don't render as iframes (same pattern)
- All three UIs fall back to text/JSON content (which works fine functionally)
- The sync progress UI uses identical patterns to dashboard/overview

### What Gemini research found
Claude Desktop enforces strict CSP: `frame-src 'self' blob: data:`
- All UI must be bundled as local assets (we do this via vite-plugin-singlefile)
- No external domain embedding allowed
- `ui://` resources ARE supported
- No distinction between launch partners and community servers

### Possible issues to investigate

1. **Missing `app.connect()`** — The ext-apps quickstart calls `app.connect()` explicitly. Our UIs (overview, dashboard, sync-progress) all skip this. The overview/dashboard work via text fallback without it. Try adding `await app.connect()` after instantiation.

2. **Constructor signature** — Quickstart uses `new App({ name: "...", version: "..." })`, our code uses `new App({ targetOrigin: '*' })`. May need to match quickstart pattern.

3. **Resource URI path** — Our resource handler reads from `dist/sync-progress/src/ui/sync-progress.html`. Verify the HTML file is actually being served when Claude requests the resource. Add `console.error` logging to the resource handler to confirm it's called.

4. **CSP compatibility** — Check if the bundled HTML contains anything that violates `frame-src 'self' blob: data:`. The singlefile bundle inlines everything, which should be fine, but worth checking.

5. **Claude Desktop version** — Confirm the installed version supports ext-apps. May need update.

6. **Test with quickstart example** — Clone the ext-apps quickstart, build it, add to claude_desktop_config.json, and see if THAT renders. If it does, diff against our implementation.

---

## Files Changed

| File | Action | Description |
|---|---|---|
| `src/core/SyncManager.ts` | CREATED | Background job runner, queue, status tracking |
| `src/server.ts` | MODIFIED | SyncManager wired in, sync tools now background, 2 new tools, sync UI resource |
| `src/ui/sync-progress.html` | CREATED | Progress bar iframe UI layout |
| `src/ui/sync-progress-styles.css` | CREATED | Dark theme styles |
| `src/ui/sync-progress.ts` | CREATED | ext-apps client with polling and cancel |
| `package.json` | MODIFIED | Added build:ui:sync script |

## Files NOT Changed

- `src/core/DataSync.ts` — untouched
- `src/core/GscClient.ts` — untouched
- `src/core/Database.ts` — untouched
- `src/tools/sync-data.ts` — still exists but no longer imported by server.ts
- All query/analysis tools — untouched
- Dashboard and overview UIs — untouched

---

## Next Steps

1. **Debug iframe rendering** — Follow investigation list above, start with quickstart example
2. **Update HANDOVER.md** — Mark Phase 1+2 as complete, Phase 3 as built-but-not-rendering
3. **Consider article** — "Building Background Sync for MCP: From Blocking Timeouts to Live Progress" covers a real problem others will hit

---

## Quick Resume Commands

```
# Check sync status
better-search-console:check_sync_status

# Test a sync
better-search-console:sync_gsc_data siteUrl="sc-domain:houtini.com"

# Build
cd C:\MCP\better-search-console && npm run build

# Files to read for context
C:\MCP\better-search-console\src\core\SyncManager.ts
C:\MCP\better-search-console\src\server.ts
C:\MCP\better-search-console\src\ui\sync-progress.ts
```
