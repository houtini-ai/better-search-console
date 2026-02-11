# UI Reference - Design Patterns Extracted from Screenshots

## Analysis Method
Screenshots analysed directly (5 images). HTML/CSS files preserved in /temp for
future reference but NOT loaded into context (115KB HTML + 105KB CSS, both minified).

If we need specific CSS values later, we can extract targeted snippets.

---

## Design System Observations

### Colour Palette (Dark Theme)
- **Background**: Very dark blue/charcoal (#1a1d23 range)
- **Card/Section bg**: Slightly lighter dark (#22252b range)
- **Primary metric (Clicks)**: Cyan/teal
- **Secondary metric (Impressions)**: Purple/violet
- **CTR**: Orange/amber
- **Position**: Orange (different shade)
- **Positive change**: Green text (+83%, +13%)
- **Negative change**: Red text (-4%, -3%)
- **Text primary**: White
- **Text secondary**: Grey
- **Accent/link**: Cyan

### Layout Patterns

#### Overview Page (Multi-Site)
- Grid of property cards (3 columns)
- Each card: domain name, 4 metrics (clicks, impressions, CTR, position)
- Mini sparkline chart per card showing all 4 metrics
- Filter bar: Search, Sort (A-Z), Filter, metric toggles, date range picker
- Percentage changes shown inline with coloured text

#### Single Property Dashboard
- **Header**: Property name, nav tabs (Dashboard, Indexing, Annotations, Optimise, Settings)
- **Controls**: Filter button, metric toggle icons, date range dropdown (3 months)
- **Hero metrics**: Large numbers with % change (201.7k clicks +3%, 8M impressions +40%)
- **Main chart**: Multi-line time series, dual Y-axes (clicks left, impressions right)
  - Solid + dashed lines for current vs comparison period
  - Colour-coded per metric
- **Two-column tables below chart**:
  - LEFT: Queries table with tabs (All | Growing | Decaying)
  - RIGHT: Pages table with tabs (All | Growing | Decaying)
  - Both show: Clicks, Impressions, with % change
  - Expandable via "EXPAND" button (opens modal with full list)

#### Expanded View (Modal)
- Full-width modal overlay
- Same table structure but with additional columns: CTR, Position
- Horizontal bar chart behind page URLs (proportional to clicks)
- Scrollable list with all pages
- Close button (X) top right

#### Below-the-fold Sections
- **Branded vs Non-Branded Clicks**: Toggle between Trend/Comparison view
  - Shows branded clicks, non-branded clicks, % of branded
  - Time series chart
- **Query Counting**: Total vs By Ranking tabs
  - Appears to show query distribution by position range
- **Countries**: Table with flag icons, clicks, impressions, % change
  - Tabs: All | Growing | Decaying
  - EXPAND button
- **New Rankings**: Queries | Pages tabs
  - Shows newly appearing terms/pages

### Interaction Patterns
- **Metric toggles**: Icon buttons in header to show/hide clicks, impressions, CTR, position
- **Date range**: Dropdown (3 months shown, likely 7d, 28d, 3m, 6m, 12m, 16m)
- **Tab filtering**: All | Growing | Decaying on every table
- **Expand**: Tables can be expanded to modal view with more columns
- **Refresh**: Small refresh icon on tables

### Key UX Features Worth Replicating
1. Growing/Decaying tabs - period comparison built into every table
2. Percentage change with colour coding on every metric
3. Dual-axis chart with comparison period overlay
4. Expandable tables (compact default, full detail on demand)
5. Country flags for visual scanning
6. Branded vs non-branded segmentation
7. Multi-property overview grid

---

## Priority Features for Better Search Console MCP App

### Phase 3 (MVP UI) - Must Have
- [ ] Hero metrics bar (clicks, impressions, CTR, position with % change)
- [ ] Time series chart (clicks + impressions, dual axis)
- [ ] Top queries table (sortable, with % change)
- [ ] Top pages table (sortable, with % change)
- [ ] Date range selector
- [ ] Dark theme (matches Claude Desktop aesthetic)

### Phase 3b - Nice to Have
- [ ] Growing/Decaying filter tabs
- [ ] Country breakdown table
- [ ] Expandable table modals
- [ ] Metric toggle buttons
- [ ] Comparison period overlay on chart

### Phase 4 - Advanced
- [ ] Multi-property overview grid
- [ ] Branded vs non-branded segmentation
- [ ] New rankings detection
- [ ] Click-to-drill-down (click query to see its pages)
