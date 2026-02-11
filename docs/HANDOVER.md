# Better Search Console - Handover: Background Sync with Progress UI

**Date:** 11 February 2026
**Status:** Design ready, implementation needed
**Priority:** High - sync operations fail silently or timeout, blocking core functionality
**Depends on:** HANDOVER-01 (dashboard rendering) — COMPLETED

---

## The Problem

### What happens now

Every sync operation (`sync_gsc_data`, `sync_all_properties`) runs as a blocking MCP tool call.
Claude Desktop waits for the tool to return. Large properties timeout after ~60 seconds.
The user sees nothing — no progress, no feedback, no way to cancel.

Concrete failures observed today (11 Feb 2026):
- `sync_all_properties` fails as a tool call — times out trying to iterate 23 properties
- `sync_gsc_data` for large properties (simracingcockpit.gg: 400k+ rows) times out
- Even successful syncs (rcr.com.au: 15k rows) give zero progress feedback
- Properties synced months ago have stale data (simracingcockpit.gg data ends Jan 2025)
- The overview only shows 2 of 6 synced properties because the rest have no recent data

### Why this matters

The overview dashboard (fixed in HANDOVER-01) is only useful if properties have current data.
Right now, getting data into the system is the bottleneck. The query/analysis tools are fast
and work perfectly — the sync is the broken part.

### Root cause

MCP tool calls in Claude Desktop have a timeout (~60 seconds). The GSC API returns max 25,000
rows per request. A property with 400k rows needs 16+ paginated API calls. Each call takes
2-5 seconds. That's 30-80 seconds just for API calls, plus SQLite insert time. Large properties
will always exceed the timeout.

The fundamental issue: **sync is a background job pretending to be a synchronous tool call.**

---

## The Vision: Sync as a Background Operation with Progress UI

### User experience goal

1. User says "sync all my properties" or "sync simracingcockpit.gg"
2. Tool returns IMMEDIATELY with a job ID and status
3. An ext-apps iframe renders a progress bar showing:
   - Which property is syncing
   - Rows fetched / estimated total
   - Elapsed time
   - A cancel button
4. The sync runs in the MCP server process — NOT tied to Claude's tool call lifecycle
5. User can continue chatting. The progress bar updates independently.
6. When complete, the overview automatically has fresh data

### Why ext-apps is the right pattern here

The LibreChat RFC (https://github.com/danny-avila/LibreChat/discussions/11581, 30 Jan 2026)
confirms ext-apps is being actively implemented across hosts. The spec (stable 2026-01-26)
supports exactly this pattern:

- The iframe gets a bidirectional JSON-RPC bridge back to the host
- The UI can call other tools, receive notifications, and maintain state
- The iframe lifecycle is independent of the tool call that spawned it

This means the progress bar iframe can:
- Poll a `check_sync_status` tool for updates
- Send a `cancel_sync` call via the bridge
- Persist across the conversation (user keeps chatting)
- Update in real-time without Claude being involved

Even if Claude Desktop doesn't render the iframe TODAY, the text-content fallback works:
the tool returns immediately with a job ID, and the user (or Claude) can poll status manually.

---

## Architecture: Three-Layer Design

### Layer 1: Sync Worker (Background Process)

A sync job runner that operates independently of MCP tool call lifecycles.

```
SyncManager (singleton in MCP server process)
├── jobQueue: Map<jobId, SyncJob>
├── startSync(siteUrl, options) → jobId
├── startSyncAll(options) → jobId
├── getStatus(jobId) → SyncStatus
├── cancelJob(jobId) → void
└── activeWorker: runs in setInterval or worker_thread
```

**SyncJob state machine:**
```
queued → syncing → completed
                 → failed
                 → cancelled
```

**SyncStatus shape:**
```typescript
interface SyncStatus {
  jobId: string;
  status: 'queued' | 'syncing' | 'completed' | 'failed' | 'cancelled';
  
  // Overall progress (for sync_all)
  totalProperties: number;
  completedProperties: number;
  currentProperty: string | null;
  
  // Current property progress
  rowsFetched: number;
  estimatedTotalRows: number | null;  // from first API response metadata
  apiCallsMade: number;
  
  // Timing
  startedAt: string;
  elapsedMs: number;
  
  // Results (populated as properties complete)
  results: Array<{
    siteUrl: string;
    status: 'completed' | 'failed' | 'skipped';
    rowsFetched: number;
    durationMs: number;
    error?: string;
  }>;
  
  // Error info
  error?: string;
}
```

**Implementation approach:** Use `setImmediate` / `setTimeout` chunking within the Node.js
event loop rather than worker_threads. The MCP server is already a long-running process —
we just need the sync work to yield between API calls so the MCP message loop can handle
incoming tool calls (like `check_sync_status` or `cancel_sync`).

Key pattern:
```typescript
async function syncPropertyAsync(job: SyncJob, gscClient: GscClient): Promise<void> {
  while (hasMorePages && !job.cancelled) {
    const batch = await gscClient.fetchPage(siteUrl, startRow);
    db.insertBatch(batch.rows);
    job.rowsFetched += batch.rows.length;
    job.apiCallsMade++;
    
    // Yield to event loop — allows other tool calls to be processed
    await new Promise(resolve => setImmediate(resolve));
  }
}
```

### Layer 2: MCP Tools (Thin Wrappers)

Three new tools replace the blocking sync tools:

**`sync_gsc_data`** — MODIFIED (non-breaking)
- Starts a background sync job instead of blocking
- Returns immediately with `{ jobId, status: 'queued' }`
- Same parameters as current tool
- Text content includes job ID for manual polling

**`check_sync_status`** — NEW
- Takes `jobId` (optional — if omitted, returns all active/recent jobs)
- Returns `SyncStatus` object
- Fast, non-blocking — just reads job state

**`cancel_sync`** — NEW
- Takes `jobId`
- Sets cancellation flag on the job
- Worker checks flag between API calls and stops gracefully
- Returns confirmation

### Layer 3: Progress UI (ext-apps iframe)

The `sync_gsc_data` tool registers as an ext-app with a progress UI:

```typescript
const syncResourceUri = 'ui://sync/progress.html';

registerAppTool(server, 'sync_gsc_data', {
  title: 'Sync GSC Data',
  description: '...',
  inputSchema: { ... },
  _meta: { ui: { resourceUri: syncResourceUri } },
}, async (args) => {
  const jobId = syncManager.startSync(args.siteUrl, args);
  const status = syncManager.getStatus(jobId);
  return {
    content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
    structuredContent: status,
  };
});
```

**Progress iframe behaviour:**
1. Receives initial `structuredContent` with jobId and status
2. Polls `check_sync_status` via JSON-RPC bridge every 2 seconds
3. Renders:
   - Property name and sync progress bar (rows fetched / estimated total)
   - For sync_all: overall progress (N of M properties)
   - Elapsed time
   - Cancel button (calls `cancel_sync` via bridge)
4. On completion: shows summary with row counts per property
5. Fallback: if iframe doesn't render, the text content has the job ID and
   Claude or the user can call `check_sync_status` manually

---

## Migration Path: Current → Background Sync

### What changes

| Current | New |
|---|---|
| `sync_gsc_data` blocks until complete or timeout | Returns immediately with job ID |
| `sync_all_properties` blocks (always times out) | Returns immediately with job ID |
| No progress feedback | `check_sync_status` tool + optional progress iframe |
| No cancellation | `cancel_sync` tool + cancel button in iframe |
| Sync failure = tool error | Sync failure = status in job record |

### What stays the same

- All parameters for `sync_gsc_data` unchanged
- Database format unchanged (same SQLite files)
- All query/analysis tools unchanged
- `getDbPath`, `sanitizeSiteUrl`, data directory — all unchanged
- Incremental sync logic unchanged (checks last sync date)

### Backward compatibility

The tool signature doesn't change. The only difference is the response shape — instead of
returning final sync results, it returns a job status object. Any automation that parses
the response will need to handle the new shape, but since this is an MCP tool called by
Claude, the LLM adapts automatically.

---

## Implementation Checklist

### Phase 1: SyncManager (background job runner)
- [ ] Create `src/core/SyncManager.ts`
- [ ] Implement job queue with Map<jobId, SyncJob>
- [ ] Implement async sync worker with setImmediate yielding
- [ ] Implement cancellation via flag checking between API calls
- [ ] Implement estimated total rows from API response metadata
- [ ] Store job history (last 50 jobs) for status queries
- [ ] Wire into existing `syncData()` function — reuse all pagination/insert logic

### Phase 2: Tool changes in server.ts
- [ ] Modify `sync_gsc_data` handler to start background job and return immediately
- [ ] Modify `sync_all_properties` handler to queue all properties and return immediately
- [ ] Add `check_sync_status` tool (reads job state, returns SyncStatus)
- [ ] Add `cancel_sync` tool (sets cancellation flag)
- [ ] Register sync tools as ext-apps with progress UI resource URI

### Phase 3: Progress UI (ext-apps iframe)
- [ ] Create `src/ui/sync-progress.html` (or Vite-built equivalent)
- [ ] Implement polling loop via JSON-RPC bridge
- [ ] Render progress bar, property name, row counts, elapsed time
- [ ] Implement cancel button
- [ ] Handle sync_all multi-property progress display
- [ ] Register as ext-apps resource
- [ ] Test with and without iframe rendering (text fallback must work)

### Phase 4: Testing
- [ ] Small property sync (rcr.com.au ~15k rows) — should complete in seconds
- [ ] Large property sync (simracingcockpit.gg ~400k rows) — should show progress
- [ ] sync_all with 23 properties — should queue all and process sequentially
- [ ] Cancel mid-sync — should stop gracefully
- [ ] check_sync_status during active sync — should return current progress
- [ ] check_sync_status after completion — should return final results
- [ ] Multiple concurrent tool calls during sync — event loop must not block

---

## Files to Create/Change

| File | Action | Description |
|---|---|---|
| `src/core/SyncManager.ts` | CREATE | Background job runner, queue, status tracking |
| `src/tools/sync-data.ts` | MODIFY | Extract core sync logic into reusable async function |
| `src/server.ts` | MODIFY | Wire SyncManager, change sync handlers, add new tools |
| `src/ui/sync-progress.html` | CREATE | Progress bar iframe UI |
| `vite.config.ts` | MODIFY | Add sync-progress to build pipeline |

---

## Key Design Decisions

### Why not worker_threads?

Worker threads add complexity (serialisation, message passing, separate V8 isolate) and
the MCP server already runs as a single long-lived process. The sync work is I/O-bound
(waiting for GSC API responses and SQLite writes), not CPU-bound. Using `setImmediate`
between API calls lets the event loop process incoming MCP messages (tool calls) whilst
the sync continues in the background. Simpler, fewer failure modes.

### Why not a separate CLI tool?

A standalone `npx @houtini/bsc-sync` was considered for bulk initial loads. This could
still be useful, but the background sync pattern solves the same problem within the MCP
server itself. The SyncManager could be extracted into a shared module used by both the
MCP server and a CLI tool if needed later.

### Why estimated total rows?

The GSC API doesn't return a total count upfront. But after the first 25,000-row page,
we can estimate: if the API returns exactly 25,000 rows, there are more pages. The
progress bar shows "25,000+ rows" and updates the estimate as more pages arrive. Not
perfect, but much better than no feedback.

### Why keep ext-apps + text fallback?

The ext-apps iframe is the ideal UX — real progress bar, cancel button, independent of
Claude's conversation flow. But it doesn't render in Claude Desktop today. The text
fallback (returning SyncStatus JSON) means the feature works NOW via manual polling,
and automatically upgrades to the visual progress bar when ext-apps support lands.

---

## Context: What We Know About ext-apps Support

### Current state (11 Feb 2026)
- ext-apps spec is stable (2026-01-26 version)
- `@modelcontextprotocol/ext-apps` npm package at v1.0.1
- Context7 docs confirm the full spec including JSON-RPC bridge
- Claude Desktop: `structuredContent` and `ui://` resources are accepted but **iframes do not render**
- VS Code Insiders: reportedly supports ext-apps
- LibreChat: RFC filed 30 Jan 2026 with working fork, 3-phase implementation plan

### LibreChat RFC key details
- Source: https://github.com/danny-avila/LibreChat/discussions/11581
- They have ext-apps working in a fork against v0.8.2
- Architecture: tool metadata pipeline → host-side API endpoints → client-side rendering
- The iframe gets bidirectional JSON-RPC bridge for tool calls and notifications
- Considering `@mcp-ui/client` SDK vs hand-rolled components
- No response from maintainers yet (0 comments as of today)

### Implication for this work
Build the SyncManager and tool changes first (works today via text fallback).
Build the iframe UI second (activates when ext-apps renders).
Both layers are needed regardless of ext-apps timeline.

---

## Resolved: HANDOVER-01 (Dashboard Rendering)

The previous handover issue has been fixed. For reference:

- `get_dashboard` now returns full JSON in the `content` text field
- `get_overview` now returns compact text with ASCII sparklines per property
- Helper functions added: `asciiSparkline()`, `formatCompact()`, `formatChange()`
- ext-apps registrations and `structuredContent` kept for future compatibility
- Build and tested successfully — both tools return real data
