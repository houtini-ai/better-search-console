import { App } from '@modelcontextprotocol/ext-apps';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// --- Types ---
interface PropertyOverview {
  siteUrl: string;
  domain: string;
  lastSyncedAt: string | null;
  current: { clicks: number; impressions: number; ctr: number; avgPosition: number };
  changes: { clicksPct: number | null; impressionsPct: number | null; ctrPct: number | null; avgPositionPct: number | null };
  sparkline: Array<{ date: string; clicks: number; impressions: number }>;
}

interface OverviewData {
  dateRange: string;
  sortBy: string;
  properties: PropertyOverview[];
}

// --- State ---
let currentData: OverviewData | null = null;
const sparkCharts: Map<string, Chart> = new Map();

// --- MCP App ---
const app = new App({ name: 'BSC Overview', version: '1.0.0' });

app.ontoolresult = (result: { structuredContent?: OverviewData }) => {
  if (result.structuredContent) {
    currentData = result.structuredContent;
    render(currentData);
  }
};

// Establish communication with the host
app.connect();

// --- Date range buttons ---
document.getElementById('date-range')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn || !btn.dataset.range) return;

  document.querySelectorAll('#date-range button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const sortBy = (document.getElementById('sort-select') as HTMLSelectElement).value;
  app.callServerTool({ name: 'get_overview', arguments: { dateRange: btn.dataset.range, sortBy } });
});

// --- Sort selector ---
document.getElementById('sort-select')!.addEventListener('change', (e) => {
  const sortBy = (e.target as HTMLSelectElement).value;
  const activeRange = document.querySelector('#date-range button.active') as HTMLElement;
  const dateRange = activeRange?.dataset.range || '28d';
  app.callServerTool({ name: 'get_overview', arguments: { dateRange, sortBy } });
});

// --- Render ---
function render(data: OverviewData) {
  const content = document.getElementById('content')!;

  if (data.properties.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="big">📊</div>
        <div>No synced properties found</div>
        <div style="color:var(--text-muted);font-size:12px">Run sync_gsc_data to sync your properties first</div>
      </div>`;
    return;
  }

  // Destroy existing sparkline charts
  sparkCharts.forEach(c => c.destroy());
  sparkCharts.clear();

  content.innerHTML = `<div class="cards-grid">${data.properties.map((p, i) => renderCard(p, i)).join('')}</div>`;

  // Render sparklines after DOM is ready
  data.properties.forEach((p, i) => {
    renderSparkline(p, i);
  });

  // Card click → open full dashboard
  content.querySelectorAll('.property-card').forEach(card => {
    card.addEventListener('click', () => {
      const siteUrl = (card as HTMLElement).dataset.siteUrl;
      if (siteUrl) {
        const activeRange = document.querySelector('#date-range button.active') as HTMLElement;
        const dateRange = activeRange?.dataset.range || '28d';
        app.callServerTool('get_dashboard', { siteUrl, dateRange });
      }
    });
  });
}

function renderCard(p: PropertyOverview, index: number): string {
  return `
    <div class="property-card" data-site-url="${escapeHtml(p.siteUrl)}">
      <div class="card-header">
        <span class="card-domain">${escapeHtml(p.domain)}</span>
        <span class="card-arrow">→</span>
      </div>
      <div class="card-metrics">
        <div class="card-metric">
          <span class="metric-label">Clicks</span>
          <span class="metric-value clicks">${fmtNum(p.current.clicks)}</span>
          <span class="metric-change ${changeClass(p.changes.clicksPct)}">${fmtChange(p.changes.clicksPct)}</span>
        </div>
        <div class="card-metric">
          <span class="metric-label">Impressions</span>
          <span class="metric-value impressions">${fmtNum(p.current.impressions)}</span>
          <span class="metric-change ${changeClass(p.changes.impressionsPct)}">${fmtChange(p.changes.impressionsPct)}</span>
        </div>
        <div class="card-metric">
          <span class="metric-label">CTR</span>
          <span class="metric-value ctr">${((p.current.ctr || 0) * 100).toFixed(1)}%</span>
          <span class="metric-change ${changeClass(p.changes.ctrPct)}">${fmtChange(p.changes.ctrPct)}</span>
        </div>
        <div class="card-metric">
          <span class="metric-label">Position</span>
          <span class="metric-value position">${(p.current.avgPosition || 0).toFixed(1)}</span>
          <span class="metric-change ${changeClass(p.changes.avgPositionPct, true)}">${fmtChange(p.changes.avgPositionPct, true)}</span>
        </div>
      </div>
      <div class="sparkline-container">
        <canvas id="spark-${index}"></canvas>
      </div>
    </div>`;
}

function renderSparkline(p: PropertyOverview, index: number) {
  const canvas = document.getElementById(`spark-${index}`) as HTMLCanvasElement;
  if (!canvas || p.sparkline.length === 0) return;

  const labels = p.sparkline.map(d => d.date);
  const clicksData = p.sparkline.map(d => d.clicks);
  const impressionsData = p.sparkline.map(d => d.impressions);

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: clicksData,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34, 211, 238, 0.08)',
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          data: impressionsData,
          borderColor: '#a78bfa',
          backgroundColor: 'rgba(167, 139, 250, 0.05)',
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: {
          display: false,
          beginAtZero: true,
        },
        y1: {
          display: false,
          beginAtZero: true,
          position: 'right',
        },
      },
      interaction: { mode: 'nearest', intersect: false },
    },
  });

  sparkCharts.set(`spark-${index}`, chart);
}

// --- Helpers ---
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}

function fmtChange(pct: number | null, invertColor?: boolean): string {
  if (pct === null || pct === undefined) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function changeClass(pct: number | null, invert?: boolean): string {
  if (pct === null || pct === undefined) return 'neutral';
  if (invert) return pct < 0 ? 'positive' : pct > 0 ? 'negative' : 'neutral';
  return pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
