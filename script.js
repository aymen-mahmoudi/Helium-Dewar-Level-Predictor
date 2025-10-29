// ==== Config ====
const REFILL_THRESHOLD_L = 20;   // liters
const KG_TO_L = 8;               // 1 kg He = 8 L (conversion)
const DISPLAY_SCALE_L = 100;     // gauge visual scale only

// Fixed Dewar definitions (tare in kg)
const dewars = {
  A: { name: '9B',  tare: 136   },
  B: { name: '15',  tare: 132.1 }
};

let levelChart = null;

// ---- Controls for plot length/decimation ----
const MAX_HORIZON_DAYS = 365;       // never plot beyond this
const DAILY_TO_WEEKLY_SWITCH = 120; // after this, sample weekly

// ---- Core calculations (capacity-free) ----
function computeStats(d, currentWeightKg, lossPerDayKg) {
  const netHeKg = Math.max(0, (currentWeightKg || 0) - d.tare); // kg He
  const volumeL = netHeKg * KG_TO_L;                             // L He

  const lossPerDayL = Math.max(0, (lossPerDayKg || 0) * KG_TO_L);
  const volAboveThresh = volumeL - REFILL_THRESHOLD_L;

  // Days until reaching the 20 L threshold
  const daysToThreshold =
    volAboveThresh > 0 && lossPerDayL > 0
      ? volAboveThresh / lossPerDayL
      : 0;

  const refillDate = new Date();
  refillDate.setDate(refillDate.getDate() + Math.floor(daysToThreshold));

  // Gauge % (visual only)
  const displayPercent = Math.max(0, Math.min(100, (volumeL / DISPLAY_SCALE_L) * 100));

  return {
    volumeL,
    displayPercent,
    daysToThreshold,
    refillDate,
    lossPerDayL
  };
}

// ---- UI panel updates ----
function updatePanel(prefix, stats) {
  document.getElementById(`levelText${prefix}`).textContent = stats.volumeL.toFixed(1) + ' L';
  document.getElementById(`volumeRemaining${prefix}`).textContent = stats.volumeL.toFixed(1) + ' L';

  // Days until 20 L + refill date
  document.getElementById(`daysUntil30${prefix}`).textContent = stats.daysToThreshold.toFixed(1) + ' days';
  document.getElementById(`refillDate${prefix}`).textContent =
    stats.daysToThreshold > 0 ? stats.refillDate.toLocaleDateString() : 'Now';

  // Gauge fill (visual only)
  const fill = document.getElementById(`levelFill${prefix}`);
  fill.style.height = stats.displayPercent + '%';

  // Color coding based on absolute liters vs threshold
  let status = '';
  if (stats.volumeL <= REFILL_THRESHOLD_L) {
    fill.style.background = 'linear-gradient(180deg, rgba(192,21,47,0.3), rgba(192,21,47,0.6))';
    status = '<span class="status-badge status-critical">Refill</span>';
  } else if (stats.volumeL <= 2 * REFILL_THRESHOLD_L) {
    fill.style.background = 'linear-gradient(180deg, rgba(168,75,47,0.3), rgba(168,75,47,0.6))';
    status = '<span class="status-badge status-warning">Monitor</span>';
  } else {
    fill.style.background = 'linear-gradient(180deg, rgba(33,128,141,0.3), rgba(33,128,141,0.6))';
    status = '<span class="status-badge status-ok">Good</span>';
  }
  document.getElementById(`levelStatus${prefix}`).innerHTML = status;
}

// ---- Projection in liters (no capacity) ----
function buildProjection(volumeL, lossPerDayKg) {
  const lossPerDayL = Math.max(0, (lossPerDayKg || 0) * KG_TO_L);

  if (!lossPerDayL || volumeL <= 0) {
    return { labels: [], liters: [] };
  }

  const daysToEmpty = Math.ceil(volumeL / lossPerDayL);
  const horizon = Math.min(daysToEmpty, MAX_HORIZON_DAYS);

  const step = horizon > DAILY_TO_WEEKLY_SWITCH ? 7 : 1; // weekly if long
  const labels = [];
  const liters = [];

  const today = new Date();
  for (let d = 0; d <= horizon; d += step) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    labels.push(date.toLocaleDateString());

    const remL = Math.max(0, volumeL - d * lossPerDayL);
    liters.push(remL);
  }

  // Ensure the last point hits the horizon exactly
  if (horizon % step !== 0) {
    const end = new Date(today);
    end.setDate(today.getDate() + horizon);
    labels.push(end.toLocaleDateString());
    const remL = Math.max(0, volumeL - horizon * lossPerDayL);
    liters.push(remL);
  }

  return { labels, liters };
}

// ---- Chart rendering (liters) ----
function renderChart(projA, projB) {
  const ctx = document.getElementById('levelChart').getContext('2d');
  const labels = projA.labels.length >= projB.labels.length ? projA.labels : projB.labels;

  const data = {
    labels,
    datasets: [
      { label: 'Dewar 9B (L)',  data: projA.liters, borderWidth: 2, tension: 0.2, fill: false, pointRadius: 0 },
      { label: 'Dewar 15 (L)', data: projB.liters, borderWidth: 2, tension: 0.2, fill: false, pointRadius: 0 },
      { label: `Threshold (${REFILL_THRESHOLD_L} L)`, data: labels.map(() => REFILL_THRESHOLD_L), borderWidth: 1, borderDash: [6,6], fill: false, pointRadius: 0 }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} L` } },
      decimation: { enabled: true, algorithm: 'lttb', samples: 200 }
    },
    scales: {
      x: { ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { callback: (v) => v + ' L' } }
    }
  };

  if (levelChart) {
    levelChart.data = data;
    levelChart.options = options;
    levelChart.update();
  } else {
    levelChart = new Chart(ctx, { type: 'line', data, options });
  }
}

// ---- Orchestration ----
function calculateBoth() {
  const wA  = parseFloat(document.getElementById('currentWeightA').value);
  const lAkg = parseFloat(document.getElementById('lossPerDayA').value); // kg/day
  const wB  = parseFloat(document.getElementById('currentWeightB').value);
  const lBkg = parseFloat(document.getElementById('lossPerDayB').value); // kg/day

  const statsA = computeStats(dewars.A, wA, lAkg);
  const statsB = computeStats(dewars.B, wB, lBkg);

  updatePanel('A', statsA);
  updatePanel('B', statsB);

  const projA = buildProjection(statsA.volumeL, lAkg);
  const projB = buildProjection(statsB.volumeL, lBkg);
  renderChart(projA, projB);
}

calculateBoth();
