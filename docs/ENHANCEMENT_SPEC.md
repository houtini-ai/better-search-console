# Better Search Console — Enhancement Specification

**Version:** 1.0  
**Date:** 11 February 2026  
**Status:** Ready for Implementation  
**Scope:** Phase 4 enhancements to the Better Search Console MCP dashboard  
**Reference:** SPEC.md (original execution plan), UI_REFERENCE.md (design patterns)

---

## Section 1: Current State Audit

Feature-by-feature comparison of the reference screenshots (SEOGets commercial dashboard) against our current implementation.

### Hero Metrics Bar

| Feature | Status | Notes |
|---|---|---|
| Total Clicks with large number | **DONE** | Displays formatted number with cyan colour |
| Total Impressions with large number | **DONE** | Displays formatted number with purple colour |
| Avg CTR | **DONE** | Displays percentage with orange colour |
| Avg Position | **DONE** | Displays decimal with orange colour |
| % change vs prior period on each metric | **DONE** | Green/red colour coding for positive/negative |
| Metric toggle icons (show/hide individual metrics) | **MISSING** | Reference has 4 icon buttons in header to toggle clicks/impressions/CTR/position visibility on chart |
| Inline metric icons matching chart colours | **MISSING** | Reference shows small coloured icons (snowflake for clicks, eye for impressions, scissors for CTR, house for position) next to each hero number |

### Time Series Chart

| Feature | Status | Notes |
|---|---|---|
| Clicks line (cyan, left Y-axis) | **DONE** | Chart.js line chart with dual axes |
| Impressions line (purple, right Y-axis) | **DONE** | Separate Y-axis with purple ticks |
| CTR line (orange) | **MISSING** | Reference dashboard-4.jpg shows CTR as additional line when toggled on |
| Position line (orange, different shade) | **MISSING** | Reference dashboard-4.jpg shows position as additional line (dashed, inverted axis) |
| Comparison period dashed overlay | **MISSING** | Reference shows dashed lines for the prior period comparison on each active metric |
| Date labels on X-axis | **DONE** | Shows day + month abbreviation |
| Filled area under lines | **DONE** | Subtle fill with low opacity |

### Queries Table

| Feature | Status | Notes |
|---|---|---|
| Query names listed | **DONE** | Left column with text overflow ellipsis |
| Clicks column with values | **DONE** | Right-aligned numeric formatting |
| Impressions column with values | **DONE** | Right-aligned numeric formatting |
| % change column | **DONE** | Green/red colour-coded percentage |
| All / Growing / Declining tabs | **DONE** | Tab pills with active state styling |
| CTR column | **MISSING** | Only visible in reference when all 4 metrics are toggled on (dashboard-4.jpg) |
| Position column | **MISSING** | Only visible in reference when all 4 metrics are toggled on |
| EXPAND button | **DONE** | Present in UI, opens modal |
| Refresh icon | **MISSING** | Reference shows small refresh icon next to EXPAND |
| Ranking indicator icons beside queries | **MISSING** | Reference shows small numbered circles (ranking position indicators) beside each query |
| Horizontal bar chart behind query names | **MISSING** | Reference expanded view shows proportional bars behind URLs |

### Pages Table

| Feature | Status | Notes |
|---|---|---|
| Page paths listed | **DONE** | URL paths extracted via `extractPath()` |
| Clicks, Impressions, % change columns | **DONE** | Same format as queries table |
| All / Growing / Declining tabs | **DONE** | Functioning tab filters |
| CTR column | **MISSING** | Only in expanded/4-metric mode |
| Position column | **MISSING** | Only in expanded/4-metric mode |
| EXPAND button | **DONE** | Opens modal overlay |
| Horizontal bar proportional to clicks | **MISSING** | Reference expanded.jpg shows cyan bars behind page URLs proportional to click count |

### Expanded Modal View

| Feature | Status | Notes |
|---|---|---|
| Full-width modal overlay | **DONE** | 90% width, max 1000px |
| Close button (X) | **DONE** | Top-right position |
| Scrollable list | **DONE** | `max-height: 80vh; overflow-y: auto` |
| All / Growing / Declining tabs in modal | **MISSING** | Reference expanded.jpg shows tabs within the modal header |
| CTR column in modal | **MISSING** | Reference expanded.jpg shows CTR for every row |
| Position column in modal | **MISSING** | Reference expanded.jpg shows Position for every row |
| Horizontal bar chart behind page URLs | **MISSING** | Reference shows proportional cyan bars behind URL text, width relative to clicks |
| Full scrollable list (all rows) | **PARTIAL** | Current implementation shows all rows from data (max 20 from server query). Reference shows many more rows |

### Below-the-Fold Sections

| Feature | Status | Notes |
|---|---|---|
| Branded vs Non-Branded Clicks section | **MISSING** | Reference dashboard-3.jpg: branded clicks count, non-branded count, % branded, trend chart. Implements SPEC Story 6 |
| Branded: Trend / Comparison toggle | **MISSING** | Reference shows tab toggle between time series and comparison view |
| Query Counting (Total / By Ranking) | **MISSING** | Reference dashboard-3.jpg: distribution of queries by ranking position bucket |
| Countries table with flag icons | **MISSING** | Reference dashboard-3.jpg: country name with flag emoji, clicks, impressions, % change. Implements SPEC Story 8 |
| Countries: All / Growing / Declining tabs | **MISSING** | Same tab pattern as queries/pages |
| Countries: EXPAND button | **MISSING** | Same expand pattern |
| New Rankings section (Queries / Pages tabs) | **MISSING** | Reference dashboard-3.jpg: newly appearing queries and pages. Implements SPEC Stories 12-13 |

### Date Picker & Comparison

| Feature | Status | Notes |
|---|---|---|
| Date range buttons (7D, 28D, 3M, 6M, 12M, 16M) | **DONE** | Functional button group with active state |
| Additional presets (14d, Last Week, This Month, etc.) | **MISSING** | Reference date-picker.jpg shows 20+ preset options |
| Comparison Period selector | **MISSING** | Reference: Disabled, Previous Period, Year Over Year, Previous Month, Custom |
| Previous Trend Line toggle | **MISSING** | Reference: checkbox in Comparison Settings |
| Match Weekdays toggle | **MISSING** | Reference: checkbox for weekday-aligned comparison |
| Show change % toggle | **MISSING** | Reference: checkbox to show/hide percentage changes |
| Search Type filter (Web, Discover, News, Image, Video) | **MISSING** | Reference: radio/select for search type filtering. Requires `searchAppearance` or `type` dimension in data |
| Day / Week / Month aggregation toggle | **MISSING** | Reference: tabs at top of date picker for time granularity |

### Multi-Site Overview

| Feature | Status | Notes |
|---|---|---|
| Grid of property cards (3 columns) | **MISSING** | Reference overview-domain-summary.jpg: completely separate view |
| Each card: domain name, 4 metrics | **MISSING** | Clicks, impressions, CTR, position per property |
| Mini sparkline chart per card | **MISSING** | 4 overlaid metric lines per card |
| Filter bar (Search, Sort, Filter) | **MISSING** | A-Z sort, search box, filter dropdown |
| Metric toggle icons on overview | **MISSING** | Same 4 toggle icons as dashboard |
| Date range on overview | **MISSING** | Shared date range selector |

### Branding

| Feature | Status | Notes |
|---|---|---|
| Houtini logo in dashboard | **MISSING** | Logo needs to be embedded as base64 data URI |

---

## Section 2: New Tool — `get_overview` (Multi-Site Summary)

### Tool Definition

**Name:** `get_overview`  
**Description:** Display a multi-site overview grid showing all synced GSC properties with summary metrics, percentage changes, and sparkline data.

### Input Schema

```typescript
{
  dateRange: z.string().optional()
    .describe('Date range: "7d", "28d", "3m", "6m", "12m", "16m". Default: "28d".'),
  sortBy: z.enum(['alpha', 'clicks', 'impressions', 'ctr', 'position']).optional()
    .describe('Sort order for property cards. Default: "alpha".'),
  search: z.string().optional()
    .describe('Filter properties by domain name substring.'),
}
```

### Output Data Shape

```typescript
interface OverviewData {
  dateRange: string;
  sortBy: string;
  properties: Array<{
    siteUrl: string;
    domain: string;            // extracted clean domain name
    lastSyncedAt: string | null;
    current: {
      clicks: number;
      impressions: number;
      ctr: number;
      avgPosition: number;
    };
    changes: {
      clicksPct: number | null;
      impressionsPct: number | null;
      ctrPct: number | null;
      avgPositionPct: number | null;
    };
    sparkline: Array<{         // daily data for mini chart
      date: string;
      clicks: number;
      impressions: number;
    }>;
  }>;
}
```

### Implementation

**File:** `src/tools/get-overview.ts`

Logic:
1. Call `listProperties()` to get all accessible GSC properties
2. For each property with a synced database file, open the DB and query:
   - Summary metrics for current period (same SQL as `get_dashboard` summary)
   - Summary metrics for prior period (for % change calculation)
   - Daily trend for sparkline (same SQL as `get_dashboard` dailyTrend, limited to current period)
3. Close each DB after querying
4. Sort results according to `sortBy` parameter
5. Filter by `search` substring if provided
6. Return structured `OverviewData`

**Registration:** Use `registerAppTool` in `src/server.ts` with a separate UI resource URI `ui://dashboard/overview.html`.

**UI Resource:** New file `src/ui/overview.html` + `src/ui/overview.ts` + `src/ui/overview-styles.css`, built with Vite into a single HTML file served via `registerAppResource`.

### UI Layout

The overview renders a responsive 3-column grid (2 columns below 1000px, 1 column below 600px):

```
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│ domain.com →        │ │ another.com →        │ │ third.co.uk →       │
│ ✱ 48.3k  ⊙ 2.2M    │ │ ✱ 1.4k   ⊙ 184.1k   │ │ ✱ 9.6k  ⊙ 1.6M    │
│ ✕ 2.2%   ⌂ 8.7     │ │ ✕ 0.8%   ⌂ 8.2      │ │ ✕ 0.6%  ⌂ 6.8     │
│ ┈┈┈╱╲┈╱╲╱╲┈┈┈╱╲┈  │ │ ┈┈╱╲╱╲┈┈┈╱╲┈┈╱╲┈   │ │ ┈╱╲┈┈╱╲┈╱╲┈┈╱╲   │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

Each card:
- Domain name with arrow link (clicking navigates to full dashboard for that property)
- 4 summary metrics in 2×2 grid with colour-coded icons
- Mini sparkline chart (Chart.js with no axes, no labels, just lines — clicks cyan, impressions purple)
- Background: `var(--bg-card)`, border: `1px solid var(--border)`, border-radius: `var(--radius)`
- Padding: `20px`, card min-height: `200px`

### Vite Build Integration

Add a second UI build step:

```json
"build:ui:overview": "cross-env INPUT=src/ui/overview.html vite build --outDir dist/overview --emptyOutDir",
"build:ui": "npm run build:ui:dashboard && npm run build:ui:overview"
```

Register the overview resource:

```typescript
registerAppResource(
  server,
  'Overview Grid',
  'ui://dashboard/overview.html',
  { mimeType: RESOURCE_MIME_TYPE, description: 'Multi-site overview grid' },
  async () => {
    const htmlPath = path.join(serverDir, 'overview', 'index.html');
    const html = await fs.readFile(htmlPath, 'utf-8');
    return { contents: [{ uri: 'ui://dashboard/overview.html', mimeType: RESOURCE_MIME_TYPE, text: html }] };
  }
);
```

---

## Section 3: Dashboard Enhancements (Priority Order)

### HIGH PRIORITY

#### 3.1 Houtini Logo Embedded in Dashboard

**Task:** Embed the Houtini brand logo as a base64 data URI in the dashboard HTML.

**Files to modify:**
- `src/ui/dashboard.html` — add logo element
- `src/ui/styles.css` — add logo positioning styles

**Implementation:**

The logo JPEG (22,620 bytes) has been converted to base64 and saved to `houtini-logo-base64.txt` (30,160 characters). The full data URI is `data:image/jpeg;base64,/9j/4AAQ...` (truncated).

Add to `dashboard.html` inside the `.header` div, before the `<h1>`:

```html
<a href="https://houtini.com" target="_blank" rel="noopener" class="logo-link">
  <img src="data:image/jpeg;base64,{FULL_BASE64_STRING}" alt="Houtini" class="logo" />
</a>
```

CSS for `styles.css`:

```css
.logo-link {
  display: inline-flex;
  align-items: center;
  margin-right: 12px;
  opacity: 0.75;
  transition: opacity 0.2s;
}
.logo-link:hover {
  opacity: 1;
}
.logo {
  width: 80px;
  height: auto;
  border-radius: 4px;
}
```

Modify the `.header` first child div to be a flex container:

```html
<div style="display:flex;align-items:center;gap:12px">
  <a href="https://houtini.com" target="_blank" rel="noopener" class="logo-link">
    <img src="data:image/jpeg;base64,..." alt="Houtini" class="logo" />
  </a>
  <div>
    <h1>Better Search Console</h1>
    <div class="site-url" id="site-url"></div>
  </div>
</div>
```

**Source file for base64:** Read `C:\MCP\better-search-console\houtini-logo-base64.txt` for the complete data URI string.

---

#### 3.2 Expanded Modal View Enhancement

**Task:** Upgrade the modal to match reference `expanded.jpg` — add CTR and Position columns, horizontal bar charts behind page/query names, and tab filtering within the modal.

**Files to modify:**
- `src/ui/dashboard.html` — restructure modal template
- `src/ui/dashboard.ts` — enhance `showModal()` function
- `src/ui/styles.css` — add modal bar chart styles
- `src/tools/get-dashboard.ts` — include CTR and position data in topQueries and topPages

**Data changes in `get-dashboard.ts`:**

The dashboard query already fetches `prior_clicks` and `prior_impressions`. We need to add CTR and position to each row. Modify both the `topQueries` and `topPages` SQL queries to include:

```sql
ROUND(CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL) / 
  NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4) as ctr,
ROUND(AVG(CASE WHEN date BETWEEN ? AND ? THEN position ELSE NULL END), 1) as avg_position,
-- Prior period CTR and position for change calculation
ROUND(CAST(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) AS REAL) / 
  NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END), 0), 4) as prior_ctr,
ROUND(AVG(CASE WHEN date BETWEEN ? AND ? THEN position ELSE NULL END), 1) as prior_avg_position
```

Also increase LIMIT from 20 to 100 to populate expanded view with more rows.

**DashboardData type update in `dashboard.ts`:**

```typescript
interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  prior_clicks: number;
  prior_impressions: number;
  prior_ctr: number;
  prior_avg_position: number;
  clicks_change_pct: number | null;
}

interface PageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  prior_clicks: number;
  prior_impressions: number;
  prior_ctr: number;
  prior_avg_position: number;
  clicks_change_pct: number | null;
}
```

**Modal HTML restructure:**

```html
<div class="modal-overlay" id="modal" style="display:none">
  <div class="modal">
    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h3 id="modal-title"></h3>
        <div class="tabs" id="modal-tabs">
          <button class="active" data-filter="all">All</button>
          <button data-filter="growing">Growing</button>
          <button data-filter="declining">Declining</button>
        </div>
      </div>
      <button class="close-btn" id="modal-close">&times;</button>
    </div>
    <table class="data-table modal-table">
      <thead id="modal-thead"></thead>
      <tbody id="modal-body"></tbody>
    </table>
  </div>
</div>
```

**Modal rendering — enhanced `showModal()`:**

The modal must now render 6 columns: Name, Clicks, Impressions, CTR, Position, and a visual bar. Each row has a horizontal bar behind the name cell proportional to clicks relative to the maximum clicks in the dataset:

```css
.modal-table td:first-child {
  position: relative;
}
.click-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(34, 211, 238, 0.15);
  border-radius: 2px;
  z-index: 0;
  pointer-events: none;
}
.modal-table td:first-child span {
  position: relative;
  z-index: 1;
}
```

Bar width calculation: `(row.clicks / maxClicks) * 100` as percentage width.

**Tab filtering in modal:** Add event listener to `#modal-tabs` that re-renders the modal body with the filtered data, storing the current modal context (rows + nameField) in module-level state.

---

#### 3.3 All 4 Metrics in Hero Bar + Chart

**Task:** Support toggling CTR and Position lines on the chart, and showing all 4 metrics in the hero bar (already done for hero bar — this is about the chart toggle).

**Files to modify:**
- `src/ui/dashboard.html` — add metric toggle buttons to header
- `src/ui/dashboard.ts` — add toggle state and chart update logic
- `src/ui/styles.css` — metric toggle button styles
- `src/tools/get-dashboard.ts` — include CTR and position in daily trend data

**Data change in `get-dashboard.ts`:**

Modify the `dailyTrend` query to include CTR and average position:

```sql
SELECT date,
  SUM(clicks) as clicks,
  SUM(impressions) as impressions,
  ROUND(CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0), 4) as ctr,
  ROUND(AVG(position), 1) as avg_position
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY date
ORDER BY date ASC
```

**Metric toggle buttons HTML:**

```html
<div class="metric-toggles" id="metric-toggles">
  <button class="toggle-btn active" data-metric="clicks" title="Clicks">
    <span class="toggle-dot" style="background:var(--cyan)"></span>
  </button>
  <button class="toggle-btn active" data-metric="impressions" title="Impressions">
    <span class="toggle-dot" style="background:var(--purple)"></span>
  </button>
  <button class="toggle-btn" data-metric="ctr" title="CTR">
    <span class="toggle-dot" style="background:var(--orange)"></span>
  </button>
  <button class="toggle-btn" data-metric="position" title="Position">
    <span class="toggle-dot" style="background:#f59e0b"></span>
  </button>
</div>
```

**CSS:**

```css
.metric-toggles {
  display: flex;
  gap: 4px;
  background: var(--bg-card);
  border-radius: var(--radius);
  padding: 3px;
}
.toggle-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  opacity: 0.4;
}
.toggle-btn.active {
  opacity: 1;
  border-color: var(--text-secondary);
}
.toggle-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
```

**Chart update logic in `dashboard.ts`:**

Maintain a state object for active metrics:

```typescript
const activeMetrics = { clicks: true, impressions: true, ctr: false, position: false };
```

When a toggle button is clicked, flip the state and call `renderChart()` which now conditionally adds datasets:

```typescript
function renderChart(trend: DailyTrendRow[]) {
  const datasets: any[] = [];
  
  if (activeMetrics.clicks) {
    datasets.push({
      label: 'Clicks', data: trend.map(r => r.clicks),
      borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.08)',
      fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: 'y',
    });
  }
  if (activeMetrics.impressions) {
    datasets.push({
      label: 'Impressions', data: trend.map(r => r.impressions),
      borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.05)',
      fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: 'y1',
    });
  }
  if (activeMetrics.ctr) {
    datasets.push({
      label: 'CTR', data: trend.map(r => (r.ctr ?? 0) * 100),
      borderColor: '#fb923c', fill: false, tension: 0.3,
      pointRadius: 0, borderWidth: 2, yAxisID: 'y2',
    });
  }
  if (activeMetrics.position) {
    datasets.push({
      label: 'Position', data: trend.map(r => r.avg_position),
      borderColor: '#f59e0b', borderDash: [5, 3], fill: false,
      tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: 'y3',
    });
  }
  // Build chart with dynamic Y axes based on active datasets...
}
```

Position Y-axis should be **reversed** (lower = better): `reverse: true`.

---

#### 3.4 Growing/Declining Tab Improvements

**Task:** Verify tabs work correctly and improve the filtering logic. Currently filtering is client-side based on `clicks_change_pct`. This is correct but limited — the server returns top 20 rows sorted by absolute clicks, so some growing/declining items may be cut off.

**Files to modify:**
- `src/tools/get-dashboard.ts` — increase row limit and optionally return separate growing/declining sorted lists

**Improvement:** Increase the query LIMIT from 20 to 100. This gives the client-side Growing/Declining tabs a much larger pool to filter from. The inline table shows top 10 by default (CSS `max-height` or row truncation), the EXPAND modal shows all.

No functional bug found — the tabs work correctly. The improvement is purely about data completeness.

---

### MEDIUM PRIORITY

#### 3.5 Country Breakdown with Flag Emoji

**Task:** Add a Countries section below the tables row, with flag emoji icons, clicks, impressions, and percentage changes. Implements SPEC Story 8.

**Files to modify:**
- `src/ui/dashboard.html` — add countries section
- `src/ui/dashboard.ts` — render countries data and handle tab filtering
- `src/ui/styles.css` — countries section styles
- `src/tools/get-dashboard.ts` — add country breakdown to dashboard data

**Data addition in `get-dashboard.ts`:**

Add a new query to the dashboard data payload:

```sql
SELECT country,
  SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as clicks,
  SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as impressions,
  SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END) as prior_clicks,
  SUM(CASE WHEN date BETWEEN ? AND ? THEN impressions ELSE 0 END) as prior_impressions,
  ROUND(
    (SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END)
     - SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END))
    * 100.0
    / NULLIF(SUM(CASE WHEN date BETWEEN ? AND ? THEN clicks ELSE 0 END), 0),
    1
  ) as clicks_change_pct
FROM search_analytics
WHERE country IS NOT NULL
  AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)
GROUP BY country
HAVING clicks > 0
ORDER BY clicks DESC
LIMIT 50
```

**Country code to flag emoji mapping:**

Use the standard ISO 3166-1 alpha-2 to regional indicator symbol conversion:

```typescript
function countryFlag(code: string): string {
  if (!code || code.length !== 3) return '';
  // GSC returns 3-letter codes, need to map to 2-letter
  const twoLetter = iso3to2(code);
  if (!twoLetter) return '';
  return String.fromCodePoint(
    ...twoLetter.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}
```

Include a lightweight ISO 3166 3-to-2 letter mapping object inline (approximately 50 common country codes is sufficient — the rest can fall back to the 3-letter code without a flag).

**HTML structure:**

```html
<!-- Below .tables-row -->
<div class="below-fold" id="below-fold">
  <div class="tables-row">
    <div class="table-card">
      <div class="table-header">
        <h3>Countries</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="tabs" id="countries-tabs">
            <button class="active" data-filter="all">All</button>
            <button data-filter="growing">Growing</button>
            <button data-filter="declining">Declining</button>
          </div>
          <button class="expand-btn" id="expand-countries">EXPAND</button>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Country</th>
            <th class="num">Clicks</th>
            <th class="num">Impr</th>
            <th class="num">Change</th>
          </tr>
        </thead>
        <tbody id="countries-body"></tbody>
      </table>
    </div>
    <!-- Branded vs Non-Branded placeholder (Section 3.6) -->
  </div>
</div>
```

---

#### 3.6 Branded vs Non-Branded Section

**Task:** Add branded vs non-branded click breakdown with trend chart. Implements SPEC Story 6.

**Files to modify:**
- `src/ui/dashboard.html` — add branded section
- `src/ui/dashboard.ts` — render branded data with chart
- `src/ui/styles.css` — branded section styles
- `src/tools/get-dashboard.ts` — add branded split to dashboard data (requires brandTerms parameter)

**Data requirement:** The `get_dashboard` tool needs a new optional parameter `brandTerms` (string array). When provided, the server calculates:

```sql
SELECT
  CASE WHEN query LIKE '%term1%' OR query LIKE '%term2%' THEN 'branded' ELSE 'non-branded' END as segment,
  SUM(clicks) as clicks,
  SUM(impressions) as impressions
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY segment
```

Plus a daily trend version for the time series chart.

**Tool schema update in `server.ts`:**

```typescript
brandTerms: z.array(z.string()).optional()
  .describe('Brand terms for branded/non-branded split (e.g. ["mysite", "my site"]).'),
```

**UI layout:** Right column alongside Countries. Shows:
- "Branded vs Non-Branded Clicks" heading with Trend/Comparison toggle tabs
- Large numbers: branded clicks (+X%), non-branded clicks (+X%), % of branded
- Time series chart (small, in-section) showing branded vs non-branded lines over time
- Note at bottom: "The sum of branded and non-branded clicks WILL NOT equal the total due to Google anonymising some query data."

---

#### 3.7 Date Range Comparison Settings

**Task:** Enhance the date picker to support comparison period selection and additional presets.

**Files to modify:**
- `src/ui/dashboard.html` — replace simple button group with dropdown panel
- `src/ui/dashboard.ts` — comparison mode logic, recalculate prior period dates
- `src/ui/styles.css` — dropdown panel styles
- `src/tools/get-dashboard.ts` — accept comparisonMode parameter to compute alternative prior periods

**New `get_dashboard` parameters:**

```typescript
comparisonMode: z.enum(['previous_period', 'year_over_year', 'previous_month', 'disabled']).optional()
  .describe('Comparison mode. Default: "previous_period".'),
```

**Comparison period calculation logic:**

| Mode | Prior Period Calculation |
|---|---|
| `previous_period` (default) | Same duration, shifted back immediately before current start date |
| `year_over_year` | Same dates, 1 year earlier |
| `previous_month` | The calendar month before the current period start month |
| `disabled` | No prior period data returned, no % changes shown |

**UI implementation:** Replace the flat button group with a dropdown trigger button showing the current range (e.g. "3 months"). Clicking it opens a panel with two columns:

Left column:
- Comparison Period: Disabled / Previous Period / Year Over Year / Previous Month
- Comparison Settings: Previous Trend Line (checkbox), Match Weekdays (checkbox), Show change % (checkbox)

Right column:
- Date range presets grouped by category

This is a significant UI component. Implement as a fixed-position dropdown panel below the trigger button with `z-index: 50`.

---

#### 3.8 Search Type Filter

**Task:** Support filtering dashboard data by search type (Web, Discover, News, Image, Video).

**Prerequisite:** The `search_analytics` table has a `search_appearance` column but the sync currently doesn't fetch the `searchType` dimension. This requires a data pipeline change.

**Files to modify:**
- `src/core/GscClient.ts` — add `type` parameter to `fetchSearchAnalytics()` (GSC API supports `type: 'web' | 'discover' | 'googleNews' | 'image' | 'video'`)
- `src/tools/sync-data.ts` — expose `type` filter parameter
- `src/tools/get-dashboard.ts` — accept `searchType` filter parameter
- `src/ui/dashboard.ts` — add search type selector to UI

**Note:** GSC API doesn't return `type` as a dimension — it's a filter on the API request. To support multiple search types in one database, we would need separate syncs per type or a separate `search_type` column populated during sync. The simpler approach is to add a `searchType` filter to the `sync_gsc_data` and `get_dashboard` tools that gets passed through to the API queries.

---

### LOW PRIORITY

#### 3.9 Query Counting by Ranking Bucket

**Task:** Add a visualisation showing query distribution by position range (1-3, 4-10, 11-20, 21-50, 51-100, 100+).

**Files to modify:**
- `src/ui/dashboard.html` — add section
- `src/ui/dashboard.ts` — render horizontal bar chart or stacked bar
- `src/tools/get-dashboard.ts` — add ranking bucket query

**SQL:**

```sql
SELECT
  CASE
    WHEN AVG(position) <= 3 THEN '1-3'
    WHEN AVG(position) <= 10 THEN '4-10'
    WHEN AVG(position) <= 20 THEN '11-20'
    WHEN AVG(position) <= 50 THEN '21-50'
    WHEN AVG(position) <= 100 THEN '51-100'
    ELSE '100+'
  END as bucket,
  COUNT(DISTINCT query) as query_count
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY query
```

Then aggregate by bucket.

---

#### 3.10 New Rankings / Lost Rankings Section

**Task:** Display newly appearing and disappeared queries/pages. Implements SPEC Stories 12-13.

**Files to modify:**
- `src/ui/dashboard.html` — add New Rankings section with Queries/Pages tabs
- `src/ui/dashboard.ts` — render new/lost rankings data
- `src/tools/get-dashboard.ts` — add new_queries and lost_queries to dashboard payload

The `get_insights` tool already implements `new_queries` and `lost_queries` insight types. Reuse the same SQL logic within `get-dashboard.ts`.

---

#### 3.11 Sparkline Mini-Charts on Overview Cards

**Task:** Render small Chart.js line charts (no axes, no labels) within each property card on the overview grid.

**Implementation:** Use Chart.js with minimal config:

```typescript
new Chart(canvas, {
  type: 'line',
  data: { labels: dates, datasets: [
    { data: clicks, borderColor: '#22d3ee', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    { data: impressions, borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
  ]},
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
  },
});
```

Canvas size: `width: 100%; height: 80px`.

---

#### 3.12 Previous Trend Line Overlay (Dashed)

**Task:** When comparison mode is "Previous Period" and "Previous Trend Line" is enabled, render the prior period data as dashed lines overlaid on the main chart.

**Files to modify:**
- `src/tools/get-dashboard.ts` — return prior period daily trend data
- `src/ui/dashboard.ts` — add dashed datasets when enabled

**Data addition:**

```sql
-- Prior period daily trend
SELECT date, SUM(clicks) as clicks, SUM(impressions) as impressions
FROM search_analytics
WHERE date BETWEEN ? AND ?
GROUP BY date ORDER BY date ASC
```

**Chart datasets:** Add prior period lines with `borderDash: [6, 4]` and reduced opacity (`borderColor: 'rgba(34,211,238,0.4)'` for prior clicks).

---

## Section 4: Date Picker Enhancements

Based on `date-picker.jpg`, the full specification:

### Preset Ranges

| Preset | Value | Calculation |
|---|---|---|
| Today | `1d` | Current date only |
| 7 days | `7d` | Last 7 days |
| 14 days | `14d` | Last 14 days |
| 28 days | `28d` | Last 28 days |
| Last Week | `lw` | Monday-Sunday of previous week |
| This Month | `tm` | 1st of current month to today |
| Last Month | `lm` | 1st to last day of previous month |
| This Quarter | `tq` | 1st of current quarter to today |
| Last Quarter | `lq` | Full previous quarter |
| Year to Date | `ytd` | January 1st to today |
| 3 months | `3m` | Last 90 days |
| 6 months | `6m` | Last 180 days |
| 8 months | `8m` | Last 240 days |
| 12 months | `12m` | Last 365 days |
| 16 months | `16m` | Last 480 days (GSC max) |
| Custom | `custom` | User-defined start and end dates |

### Comparison Modes

| Mode | Description | Prior Period Calculation |
|---|---|---|
| Disabled | No comparison | No prior period data |
| Previous Period | Default | Same duration, immediately preceding |
| Year Over Year | YoY | Same dates, one year earlier |
| Previous Month | MoM | The calendar month before the period start |
| Custom | User-defined | User picks arbitrary prior start/end dates |

### Comparison Settings

| Setting | Default | Description |
|---|---|---|
| Previous Trend Line | ON | Show dashed overlay on chart for prior period |
| Match Weekdays | ON | Align comparison period to match weekday patterns |
| Show change % | ON | Display percentage change values throughout UI |

### Search Type Filter

| Type | GSC API Value | Description |
|---|---|---|
| Web | `web` | Standard web search results |
| Discover | `discover` | Google Discover feed |
| News | `googleNews` | Google News |
| Image | `image` | Google Image search |
| Video | `video` | Google Video search |

### Time Aggregation

| Granularity | Effect |
|---|---|
| Day | Show daily data points (default) |
| Week | Aggregate to weekly totals |
| Month | Aggregate to monthly totals |

### Implementation Notes

The date picker should be a dropdown panel component. The `helpers.ts` file contains `getPeriodDates()` which currently handles the basic presets. This function needs extending to support the full preset list and comparison modes.

**File to modify:** `src/tools/helpers.ts` — extend `getPeriodDates()` to accept comparison mode and return appropriately calculated prior period.

---

## Section 5: Branding

### Logo Conversion

- **Source:** `C:\MCP\better-search-console\houtini-logo.jpg` (22,620 bytes, 564×564 JPEG)
- **Base64 output:** `C:\MCP\better-search-console\houtini-logo-base64.txt` (30,160 characters including data URI prefix)
- **Format:** `data:image/jpeg;base64,...` embedded directly in HTML

### Placement

- **Location:** Header area, left of the "Better Search Console" title
- **Size:** `width: 80px; height: auto` (maintains aspect ratio)
- **Opacity:** `0.75` default, `1.0` on hover
- **Link:** `https://houtini.com` opening in new tab
- **Border radius:** `4px` for subtle rounding

### Also apply to Overview page

The same logo element should appear in the overview grid header. Wrap in a reusable HTML snippet or duplicate in `overview.html`.

---

## Section 6: Data Pipeline Enhancements

### 6.1 Batch Sync Tool

**Task:** New tool `sync_all_properties` that syncs all accessible GSC properties in one call.

**Tool definition:**

```typescript
server.tool(
  'sync_all_properties',
  'Sync search analytics data for ALL accessible GSC properties. Iterates through all properties and syncs each one.',
  {
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    dimensions: z.array(z.string()).optional(),
  },
  async (args) => {
    const properties = await gscClient.listProperties();
    const results = [];
    for (const prop of properties) {
      try {
        const result = await syncData(gscClient, { siteUrl: prop.siteUrl, ...args });
        results.push({ siteUrl: prop.siteUrl, status: 'success', ...result });
      } catch (error) {
        results.push({ siteUrl: prop.siteUrl, status: 'error', error: (error as Error).message });
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }
);
```

**File to modify:** `src/server.ts`

### 6.2 Incremental Sync

**Task:** When syncing, check `property_meta.last_synced_at` and only fetch dates newer than the last sync.

**Files to modify:**
- `src/tools/sync-data.ts` — check last sync date, adjust `startDate` if no explicit start provided
- `src/core/Database.ts` — add method `getLastSyncDate(): string | null`

**Logic:**

```typescript
if (!args.startDate) {
  const lastSync = db.getLastSyncDate();
  if (lastSync) {
    // Start from day after last sync, not 16 months ago
    args.startDate = addDays(lastSync, 1);
  }
}
```

This dramatically reduces sync time for subsequent syncs.

### 6.3 Search Type Dimension

As noted in Section 3.8, supporting search type filtering requires either:

**Option A (simpler):** Add `searchType` as a filter parameter on sync and query tools, passed through to the GSC API `type` field. Each sync only captures one search type. Default: `web`.

**Option B (comprehensive):** Run multiple syncs per type and tag rows with a `search_type` column. Requires schema migration adding `search_type TEXT DEFAULT 'web'` to `search_analytics` and updating the unique index.

Recommend **Option A** for now, with Option B as a future enhancement.

### 6.4 Sync Freshness Indicator

Add a note in the dashboard UI showing when data was last synced:

```html
<div class="sync-info" id="sync-info">
  Last synced: <span id="last-sync-date"></span>
  <button class="sync-btn" id="sync-btn" title="Data is not live. Re-sync to update.">Sync</button>
</div>
```

The sync button calls `sync_gsc_data` via `app.callServerTool()` for the current property.

---

## Section 7: Execution Order

### Phase 4a — Quick Wins (Complexity: S-M)

| # | Task | Complexity | Files |
|---|---|---|---|
| 1 | Embed Houtini logo (Section 3.1) | S | `dashboard.html`, `styles.css` |
| 2 | Increase dashboard query LIMIT from 20 to 100 | S | `get-dashboard.ts` |
| 3 | Add CTR + Position to dashboard query results | S | `get-dashboard.ts` |
| 4 | Enhanced modal with CTR, Position, bar charts, tabs (Section 3.2) | M | `dashboard.html`, `dashboard.ts`, `styles.css` |
| 5 | Metric toggle buttons + chart datasets for CTR/Position (Section 3.3) | M | `dashboard.html`, `dashboard.ts`, `styles.css`, `get-dashboard.ts` |
| 6 | Add last-synced timestamp to dashboard UI (Section 6.4) | S | `dashboard.html`, `dashboard.ts`, `get-dashboard.ts` |

**Estimated effort:** 1 session  
**Build + restart required after all changes.**

### Phase 4b — Multi-Site Overview (Complexity: L)

| # | Task | Complexity | Files |
|---|---|---|---|
| 7 | Create `get-overview.ts` tool with multi-property queries (Section 2) | M | `src/tools/get-overview.ts` |
| 8 | Create overview UI (`overview.html`, `overview.ts`, `overview-styles.css`) | L | `src/ui/overview.*` |
| 9 | Register overview tool + resource in server.ts | S | `src/server.ts` |
| 10 | Add Vite build config for overview | S | `vite.config.ts`, `package.json` |
| 11 | Sparkline mini-charts on overview cards (Section 3.11) | M | `overview.ts` |

**Estimated effort:** 1-2 sessions  
**Build + restart required.**

### Phase 4c — Advanced Date Picker & Comparison (Complexity: L)

| # | Task | Complexity | Files |
|---|---|---|---|
| 12 | Extend `getPeriodDates()` with all presets (Section 4) | M | `src/tools/helpers.ts` |
| 13 | Add comparisonMode parameter to `get_dashboard` | S | `get-dashboard.ts`, `server.ts` |
| 14 | Build dropdown date picker UI component | L | `dashboard.html`, `dashboard.ts`, `styles.css` |
| 15 | Prior period trend line overlay — dashed lines (Section 3.12) | M | `get-dashboard.ts`, `dashboard.ts` |
| 16 | Match Weekdays comparison logic | M | `helpers.ts` |
| 17 | Show change % toggle (client-side hide/show) | S | `dashboard.ts` |

**Estimated effort:** 1-2 sessions  
**Build + restart required.**

### Phase 4d — Below-the-Fold Sections (Complexity: M-L)

| # | Task | Complexity | Files |
|---|---|---|---|
| 18 | Countries section with flag emoji (Section 3.5) | M | `dashboard.html`, `dashboard.ts`, `styles.css`, `get-dashboard.ts` |
| 19 | Branded vs Non-Branded section (Section 3.6) | M | `dashboard.html`, `dashboard.ts`, `styles.css`, `get-dashboard.ts`, `server.ts` |
| 20 | New Rankings / Lost Rankings section (Section 3.10) | M | `dashboard.html`, `dashboard.ts`, `get-dashboard.ts` |
| 21 | Query Counting by ranking bucket (Section 3.9) | S | `dashboard.html`, `dashboard.ts`, `get-dashboard.ts` |
| 22 | Batch sync tool (Section 6.1) | S | `server.ts` |
| 23 | Incremental sync (Section 6.2) | M | `sync-data.ts`, `Database.ts` |

**Estimated effort:** 2 sessions  
**Build + restart required after each section.**

### Phase 4e — Search Type Support (Complexity: M)

| # | Task | Complexity | Files |
|---|---|---|---|
| 24 | Add searchType parameter to GscClient (Section 3.8) | S | `GscClient.ts` |
| 25 | Expose searchType on sync and dashboard tools | S | `sync-data.ts`, `get-dashboard.ts`, `server.ts` |
| 26 | Search type selector in dashboard UI | M | `dashboard.html`, `dashboard.ts`, `styles.css` |

**Estimated effort:** 1 session  
**Build + restart required.**

---

## Summary

This spec covers 26 discrete tasks across 5 phases, taking the Better Search Console dashboard from a functional MVP to a feature-complete GSC analysis tool that matches and exceeds the reference commercial implementation. Each task is actionable with specific file paths, data shapes, SQL queries, and CSS values.

The priority ordering ensures maximum user value early (Phase 4a delivers the most visible improvements in a single session) whilst deferring complex but less critical features to later phases.

**Total estimated sessions:** 6-8 Claude Code sessions for full implementation.
