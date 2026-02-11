import { App } from '@modelcontextprotocol/ext-apps';

// --- Types ---
interface SyncJobResult {
  siteUrl: string;
  status: 'completed' | 'failed' | 'skipped' | 'cancelled';
  rowsFetched: number;
  rowsInserted: number;
  durationMs: number;
  error?: string;
}

interface SyncStatus {
  jobId: string;
  status: 'queued' | 'syncing' | 'completed' | 'failed' | 'cancelled';
  totalProperties: number;
  completedProperties: number;
  currentProperty: string | null;
  rowsFetched: number;
  estimatedTotalRows: number | null;
  apiCallsMade: number;
  startedAt: string;
  elapsedMs: number;
  results: SyncJobResult[];
  error?: string;
}

// --- DOM refs ---
const $jobId = document.getElementById('job-id')!;
const $statusBadge = document.getElementById('status-badge')!;
const $elapsed = document.getElementById('elapsed')!;
const $overallProgress = document.getElementById('overall-progress')!;
const $overallLabel = document.getElementById('overall-label')!;
const $overallCount = document.getElementById('overall-count')!;
const $overallFill = document.getElementById('overall-fill')!;
const $currentSection = document.getElementById('current-section')!;
const $currentLabel = document.getElementById('current-label')!;
const $rowsCount = document.getElementById('rows-count')!;
const $rowsFill = document.getElementById('rows-fill')!;
const $apiCalls = document.getElementById('api-calls')!;
const $resultsSection = document.getElementById('results-section')!;
const $resultsList = document.getElementById('results-list')!;
const $btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement;

// --- State ---
let currentJobId: string | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// --- MCP App ---
const app = new App({ name: 'BSC Sync Progress', version: '1.0.0' });

app.ontoolresult = (result: { structuredContent?: SyncStatus }) => {
  if (result.structuredContent) {
    const status = result.structuredContent;
    currentJobId = status.jobId;
    render(status);
    startPolling();
  }
};

// Establish communication with the host
app.connect();

// --- Cancel button ---
$btnCancel.addEventListener('click', async () => {
  if (!currentJobId) return;
  $btnCancel.disabled = true;
  $btnCancel.textContent = 'Cancelling...';
  try {
    await app.callServerTool({ name: 'cancel_sync', arguments: { jobId: currentJobId } });
  } catch {
    // Status will update on next poll
  }
});

// --- Polling ---
function startPolling(): void {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    if (!currentJobId) return;
    try {
      const result = await app.callServerTool({ name: 'check_sync_status', arguments: { jobId: currentJobId } });
      if (result?.structuredContent) {
        render(result.structuredContent as SyncStatus);
      }
    } catch {
      // Ignore polling errors
    }
  }, 2000);
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// --- Render ---
function render(data: SyncStatus): void {
  // Job ID
  $jobId.textContent = `Job: ${data.jobId}`;

  // Status badge
  $statusBadge.textContent = data.status;
  $statusBadge.className = `status-badge ${data.status}`;

  // Elapsed time
  $elapsed.textContent = formatDuration(data.elapsedMs);

  // Overall progress (show if multi-property)
  if (data.totalProperties > 1) {
    $overallProgress.style.display = 'block';
    $overallLabel.textContent = 'Properties';
    $overallCount.textContent = `${data.completedProperties} / ${data.totalProperties}`;
    const pct = data.totalProperties > 0
      ? (data.completedProperties / data.totalProperties) * 100
      : 0;
    $overallFill.style.width = `${pct}%`;
  } else {
    $overallProgress.style.display = 'none';
  }

  // Current property progress
  const isActive = data.status === 'syncing' || data.status === 'queued';
  if (isActive && data.currentProperty) {
    $currentSection.style.display = 'block';
    $currentLabel.textContent = extractDomain(data.currentProperty);
    $rowsCount.textContent = formatNumber(data.rowsFetched) + ' rows';
    $apiCalls.textContent = `${data.apiCallsMade} API calls`;

    // Progress bar: use estimated total if available
    if (data.estimatedTotalRows && data.estimatedTotalRows > 0) {
      const rowPct = Math.min((data.rowsFetched / data.estimatedTotalRows) * 100, 95);
      $rowsFill.style.width = `${rowPct}%`;
    } else if (data.rowsFetched > 0) {
      // Indeterminate-ish: show some progress
      $rowsFill.style.width = '30%';
    } else {
      $rowsFill.style.width = '0%';
    }
  } else {
    $currentSection.style.display = 'none';
  }

  // Results list
  if (data.results.length > 0) {
    $resultsSection.style.display = 'block';
    $resultsList.innerHTML = data.results.map(r => {
      const domain = extractDomain(r.siteUrl);
      const rows = r.rowsFetched > 0 ? formatNumber(r.rowsFetched) + ' rows' : '';
      const duration = r.durationMs > 0 ? formatDuration(r.durationMs) : '';
      const meta = [rows, duration].filter(Boolean).join(' / ');
      return `
        <div class="result-row">
          <span class="domain">${domain}</span>
          <span class="rows">${meta}</span>
          <span class="result-status ${r.status}">${r.status}</span>
        </div>
      `;
    }).join('');
  }

  // Cancel button visibility
  if (!isActive) {
    $btnCancel.style.display = 'none';
    stopPolling();

    // Set overall fill to 100% on completion
    if (data.status === 'completed') {
      $overallFill.style.width = '100%';
    }
  }
}

// --- Helpers ---
function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function extractDomain(siteUrl: string): string {
  return siteUrl
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}
