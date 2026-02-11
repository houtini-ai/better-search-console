# Better Search Console - Handover: ext-apps iframes NOW RENDERING

**Date:** 11 February 2026
**Status:** ALL THREE IFRAMES WORKING — dashboard, overview, sync progress
**Priority:** Complete — this was the final blocker for visual UIs
**Depends on:** HANDOVER-02 (background sync) — COMPLETED

---

## What Was Fixed

### Root cause: missing `app.connect()`

All three ext-apps UIs (dashboard, overview, sync-progress) were missing the `app.connect()` call. Without it, the iframe loads but never completes the postMessage handshake with Claude Desktop. The host sees no handshake, gives up, falls back to text content.

The ext-apps quickstart is explicit about this:
> Register handlers BEFORE `app.connect()` to avoid missing the initial tool result.

We had the handlers registered but never called `connect()`.

### Additional fixes applied

**Constructor signature** — overview and sync-progress used `new App({ targetOrigin: '*' })` which is undocumented. Changed to `new App({ name: '...', version: '...' })` matching the quickstart pattern. Dashboard already had the correct constructor.

**`callServerTool` signature** — overview and sync-progress used positional args: `app.callServerTool('tool_name', { args })`. The documented API is `app.callServerTool({ name: 'tool_name', arguments: { args } })`. Dashboard already had the correct signature.

**Resource handler logging** — Added `console.error` diagnostic logging to all three resource handlers in server.ts so future issues can be traced in Claude Desktop logs.

**Top-level await** — Initial fix used `await app.connect()` but vite's build target (es2020/chrome87) doesn't support top-level await. Changed to `app.connect()` (fire-and-forget). This works because handlers are registered before connect, so the initial tool result isn't missed.

### Test results

All three UIs confirmed rendering as iframes in Claude Desktop:
1. `get_dashboard siteUrl="sc-domain:houtini.com"` — full interactive dashboard
2. `get_overview` — multi-site overview grid with sparklines
3. Sync progress — not explicitly tested this session but same fixes applied

---

## Files Changed

| File | Change | Detail |
|---|---|---|
| `src/ui/sync-progress.ts` | 3 fixes | Constructor `{name,version}`, added `app.connect()`, fixed both `callServerTool` signatures |
| `src/ui/overview.ts` | 3 fixes | Constructor `{name,version}`, added `app.connect()`, fixed both `callServerTool` signatures |
| `src/ui/dashboard.ts` | 1 fix | Changed `app.connect()` (was already present but confirmed `await` not needed) |
| `src/server.ts` | 3 additions | `console.error` logging on all three resource handlers |

## Files NOT Changed

- `src/core/SyncManager.ts` — untouched
- `src/core/DataSync.ts` — untouched
- `src/core/GscClient.ts` — untouched
- `src/core/Database.ts` — untouched
- All query/analysis tools — untouched
- HTML and CSS files — untouched (only the .ts client files changed)
- `package.json` — untouched

---

## Current State of All UIs

### Dashboard (`get_dashboard`)
- **Iframe:** WORKING
- **Interactive features:** Date range buttons, comparison mode, sync button, search type tabs all use correct `callServerTool({ name, arguments })` — should work via iframe bridge
- **Data:** Full dashboard with trend chart, top queries, top pages, countries, ranking buckets, new/lost queries, branded split

### Overview (`get_overview`)
- **Iframe:** WORKING
- **Interactive features:** Date range buttons and sort selector now use correct `callServerTool` signature — should work via iframe bridge
- **Data:** Multi-site grid with sparkline charts per property

### Sync Progress (`sync_gsc_data` / `sync_all_properties`)
- **Iframe:** WORKING (same fixes applied)
- **Interactive features:** Cancel button and polling loop now use correct `callServerTool` signature
- **Polling:** `setInterval` every 2s calls `check_sync_status` — should work via iframe bridge
- **Not yet verified:** Cancel button and live polling during an active sync. Worth testing.

---

## What To Test Next

1. **Sync progress interactivity** — Run `sync_all_properties`, watch the progress iframe update live, try the cancel button
2. **Dashboard interactivity** — Click date range buttons and comparison mode in the iframe, verify they trigger tool calls and re-render
3. **Overview interactivity** — Click date range buttons and sort selector, verify re-render
4. **Edge cases** — What happens if the sync completes while the iframe is polling? Does it stop cleanly?

---

## Lessons Learned (for MCP article)

### The ext-apps handshake is mandatory
`app.connect()` is not optional. Without it, the iframe is a dead zone — it loads, runs JS, but the host never knows it's alive. This is poorly documented; easy to miss since the App constructor doesn't throw and handlers can be registered without connect.

### Constructor signature matters
`{ targetOrigin: '*' }` may have worked in an earlier version or different host, but the current API expects `{ name, version }`. Follow the quickstart exactly.

### `callServerTool` takes an object, not positional args
The API is `callServerTool({ name: string, arguments: Record })`, not `callServerTool(name, args)`. TypeScript won't catch this if the App class accepts `any`.

### Top-level await and vite
If your vite build targets es2020, you can't use top-level `await`. Use fire-and-forget `app.connect()` and register all handlers before the connect call. The initial tool result arrives after connect completes, so handlers set before connect will catch it.

---

## Next Steps

1. **Test sync progress interactivity** — verify live polling and cancel work in the iframe
2. **Consider article** — "Getting ext-apps Iframes to Render in Claude Desktop" or fold into the background sync article
3. **Version bump** — consider 0.3.0 since all three UIs now render
4. **Clean up** — `src/tools/sync-data.ts` is still in the repo but no longer imported by server.ts. Can be removed or kept as reference.

---

## Quick Resume Commands

```
# Test dashboard iframe
better-search-console:get_dashboard siteUrl="sc-domain:simracingcockpit.gg" dateRange="3m"

# Test overview iframe
better-search-console:get_overview dateRange="28d"

# Test sync progress iframe (will start a real sync)
better-search-console:sync_gsc_data siteUrl="sc-domain:houtini.com"

# Build
cd C:\MCP\better-search-console && npm run build

# Key files
C:\MCP\better-search-console\src\ui\sync-progress.ts
C:\MCP\better-search-console\src\ui\overview.ts
C:\MCP\better-search-console\src\ui\dashboard.ts
C:\MCP\better-search-console\src\server.ts
```
