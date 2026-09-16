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
let _logs  = [];
let _range = 14;
let _chart = null;
let _pfcChart = null;

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

async function addLog(row) {
  const { data, error } = await db.from('protein_logs').insert([row]).select().single();
  if (error) { console.error(error); alert('保存に失敗しました'); return; }
  _logs.unshift(data);
  renderAll();
}

// ============================================================
// 今日の合計
// ============================================================
function renderTodaySummary() {
  const today = todayJST();
  const totals = { protein: 0, fat: 0, carb: 0, kcal: 0 };
  for (const log of _logs) {
    if (log.date !== today) continue;
    totals.protein += log.amount_g || 0;
    totals.fat     += log.fat_g    || 0;
    totals.carb    += log.carb_g   || 0;
    totals.kcal    += log.kcal     || 0;
  }
  document.getElementById('today-protein').textContent = `${totals.protein}g`;
  document.getElementById('today-fat').textContent     = `${totals.fat}g`;
  document.getElementById('today-carbs').textContent   = `${totals.carb}g`;
  document.getElementById('today-kcal').textContent    = `${totals.kcal}kcal`;
}

// ============================================================
// 日別推移グラフ
// ============================================================
function renderChart() {
  const startDate = dateJSTMinusDays(_range - 1);
  const dayMap = {};
  for (let i = _range - 1; i >= 0; i--) {
    dayMap[dateJSTMinusDays(i)] = { protein: 0, fat: 0, carb: 0 };
  }
  for (const log of _logs) {
    if (log.date < startDate) continue;
    if (!dayMap[log.date]) continue;
    dayMap[log.date].protein += log.amount_g || 0;
    dayMap[log.date].fat     += log.fat_g    || 0;
    dayMap[log.date].carb    += log.carb_g   || 0;
  }
  const days = Object.keys(dayMap).sort();
  const labels = days.map(fmtDateLabel);

  const datasets = [
    { key: 'protein', label: 'タンパク質', color: '#2563EB' },
    { key: 'fat',     label: '脂質',       color: '#E67E22' },
    { key: 'carb',    label: '炭水化物',   color: '#16A085' },
  ].map(({ key, label, color }) => ({
    label,
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
// 今日のPFCバランス（円グラフ、カロリー比率）
// ============================================================
function renderPfcChart() {
  const today = todayJST();
  let protein = 0, fat = 0, carb = 0;
  for (const log of _logs) {
    if (log.date !== today) continue;
    protein += log.amount_g || 0;
    fat     += log.fat_g    || 0;
    carb    += log.carb_g   || 0;
  }
  const kcalP = protein * 4, kcalF = fat * 9, kcalC = carb * 4;
  const total = kcalP + kcalF + kcalC;

  const canvas = document.getElementById('chart-pfc');
  const emptyEl = document.getElementById('pfc-empty');

  if (total === 0) {
    if (_pfcChart) { _pfcChart.destroy(); _pfcChart = null; }
    canvas.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  canvas.hidden = false;
  emptyEl.hidden = true;

  const ctx = canvas.getContext('2d');
  if (_pfcChart) _pfcChart.destroy();
  _pfcChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['タンパク質', '脂質', '炭水化物'],
      datasets: [{
        data: [kcalP, kcalF, kcalC],
        backgroundColor: ['#2563EB', '#E67E22', '#16A085'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const pct = Math.round(item.parsed / total * 100);
              return `${item.label}: ${pct}%`;
            },
          },
        },
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
          <div class="log-desc">
            <span class="log-source">${escapeHtml(log.source || '記録')}</span>
            ${log.note ? `<span class="log-note">${escapeHtml(log.note)}</span>` : ''}
          </div>
          <div class="log-macros">
            <span class="macro-tag protein">P ${log.amount_g || 0}g</span>
            <span class="macro-tag fat">F ${log.fat_g || 0}g</span>
            <span class="macro-tag carb">C ${log.carb_g || 0}g</span>
            ${log.kcal ? `<span class="macro-tag kcal">${log.kcal}kcal</span>` : ''}
          </div>
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
  renderPfcChart();
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
  const btn = e.currentTarget;
  btn.classList.add('spinning');
  await loadLogs();
  renderAll();
  setTimeout(() => btn.classList.remove('spinning'), 400);
});

// ============================================================
// クイック追加（プロテイン20g）
// ============================================================
document.getElementById('btn-quick-protein').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  await addLog({
    date: todayJST(),
    source: 'プロテイン',
    amount_g: 20,
    fat_g: 0,
    carb_g: 0,
    kcal: 80,
    note: null,
  });
  btn.disabled = false;
});

// ============================================================
// 記録追加モーダル
// ============================================================
const logModal = document.getElementById('log-modal-overlay');
const logForm  = document.getElementById('log-form');

function openLogModal() {
  logForm.reset();
  logForm.date.value = todayJST();
  logModal.hidden = false;
}
function closeLogModal() {
  logModal.hidden = true;
}

document.getElementById('btn-add-log').addEventListener('click', openLogModal);
document.getElementById('btn-cancel-log').addEventListener('click', closeLogModal);
logModal.addEventListener('click', (e) => { if (e.target === logModal) closeLogModal(); });

logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(logForm);
  const protein = parseInt(fd.get('amount_g')) || 0;
  const fat     = parseInt(fd.get('fat_g'))    || 0;
  const carb    = parseInt(fd.get('carb_g'))   || 0;
  const kcalRaw = fd.get('kcal');
  const kcal    = kcalRaw ? parseInt(kcalRaw) : (protein * 4 + fat * 9 + carb * 4);

  await addLog({
    date:     fd.get('date') || todayJST(),
    source:   fd.get('source') || '記録',
    amount_g: protein,
    fat_g:    fat,
    carb_g:   carb,
    kcal,
    note:     fd.get('note') || null,
  });
  closeLogModal();
});

(async function init() {
  await loadLogs();
  renderAll();
})();
