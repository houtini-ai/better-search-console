import { App } from '@modelcontextprotocol/ext-apps';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// --- Types ---
type ComparisonMode = 'previous_period' | 'year_over_year' | 'previous_month' | 'disabled';

interface TrendRow { date: string; clicks: number; impressions: number; ctr: number | null; avg_position: number | null }

interface DashboardData {
  siteUrl: string;
  dateRange: string;
  comparisonMode?: ComparisonMode;
  matchWeekdays?: boolean;
  lastSyncedAt: string | null;
  period: { current: { startDate: string; endDate: string }; prior: { startDate: string; endDate: string } };
  summary: {
    current: { clicks: number; impressions: number; ctr: number; avgPosition: number };
    prior: { clicks: number; impressions: number; ctr: number; avgPosition: number };
    changes: { clicksPct: number | null; impressionsPct: number | null; ctrPct: number | null; avgPositionPct: number | null };
  };
  dailyTrend: TrendRow[];
  priorDailyTrend?: TrendRow[];
  topQueries: Array<RowData & { query: string }>;
  topPages: Array<RowData & { page: string }>;
  countries?: Array<{ country: string; clicks: number; impressions: number; prior_clicks: number; prior_impressions: number; clicks_change_pct: number | null }>;
  rankingBuckets?: Array<{ bucket: string; count: number }>;
  newQueries?: Array<{ query: string; clicks: number; impressions: number; avg_position: number | null }>;
  lostQueries?: Array<{ query: string; clicks: number; impressions: number; avg_position: number | null }>;
  brandedSplit?: {
    summary: Array<{ segment: string; clicks: number; impressions: number }>;
    priorSummary: Array<{ segment: string; clicks: number; impressions: number }>;
    trend: Array<{ date: string; segment: string; clicks: number }>;
  } | null;
}

interface RowData {
  clicks: number;
  impressions: number;
  ctr: number | null;
  avg_position: number | null;
  prior_clicks: number;
  prior_impressions: number;
  prior_ctr: number | null;
  prior_avg_position: number | null;
  clicks_change_pct: number | null;
}

// --- State ---
let currentData: DashboardData | null = null;
let currentSiteUrl = '';
let currentDateRange = '3m';
let currentComparisonMode: ComparisonMode = 'previous_period';
let currentMatchWeekdays = false;
let currentSearchType: string = 'web';
let showPriorTrend = true;
let showChangePct = true;
let trendChart: Chart | null = null;
const activeMetrics = { clicks: true, impressions: true, ctr: false, position: false };

// Modal state
let modalRows: any[] = [];
let modalNameField = '';
let modalFilter = 'all';

// --- App Setup ---
const app = new App({ name: 'Better Search Console', version: '1.0.0' });

app.ontoolresult = (result) => {
  const data = result.structuredContent as DashboardData | undefined;
  if (data && data.summary) {
    currentData = data;
    currentSiteUrl = data.siteUrl;
    currentDateRange = data.dateRange;
    renderDashboard(data);
  }
};

// Establish communication with the host
app.connect();

// --- Rendering ---
function renderDashboard(data: DashboardData) {
  document.getElementById('loading')!.style.display = 'none';
  document.getElementById('content')!.style.display = 'block';

  // Header
  document.getElementById('site-url')!.textContent = data.siteUrl;
  setActiveDateRange(data.dateRange);

  // Sync info
  if (data.lastSyncedAt) {
    const syncEl = document.getElementById('sync-info')!;
    syncEl.style.display = 'block';
    document.getElementById('last-sync-date')!.textContent = formatDate(data.lastSyncedAt);
  }

  // Hero metrics
  renderMetrics(data);

  // Chart
  renderChart(data.dailyTrend, data.priorDailyTrend);

  // Tables (inline shows max 10 rows)
  renderTable('queries-body', data.topQueries.slice(0, 10), 'query');
  renderTable('pages-body', data.topPages.slice(0, 10), 'page');

  // Below-the-fold sections
  renderCountries(data);
  renderRankingBuckets(data);
  renderNewLost(data);
  renderBranded(data);
}

function renderMetrics(data: DashboardData) {
  const { current, changes } = data.summary;

  setMetric('metric-clicks', formatNumber(current.clicks));
  setMetric('metric-impressions', formatNumber(current.impressions));
  setMetric('metric-ctr', (current.ctr != null ? (current.ctr * 100).toFixed(1) : '0') + '%');
  setMetric('metric-position', current.avgPosition != null ? current.avgPosition.toFixed(1) : '—');

  setChange('change-clicks', changes.clicksPct);
  setChange('change-impressions', changes.impressionsPct);
  setChange('change-ctr', changes.ctrPct);
  // Position: lower is better, so invert the sentiment
  setChange('change-position', changes.avgPositionPct, true);
}

function renderChart(trend: TrendRow[], priorTrend?: TrendRow[]) {
  const canvas = document.getElementById('trend-chart') as HTMLCanvasElement;

  if (trendChart) {
    trendChart.destroy();
  }

  const labels = trend.map(r => {
    const d = new Date(r.date);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  });

  const datasets: any[] = [];
  const scales: any = {
    x: {
      grid: { color: 'rgba(45,49,57,0.5)' },
      ticks: { color: '#6b7280', font: { size: 11 }, maxTicksLimit: 12 },
    },
  };

  if (activeMetrics.clicks) {
    datasets.push({
      label: 'Clicks',
      data: trend.map(r => r.clicks),
      borderColor: '#22d3ee',
      backgroundColor: 'rgba(34,211,238,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 8,
      borderWidth: 2,
      yAxisID: 'y',
    });
    scales.y = {
      position: 'left',
      grid: { color: 'rgba(45,49,57,0.5)' },
      ticks: { color: '#22d3ee', font: { size: 11 }, callback: (v: number) => formatCompact(v) },
    };
  }

  if (activeMetrics.impressions) {
    datasets.push({
      label: 'Impressions',
      data: trend.map(r => r.impressions),
      borderColor: '#a78bfa',
      backgroundColor: 'rgba(167,139,250,0.05)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 8,
      borderWidth: 2,
      yAxisID: 'y1',
    });
    scales.y1 = {
      position: 'right',
      grid: { drawOnChartArea: false },
      ticks: { color: '#a78bfa', font: { size: 11 }, callback: (v: number) => formatCompact(v) },
    };
  }

  if (activeMetrics.ctr) {
    datasets.push({
      label: 'CTR',
      data: trend.map(r => ((r.ctr ?? 0) * 100)),
      borderColor: '#fb923c',
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 8,
      borderWidth: 2,
      yAxisID: 'y2',
    });
    scales.y2 = {
      position: activeMetrics.clicks ? undefined : 'left',
      display: true,
      grid: { drawOnChartArea: false },
      ticks: {
        color: '#fb923c',
        font: { size: 11 },
        callback: (v: number) => v.toFixed(1) + '%',
      },
    };
  }

  if (activeMetrics.position) {
    datasets.push({
      label: 'Position',
      data: trend.map(r => r.avg_position),
      borderColor: '#f59e0b',
      borderDash: [5, 3],
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 8,
      borderWidth: 2,
      yAxisID: 'y3',
    });
    scales.y3 = {
      position: activeMetrics.impressions ? undefined : 'right',
      display: true,
      reverse: true,
      grid: { drawOnChartArea: false },
      ticks: { color: '#f59e0b', font: { size: 11 } },
    };
  }

  // Prior period dashed overlay
  if (showPriorTrend && priorTrend && priorTrend.length > 0 && currentComparisonMode !== 'disabled') {
    if (activeMetrics.clicks) {
      datasets.push({
        label: 'Prior Clicks',
        data: priorTrend.map(r => r.clicks),
        borderColor: 'rgba(34,211,238,0.35)',
        borderDash: [6, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 8,
        borderWidth: 1.5,
        yAxisID: 'y',
      });
    }
    if (activeMetrics.impressions) {
      datasets.push({
        label: 'Prior Impressions',
        data: priorTrend.map(r => r.impressions),
        borderColor: 'rgba(167,139,250,0.35)',
        borderDash: [6, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 8,
        borderWidth: 1.5,
        yAxisID: 'y1',
      });
    }
    if (activeMetrics.ctr) {
      datasets.push({
        label: 'Prior CTR',
        data: priorTrend.map(r => ((r.ctr ?? 0) * 100)),
        borderColor: 'rgba(251,146,60,0.35)',
        borderDash: [6, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 8,
        borderWidth: 1.5,
        yAxisID: 'y2',
      });
    }
    if (activeMetrics.position) {
      datasets.push({
        label: 'Prior Position',
        data: priorTrend.map(r => r.avg_position),
        borderColor: 'rgba(245,158,11,0.35)',
        borderDash: [6, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 8,
        borderWidth: 1.5,
        yAxisID: 'y3',
      });
    }
  }

  if (datasets.length === 0) {
    // Nothing to render
    return;
  }

  trendChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: '#9aa0a6', boxWidth: 12, padding: 16, font: { size: 12 } },
        },
        tooltip: {
          backgroundColor: '#1c1f26',
          borderColor: '#2d3139',
          borderWidth: 1,
          titleColor: '#e8eaed',
          bodyColor: '#9aa0a6',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || '';
              const val = ctx.raw as number;
              if (label === 'CTR') return `CTR: ${val.toFixed(2)}%`;
              if (label === 'Position') return `Position: ${val.toFixed(1)}`;
              return `${label}: ${formatNumber(val)}`;
            },
          },
        },
      },
      scales,
    },
  });
}

function renderTable(tbodyId: string, rows: any[], nameField: string, filter = 'all') {
  const tbody = document.getElementById(tbodyId)!;
  let filtered = rows;

  if (filter === 'growing') {
    filtered = rows.filter(r => (r.clicks_change_pct ?? 0) > 0);
  } else if (filter === 'declining') {
    filtered = rows.filter(r => (r.clicks_change_pct ?? 0) < 0);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No data</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const name = row[nameField];
    const displayName = nameField === 'page' ? extractPath(name) : name;
    const changePct = row.clicks_change_pct;
    const changeClass = changePct == null ? 'neutral' : changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'neutral';
    const changeText = changePct == null ? '—' : (changePct > 0 ? '+' : '') + changePct + '%';

    return `<tr>
      <td title="${escapeHtml(name)}">${escapeHtml(displayName)}</td>
      <td class="num">${formatNumber(row.clicks)}</td>
      <td class="num">${formatNumber(row.impressions)}</td>
      <td class="num"><span class="change ${changeClass}">${changeText}</span></td>
    </tr>`;
  }).join('');
}

// --- Date Picker Dropdown ---
const dpTrigger = document.getElementById('date-picker-trigger')!;
const dpPanel = document.getElementById('date-picker-panel')!;

dpTrigger.addEventListener('click', () => {
  dpPanel.style.display = dpPanel.style.display === 'none' ? 'block' : 'none';
});

// Close on outside click
document.addEventListener('click', (e) => {
  if (!document.getElementById('date-picker-wrapper')!.contains(e.target as Node)) {
    dpPanel.style.display = 'none';
  }
});

// Preset buttons
dpPanel.querySelectorAll('.dp-presets button').forEach(btn => {
  btn.addEventListener('click', async () => {
    const range = (btn as HTMLElement).dataset.range!;
    const label = (btn as HTMLElement).dataset.label!;
    if (range === currentDateRange && !currentSiteUrl) return;

    currentDateRange = range;
    document.getElementById('date-picker-label')!.textContent = label;

    // Update active state
    dpPanel.querySelectorAll('.dp-presets button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    dpPanel.style.display = 'none';
    await fetchDashboard();
  });
});

// Comparison mode radios
dpPanel.querySelectorAll('#dp-comparison input[type="radio"]').forEach(radio => {
  radio.addEventListener('change', async () => {
    currentComparisonMode = (radio as HTMLInputElement).value as ComparisonMode;
    await fetchDashboard();
  });
});

// Match weekdays checkbox
document.getElementById('dp-match-weekdays')!.addEventListener('change', async (e) => {
  currentMatchWeekdays = (e.target as HTMLInputElement).checked;
  await fetchDashboard();
});

// Prior trend line checkbox (client-side only)
document.getElementById('dp-prior-trend')!.addEventListener('change', (e) => {
  showPriorTrend = (e.target as HTMLInputElement).checked;
  if (currentData) renderChart(currentData.dailyTrend, currentData.priorDailyTrend);
});

// Show change % checkbox (client-side only)
document.getElementById('dp-show-change')!.addEventListener('change', (e) => {
  showChangePct = (e.target as HTMLInputElement).checked;
  document.querySelectorAll('.change').forEach(el => {
    (el as HTMLElement).style.visibility = showChangePct ? 'visible' : 'hidden';
  });
  document.querySelectorAll('.metric-change').forEach(el => {
    (el as HTMLElement).style.visibility = showChangePct ? 'visible' : 'hidden';
  });
});

// Search type selector — triggers re-sync with selected type then refreshes dashboard
document.getElementById('search-type-selector')!.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('.st-btn') as HTMLElement | null;
  if (!btn) return;
  const type = btn.dataset.type;
  if (!type || type === currentSearchType) return;
  currentSearchType = type;
  document.querySelectorAll('#search-type-selector .st-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Re-sync with selected search type then refresh
  document.getElementById('loading')!.style.display = 'flex';
  document.getElementById('content')!.style.display = 'none';
  try {
    const syncArgs: Record<string, unknown> = { siteUrl: currentSiteUrl };
    if (type !== 'web') syncArgs.searchType = type;
    await app.callServerTool({ name: 'sync_gsc_data', arguments: syncArgs });
  } catch { /* sync errors are non-fatal; dashboard will show whatever data exists */ }
  await fetchDashboard();
});

async function fetchDashboard() {
  if (!currentSiteUrl) return;

  document.getElementById('loading')!.style.display = 'flex';
  document.getElementById('content')!.style.display = 'none';

  try {
    const result = await app.callServerTool({
      name: 'get_dashboard',
      arguments: {
        siteUrl: currentSiteUrl,
        dateRange: currentDateRange,
        comparisonMode: currentComparisonMode,
        matchWeekdays: currentMatchWeekdays,
      },
    });
    const data = result.structuredContent as DashboardData;
    if (data && data.summary) {
      currentData = data;
      renderDashboard(data);
    }
  } catch (err) {
    console.error('Failed to fetch data:', err);
    document.getElementById('loading')!.textContent = 'Error loading data';
    document.getElementById('loading')!.style.display = 'flex';
  }
}

function setActiveDateRange(range: string) {
  const panel = document.getElementById('date-picker-panel')!;
  panel.querySelectorAll('.dp-presets button').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.range === range);
    if ((btn as HTMLElement).dataset.range === range) {
      document.getElementById('date-picker-label')!.textContent = (btn as HTMLElement).dataset.label || range;
    }
  });
}

// --- Metric Toggle Buttons ---
document.getElementById('metric-toggles')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.toggle-btn') as HTMLButtonElement | null;
  if (!btn || !currentData) return;

  const metric = btn.getAttribute('data-metric') as keyof typeof activeMetrics;
  if (!metric) return;

  activeMetrics[metric] = !activeMetrics[metric];
  btn.classList.toggle('active', activeMetrics[metric]);

  renderChart(currentData.dailyTrend, currentData.priorDailyTrend);
});

// --- Tab Filtering ---
function setupTabs(tabsId: string, tbodyId: string, nameField: string) {
  document.getElementById(tabsId)!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn || !currentData) return;

    const filter = btn.getAttribute('data-filter')!;
    document.querySelectorAll(`#${tabsId} button`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const rows = nameField === 'query' ? currentData.topQueries.slice(0, 10) : currentData.topPages.slice(0, 10);
    renderTable(tbodyId, rows, nameField, filter);
  });
}
setupTabs('queries-tabs', 'queries-body', 'query');
setupTabs('pages-tabs', 'pages-body', 'page');

// --- Expand Modal ---
function showModal(title: string, rows: any[], nameField: string) {
  modalRows = rows;
  modalNameField = nameField;
  modalFilter = 'all';

  const modal = document.getElementById('modal')!;
  document.getElementById('modal-title')!.textContent = title;

  // Reset tab state
  document.querySelectorAll('#modal-tabs button').forEach(b => b.classList.remove('active'));
  document.querySelector('#modal-tabs button[data-filter="all"]')!.classList.add('active');

  renderModalContent();
  modal.style.display = 'flex';
}

function renderModalContent() {
  const theadEl = document.getElementById('modal-thead')!;
  const tbodyEl = document.getElementById('modal-body')!;

  const nameLabel = modalNameField === 'query' ? 'Query' : 'Page';
  theadEl.innerHTML = `<tr>
    <th>${nameLabel}</th><th class="num">Clicks</th><th class="num">Impr</th>
    <th class="num">CTR</th><th class="num">Position</th><th class="num">Change</th>
  </tr>`;

  let filtered = modalRows;
  if (modalFilter === 'growing') {
    filtered = modalRows.filter(r => (r.clicks_change_pct ?? 0) > 0);
  } else if (modalFilter === 'declining') {
    filtered = modalRows.filter(r => (r.clicks_change_pct ?? 0) < 0);
  }

  if (filtered.length === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">No data</td></tr>`;
    return;
  }

  const maxClicks = Math.max(...filtered.map(r => r.clicks), 1);

  tbodyEl.innerHTML = filtered.map(row => {
    const name = row[modalNameField];
    const displayName = modalNameField === 'page' ? extractPath(name) : name;
    const changePct = row.clicks_change_pct;
    const changeClass = changePct == null ? 'neutral' : changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'neutral';
    const changeText = changePct == null ? '—' : (changePct > 0 ? '+' : '') + changePct + '%';
    const barWidth = ((row.clicks / maxClicks) * 100).toFixed(1);
    const ctrDisplay = row.ctr != null ? (row.ctr * 100).toFixed(1) + '%' : '—';
    const posDisplay = row.avg_position != null ? row.avg_position.toFixed(1) : '—';

    return `<tr>
      <td title="${escapeHtml(name)}"><div class="click-bar" style="width:${barWidth}%"></div><span>${escapeHtml(displayName)}</span></td>
      <td class="num">${formatNumber(row.clicks)}</td>
      <td class="num">${formatNumber(row.impressions)}</td>
      <td class="num">${ctrDisplay}</td>
      <td class="num">${posDisplay}</td>
      <td class="num"><span class="change ${changeClass}">${changeText}</span></td>
    </tr>`;
  }).join('');
}

// Modal tab filtering
document.getElementById('modal-tabs')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;

  const filter = btn.getAttribute('data-filter')!;
  modalFilter = filter;
  document.querySelectorAll('#modal-tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  renderModalContent();
});

document.getElementById('expand-queries')!.addEventListener('click', () => {
  if (currentData) showModal('Top Queries', currentData.topQueries, 'query');
});
document.getElementById('expand-pages')!.addEventListener('click', () => {
  if (currentData) showModal('Top Pages', currentData.topPages, 'page');
});
document.getElementById('modal-close')!.addEventListener('click', () => {
  document.getElementById('modal')!.style.display = 'none';
});
document.getElementById('modal')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal')) {
    document.getElementById('modal')!.style.display = 'none';
  }
});

// --- Countries ---
const ISO3_TO_2: Record<string, string> = {
  usa:'us',gbr:'gb',can:'ca',aus:'au',deu:'de',fra:'fr',jpn:'jp',ind:'in',bra:'br',ita:'it',
  esp:'es',mex:'mx',kor:'kr',nld:'nl',che:'ch',swe:'se',nor:'no',dnk:'dk',fin:'fi',bel:'be',
  aut:'at',irl:'ie',nzl:'nz',prt:'pt',pol:'pl',cze:'cz',rou:'ro',hun:'hu',grc:'gr',tur:'tr',
  arg:'ar',col:'co',chl:'cl',per:'pe',zaf:'za',isr:'il',are:'ae',sau:'sa',mys:'my',sgp:'sg',
  tha:'th',idn:'id',phl:'ph',vnm:'vn',twn:'tw',hkg:'hk',rus:'ru',ukr:'ua',bgr:'bg',hrv:'hr',
  svk:'sk',svn:'si',ltu:'lt',lva:'lv',est:'ee',
};
function countryFlag(code: string): string {
  if (!code) return '';
  const two = code.length === 3 ? (ISO3_TO_2[code.toLowerCase()] || '') : code.toLowerCase();
  if (two.length !== 2) return '';
  return String.fromCodePoint(...two.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function renderCountries(data: DashboardData) {
  const row = document.getElementById('below-fold-row')!;
  if (!data.countries || data.countries.length === 0) return;
  row.style.display = 'grid';

  renderCountryTable('countries-body', data.countries.slice(0, 10), 'all');
}

function renderCountryTable(tbodyId: string, rows: DashboardData['countries'], filter: string) {
  if (!rows) return;
  const tbody = document.getElementById(tbodyId)!;
  let filtered = rows;
  if (filter === 'growing') filtered = rows.filter(r => (r.clicks_change_pct ?? 0) > 0);
  else if (filter === 'declining') filtered = rows.filter(r => (r.clicks_change_pct ?? 0) < 0);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No data</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const flag = countryFlag(row.country);
    const changePct = row.clicks_change_pct;
    const changeClass = changePct == null ? 'neutral' : changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'neutral';
    const changeText = changePct == null ? '—' : (changePct > 0 ? '+' : '') + changePct + '%';
    return `<tr>
      <td><span class="country-flag">${flag}</span>${row.country.toUpperCase()}</td>
      <td class="num">${formatNumber(row.clicks)}</td>
      <td class="num">${formatNumber(row.impressions)}</td>
      <td class="num"><span class="change ${changeClass}">${changeText}</span></td>
    </tr>`;
  }).join('');
}

setupTabs('countries-tabs', 'countries-body', 'country');
document.getElementById('expand-countries')!.addEventListener('click', () => {
  if (currentData?.countries) showModal('Countries', currentData.countries, 'country');
});

// --- Ranking Buckets ---
function renderRankingBuckets(data: DashboardData) {
  const row = document.getElementById('rankings-row')!;
  if (!data.rankingBuckets || data.rankingBuckets.length === 0) return;
  row.style.display = 'grid';

  const container = document.getElementById('ranking-buckets')!;
  const maxCount = Math.max(...data.rankingBuckets.map(b => b.count), 1);

  container.innerHTML = data.rankingBuckets.map(b => {
    const pct = ((b.count / maxCount) * 100).toFixed(1);
    return `<div class="bucket-row">
      <span class="bucket-label">${b.bucket}</span>
      <div class="bucket-bar-bg"><div class="bucket-bar" style="width:${pct}%"></div></div>
      <span class="bucket-count">${formatNumber(b.count)}</span>
    </div>`;
  }).join('');
}

// --- New/Lost Rankings ---
function renderNewLost(data: DashboardData) {
  if ((!data.newQueries || data.newQueries.length === 0) && (!data.lostQueries || data.lostQueries.length === 0)) return;
  document.getElementById('rankings-row')!.style.display = 'grid';
  renderNewLostTable(data.newQueries || []);
}

function renderNewLostTable(rows: Array<{ query: string; clicks: number; impressions: number; avg_position: number | null }>) {
  const tbody = document.getElementById('newlost-body')!;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No data</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.slice(0, 10).map(row => {
    const pos = row.avg_position != null ? row.avg_position.toFixed(1) : '—';
    return `<tr>
      <td title="${escapeHtml(row.query)}">${escapeHtml(row.query)}</td>
      <td class="num">${formatNumber(row.clicks)}</td>
      <td class="num">${formatNumber(row.impressions)}</td>
      <td class="num">${pos}</td>
    </tr>`;
  }).join('');
}

document.getElementById('newlost-tabs')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn || !currentData) return;
  const tab = btn.dataset.tab;
  document.querySelectorAll('#newlost-tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('newlost-title')!.textContent = tab === 'lost' ? 'Lost Rankings' : 'New Rankings';
  renderNewLostTable(tab === 'lost' ? (currentData.lostQueries || []) : (currentData.newQueries || []));
});

// --- Branded Split ---
let brandedChart: Chart | null = null;

function renderBranded(data: DashboardData) {
  const card = document.getElementById('branded-card')!;
  if (!data.brandedSplit) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.getElementById('below-fold-row')!.style.display = 'grid';

  const { summary, priorSummary, trend } = data.brandedSplit;
  const branded = summary.find(s => s.segment === 'branded');
  const nonBranded = summary.find(s => s.segment === 'non-branded');
  const priorBranded = priorSummary?.find(s => s.segment === 'branded');
  const priorNonBranded = priorSummary?.find(s => s.segment === 'non-branded');

  const bClicks = branded?.clicks || 0;
  const nbClicks = nonBranded?.clicks || 0;
  const totalClicks = bClicks + nbClicks;
  const brandedPct = totalClicks > 0 ? ((bClicks / totalClicks) * 100).toFixed(1) : '0';

  const pctFn = (curr: number, prev: number) => prev === 0 ? null : Math.round(((curr - prev) / prev) * 1000) / 10;
  const bChange = pctFn(bClicks, priorBranded?.clicks || 0);
  const nbChange = pctFn(nbClicks, priorNonBranded?.clicks || 0);

  const summaryEl = document.getElementById('branded-summary')!;
  summaryEl.innerHTML = `
    <div class="branded-stat">
      <span class="bs-label">Branded</span>
      <span class="bs-value" style="color:var(--cyan)">${formatNumber(bClicks)}</span>
      <span class="bs-change change ${bChange == null ? 'neutral' : bChange > 0 ? 'positive' : 'negative'}">${bChange == null ? '—' : (bChange > 0 ? '+' : '') + bChange + '%'}</span>
    </div>
    <div class="branded-stat">
      <span class="bs-label">Non-Branded</span>
      <span class="bs-value" style="color:var(--purple)">${formatNumber(nbClicks)}</span>
      <span class="bs-change change ${nbChange == null ? 'neutral' : nbChange > 0 ? 'positive' : 'negative'}">${nbChange == null ? '—' : (nbChange > 0 ? '+' : '') + nbChange + '%'}</span>
    </div>
    <div class="branded-stat">
      <span class="bs-label">% Branded</span>
      <span class="bs-value" style="color:var(--orange)">${brandedPct}%</span>
    </div>`;

  // Mini chart
  if (brandedChart) brandedChart.destroy();
  const canvas = document.getElementById('branded-chart') as HTMLCanvasElement;

  const dates = [...new Set(trend.map(r => r.date))].sort();
  const bData = dates.map(d => trend.find(r => r.date === d && r.segment === 'branded')?.clicks || 0);
  const nbData = dates.map(d => trend.find(r => r.date === d && r.segment === 'non-branded')?.clicks || 0);

  brandedChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates.map(d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
      datasets: [
        { label: 'Branded', data: bData, borderColor: '#22d3ee', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
        { label: 'Non-Branded', data: nbData, borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: '#9aa0a6', boxWidth: 10, font: { size: 11 } } },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true },
      },
    },
  });
}

// --- Helpers ---
function formatNumber(n: number): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

function setMetric(id: string, value: string) {
  document.getElementById(id)!.textContent = value;
}

function setChange(id: string, pct: number | null, invertSentiment = false) {
  const el = document.getElementById(id)!;
  if (pct == null) {
    el.textContent = '—';
    el.className = 'change neutral';
    return;
  }
  const text = (pct > 0 ? '+' : '') + pct + '% vs prior';
  let cls: string;
  if (invertSentiment) {
    cls = pct < 0 ? 'positive' : pct > 0 ? 'negative' : 'neutral';
  } else {
    cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
  }
  el.textContent = text;
  el.className = 'change ' + cls;
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
