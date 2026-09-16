// ============================================================
// Supabase設定
// ============================================================
const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 日付ユーティリティ（JST）
// toISOString() はUTC変換でJSTとズレるため、日付文字列化には使わない
// ============================================================
function todayJST() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateJSTMinusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDateLabel(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ============================================================
// 状態
// ============================================================
const NUTRIENTS = ['タンパク質', '脂質', '炭水化物'];
let _logs  = [];
let _range = 14;
let _chart = null;

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// データ取得
// ============================================================
async function loadLogs() {
  const { data, error } = await db
    .from('protein_logs')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  _logs = data || [];
}

// ============================================================
// 今日の合計
// ============================================================
function renderTodaySummary() {
  const today = todayJST();
  const totals = { 'タンパク質': 0, '脂質': 0, '炭水化物': 0 };
  for (const log of _logs) {
    if (log.date !== today) continue;
    if (totals[log.source] !== undefined) totals[log.source] += log.amount_g;
  }
  document.getElementById('today-protein').textContent = `${totals['タンパク質']}g`;
  document.getElementById('today-fat').textContent     = `${totals['脂質']}g`;
  document.getElementById('today-carbs').textContent   = `${totals['炭水化物']}g`;
}

// ============================================================
// 日別推移グラフ
// ============================================================
function renderChart() {
  const startDate = dateJSTMinusDays(_range - 1);
  const dayMap = {};
  for (let i = _range - 1; i >= 0; i--) {
    dayMap[dateJSTMinusDays(i)] = { 'タンパク質': 0, '脂質': 0, '炭水化物': 0 };
  }
  for (const log of _logs) {
    if (log.date < startDate) continue;
    if (!dayMap[log.date]) continue;
    if (dayMap[log.date][log.source] !== undefined) dayMap[log.date][log.source] += log.amount_g;
  }
  const days = Object.keys(dayMap).sort();
  const labels = days.map(fmtDateLabel);

  const datasets = [
    { key: 'タンパク質', color: '#2563EB' },
    { key: '脂質',       color: '#E67E22' },
    { key: '炭水化物',   color: '#16A085' },
  ].map(({ key, color }) => ({
    label: key,
    data: days.map(d => dayMap[d][key]),
    borderColor: color,
    backgroundColor: color,
    tension: 0.3,
    pointRadius: 2,
  }));

  const ctx = document.getElementById('chart-nutrition').getContext('2d');
  if (_chart) _chart.destroy();
  _chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'g' } },
      },
    },
  });
}

// ============================================================
// 記録一覧
// ============================================================
function renderLogList() {
  const el = document.getElementById('log-list');
  if (_logs.length === 0) {
    el.innerHTML = '<div class="empty-state">まだ記録がありません</div>';
    return;
  }
  const groups = {};
  for (const log of _logs) {
    if (!groups[log.date]) groups[log.date] = [];
    groups[log.date].push(log);
  }
  const dates = Object.keys(groups).sort().reverse();
  el.innerHTML = dates.map(date => `
    <div class="day-group">
      <div class="day-group-header">${date}</div>
      ${groups[date].map(log => `
        <div class="log-row">
          <span class="log-tag ${NUTRIENTS.includes(log.source) ? log.source : 'default'}">${escapeHtml(log.source || '記録')}</span>
          <span class="log-amount">${log.amount_g}g</span>
          <span class="log-note">${escapeHtml(log.note || '')}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ============================================================
// 描画まとめ
// ============================================================
function renderAll() {
  renderTodaySummary();
  renderChart();
  renderLogList();
}

// ============================================================
// 初期化
// ============================================================
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _range = parseInt(btn.dataset.range);
    renderChart();
  });
});

document.getElementById('btn-refresh').addEventListener('click', async (e) => {
  e.currentTarget.classList.add('spinning');
  await loadLogs();
  renderAll();
  setTimeout(() => e.currentTarget.classList.remove('spinning'), 400);
});

(async function init() {
  await loadLogs();
  renderAll();
})();
