# Enhancement Spec Task — Better Search Console

You are enhancing an existing, working MCP server at `C:\MCP\better-search-console`.

## Context

The server is built and functioning. It syncs Google Search Console data into SQLite
and serves an interactive dashboard UI via the MCP Apps extension in Claude Desktop.
Phase 1 (data pipeline) and Phase 2 (analytical tools) are complete. Phase 3 (dashboard UI)
is working — the `get_dashboard` tool renders an interactive dashboard in conversation.

Your job is to analyse reference screenshots, compare them against what we've built,
and write an enhancement spec for the next iteration.

## Step 1: Read the current spec and source

1. Read `C:\MCP\better-search-console\SPEC.md` — the full execution plan with user stories
2. Read `C:\MCP\better-search-console\UI_REFERENCE.md` — existing UI analysis
3. Skim the current dashboard UI source: `C:\MCP\better-search-console\src\ui\dashboard.html`
4. Check `C:\MCP\better-search-console\src\server.ts` for currently registered tools

## Step 2: Analyse the reference screenshots

Load and study each of these images carefully. They are from a commercial GSC dashboard
tool and represent the UX standard we want to match or exceed.

**Files to analyse (load each one):**

- `C:\MCP\better-search-console\main-dashnoard.jpg` — Main single-property dashboard. Note: hero metrics bar, dual-axis trend chart with 4 metrics (clicks cyan, impressions purple, CTR and position in orange tones), Queries table (left) and Pages table (right) both with All/Growing/Decaying tabs, EXPAND buttons, percentage change formatting.

- `C:\MCP\better-search-console\dashboard-4.jpg` — Same dashboard with all 4 metrics enabled (clicks, impressions, CTR, position). Note the additional hero metric cards and extra chart lines. Tables show CTR and Position columns alongside Clicks and Impressions.

- `C:\MCP\better-search-console\dashboard-3.jpg` — Below-the-fold sections: Branded vs Non-Branded clicks (with Trend/Comparison toggle), Query Counting (Total/By Ranking), Countries table with flag icons and All/Growing/Decaying tabs, New Rankings section.

- `C:\MCP\better-search-console\expanded.jpg` — Expanded/modal view of the Pages table. Full-width overlay with all columns (Clicks, Impressions, CTR, Position), horizontal bar chart behind URLs proportional to clicks, scrollable list, close button.

- `C:\MCP\better-search-console\overview-domain-summary.jpg` — Multi-site overview page. Grid of property cards (3 columns), each showing: domain name, 4 summary metrics (clicks, impressions, CTR, position), mini sparkline chart. Filter bar with search, sort, metric toggles, date range.

- `C:\MCP\better-search-console\date-picker.jpg` — Date range and comparison settings panel. Shows: comparison period options (Disabled, Previous Period, Year Over Year, Previous Month, Custom), comparison settings checkboxes (Previous Trend Line, Match Weekdays, Show change %), search type filter (Web, Discover, News, Image, Video), date range presets (7 days through 16 months, plus Custom).

- `C:\MCP\better-search-console\houtini-logo.jpg` — Our Houtini brand logo. White italic "Houtini" text on dark background with a pink-to-cyan gradient accent bar. This should be embedded as a small branding element in the dashboard UI — e.g. bottom-left corner or header area, roughly 80-100px wide.

## Step 3: Write the enhancement spec

Create `C:\MCP\better-search-console\ENHANCEMENT_SPEC.md` with the following sections:

### Section 1: Current State Audit
Compare each screenshot against our current dashboard implementation. For each feature visible
in the screenshots, mark it as:
- DONE — we have it and it works
- PARTIAL — we have something similar but it's missing details
- MISSING — not implemented yet

### Section 2: New Tool — `get_overview` (Multi-Site Summary)
Design a new tool that produces the multi-site overview grid shown in `overview-domain-summary.jpg`.
Spec should include:
- Tool name, inputs, outputs
- How it queries across multiple property databases
- The data structure returned (per-property: siteUrl, clicks, impressions, ctr, position, % changes, daily sparkline data)
- UI resource registration pattern

### Section 3: Dashboard Enhancements (Priority Order)
For each missing or partial feature, write a concrete implementation task:

**High priority:**
- Houtini logo embedded in dashboard (base64 inline in the HTML bundle)
- Expanded modal view for tables (currently tables just show top rows)
- All 4 metrics in hero bar + chart (CTR and position alongside clicks/impressions)
- Growing/Declining tab improvements (do they work correctly? compare to reference)

**Medium priority:**
- Country breakdown with flag emoji/icons
- Branded vs non-branded section (needs brandTerms configuration)
- Date range comparison settings (Previous Period, YoY, Previous Month)
- Match Weekdays comparison option
- Search type filter (Web, Discover, News, Image, Video)

**Low priority:**
- Query Counting by ranking bucket visualisation
- New Rankings / Lost Rankings section
- Sparkline mini-charts on overview cards
- Previous trend line overlay (dashed line on chart)

### Section 4: Date Picker Enhancements
Based on `date-picker.jpg`, specify the full date range and comparison options our picker should support:
- Preset ranges: 7d, 14d, 28d, Last Week, This Month, Last Month, This Quarter, Last Quarter, YTD, 3m, 6m, 8m, 12m, 16m, Custom
- Comparison modes: Disabled, Previous Period, Year Over Year, Previous Month, Custom
- Comparison settings: Previous Trend Line toggle, Match Weekdays toggle, Show change % toggle
- Search type: Web, Discover, News, Image, Video

### Section 5: Branding
- Convert `houtini-logo.jpg` to a small optimised PNG or SVG
- Embed as base64 data URI in the dashboard HTML
- Position: subtle placement, bottom-left corner or top-left header
- Size: approximately 80px wide, opacity 0.7 so it doesn't dominate
- Link to https://houtini.com on click

### Section 6: Data Pipeline Enhancements
- Batch sync: tool to sync ALL properties in one call (iterate through list_properties, sync each)
- Incremental sync: only fetch dates newer than last_synced_at
- Search type dimension: add to sync dimensions so we can filter by Web/Discover/News/Image/Video
- Sync scheduling notes: remind user to re-sync periodically (data is not live)

### Section 7: Execution Order
Number every task. Group into sprints/phases. Estimate complexity (S/M/L).
Phase 4a = quick wins (logo, modal, hero metrics fixes)
Phase 4b = multi-site overview tool
Phase 4c = advanced date picker and comparison
Phase 4d = below-the-fold sections (countries, branded, new rankings)

## Rules

- Write the enhancement spec to be actionable by Claude Code in a future session
- Include file paths for every file that needs changing
- Reference the existing SPEC.md user stories where relevant (e.g. "implements Story 6: branded split")
- Use British English
- Be specific about CSS values, component structure, data shapes — not vague
