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
// 「今日」は0時切り替え（シンプルさ優先。Routineの3時ルールとは別物）
// ============================================================
function ymdStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function healthTodayDate() {
  return new Date();
}
function todayJST() {
  return ymdStr(healthTodayDate());
}
function dateJSTMinusDays(n) {
  const d = healthTodayDate();
  d.setDate(d.getDate() - n);
  return ymdStr(d);
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
let _bodyChart = null;
let _goals = { protein_target: 100, fat_target: 60, carb_target: 250 };
let _energyLogs = [];
let _balanceRange = 14;
let _logListDate = todayJST();
let _balanceChart = null;
let _bodyLogs = [];

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function roundG(n) {
  return Math.round((n || 0) * 10) / 10;
}
function fmtG(n) {
  return (n || 0).toFixed(1);
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

async function updateLog(id, row) {
  const { data, error } = await db.from('protein_logs').update(row).eq('id', id).select().single();
  if (error) { console.error(error); alert('更新に失敗しました'); return; }
  const idx = _logs.findIndex(l => l.id === id);
  if (idx !== -1) _logs[idx] = data;
  renderAll();
}

async function loadGoals() {
  const { data, error } = await db.from('health_goals').select('*').eq('id', 1).single();
  if (error) { console.error(error); return; }
  if (data) _goals = data;
}

async function saveGoals(g) {
  const { data, error } = await db.from('health_goals').update(g).eq('id', 1).select().single();
  if (error) { console.error(error); alert('保存に失敗しました'); return; }
  _goals = data;
  renderAll();
}

async function loadEnergyLogs() {
  const { data, error } = await db.from('health_energy_logs').select('*').order('date', { ascending: true }).limit(90);
  if (error) { console.error(error); return; }
  _energyLogs = data || [];
}

async function loadBodyLogs() {
  const { data, error } = await db.from('health_body_logs').select('*').order('measured_at', { ascending: true }).limit(300);
  if (error) { console.error(error); return; }
  _bodyLogs = data || [];
}

// 身長（固定値、BMI算出用。Evoltは体重しか測らないのでここから計算する）
const HEIGHT_M = 1.63;

// 日付ごとに measured_at が最新の1行だけを残す（トレンドグラフ・一覧用）
function bodyRowsByDay() {
  const map = {};
  for (const row of _bodyLogs) {
    const cur = map[row.date];
    if (!cur || new Date(row.measured_at) > new Date(cur.measured_at)) map[row.date] = row;
  }
  return Object.keys(map).sort().map(d => {
    const row = map[d];
    if (row.bmi == null && row.weight_kg != null) row.bmi = row.weight_kg / (HEIGHT_M * HEIGHT_M);
    return row;
  });
}

// 全体で一番新しい1行（カードのメイン表示用）
function latestBodyRow() {
  const days = bodyRowsByDay();
  return days.length ? days[days.length - 1] : null;
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
  document.getElementById('today-protein').textContent = `${fmtG(totals.protein)}g`;
  document.getElementById('today-fat').textContent     = `${fmtG(totals.fat)}g`;
  document.getElementById('today-carbs').textContent   = `${fmtG(totals.carb)}g`;
  document.getElementById('today-kcal').textContent    = `${totals.kcal}kcal`;

  renderRemain('remain-protein', _goals.protein_target, totals.protein);
  renderRemain('remain-fat',     _goals.fat_target,     totals.fat);
  renderRemain('remain-carb',    _goals.carb_target,    totals.carb);

  const kcalTarget = (_goals.protein_target || 0) * 4 + (_goals.fat_target || 0) * 9 + (_goals.carb_target || 0) * 4;
  renderRemain('remain-kcal', kcalTarget, totals.kcal, 'kcal', (n) => String(Math.round(n)));
}

function renderRemain(elId, target, consumed, unit = 'g', fmt = fmtG) {
  const el = document.getElementById(elId);
  const diff = target - consumed;
  if (diff >= 0) {
    el.textContent = `残り${fmt(diff)}${unit}`;
    el.classList.remove('over');
  } else {
    el.textContent = `+${fmt(Math.abs(diff))}${unit}超過`;
    el.classList.add('over');
  }
}

// ============================================================
// 日別推移グラフ
// ============================================================
function renderChart() {
  const startDate = dateJSTMinusDays(_range - 1);
  const dayMap = {};
  for (let i = _range - 1; i >= 0; i--) {
    dayMap[dateJSTMinusDays(i)] = { protein: 0, fat: 0, carb: 0, kcal: 0 };
  }
  for (const log of _logs) {
    if (log.date < startDate) continue;
    if (!dayMap[log.date]) continue;
    dayMap[log.date].protein += log.amount_g || 0;
    dayMap[log.date].fat     += log.fat_g    || 0;
    dayMap[log.date].carb    += log.carb_g   || 0;
    dayMap[log.date].kcal    += log.kcal     || 0;
  }
  const days = Object.keys(dayMap).sort();
  const labels = days.map(fmtDateLabel);

  const macroDatasets = [
    { key: 'protein', label: 'タンパク質', color: '#2563EB' },
    { key: 'fat',     label: '脂質',       color: '#E67E22' },
    { key: 'carb',    label: '炭水化物',   color: '#16A085' },
  ].map(({ key, label, color }) => ({
    type: 'line',
    label,
    data: days.map(d => roundG(dayMap[d][key])),
    borderColor: color,
    backgroundColor: color,
    tension: 0.3,
    pointRadius: 2,
    yAxisID: 'y',
    order: 0,
  }));
  const kcalDataset = {
    type: 'bar',
    label: 'カロリー(kcal)',
    data: days.map(d => dayMap[d].kcal),
    backgroundColor: 'rgba(138,155,176,0.3)',
    yAxisID: 'y1',
    order: 1,
  };
  const datasets = [...macroDatasets, kcalDataset];

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
        y:  { beginAtZero: true, title: { display: true, text: 'g' } },
        y1: {
          beginAtZero: true,
          position: 'right',
          title: { display: true, text: 'kcal' },
          grid: { drawOnChartArea: false },
        },
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
  const actualTotal = kcalP + kcalF + kcalC;

  const idealKcalP = (_goals.protein_target || 0) * 4;
  const idealKcalF = (_goals.fat_target     || 0) * 9;
  const idealKcalC = (_goals.carb_target    || 0) * 4;
  const idealTotal = idealKcalP + idealKcalF + idealKcalC;

  const canvas = document.getElementById('chart-pfc');
  const emptyEl = document.getElementById('pfc-empty');

  if (actualTotal === 0 && idealTotal === 0) {
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
      datasets: [
        {
          label: '実際',
          data: [kcalP, kcalF, kcalC],
          backgroundColor: ['#2563EB', '#E67E22', '#16A085'],
          borderWidth: 0,
        },
        {
          label: '目標',
          data: [idealKcalP, idealKcalF, idealKcalC],
          backgroundColor: ['rgba(37,99,235,0.3)', 'rgba(230,126,34,0.3)', 'rgba(22,160,133,0.3)'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const isIdeal = item.datasetIndex === 1;
              const total = isIdeal ? idealTotal : actualTotal;
              const pct = total > 0 ? Math.round(item.parsed / total * 100) : 0;
              return `${isIdeal ? '目標' : '実際'} ${item.label}: ${pct}%`;
            },
          },
        },
      },
    },
  });
}

// ============================================================
// カロリー収支推移（摂取 vs 消費）
// ============================================================
function renderBalanceChart() {
  const startDate = dateJSTMinusDays(_balanceRange - 1);
  const dayMap = {};
  for (let i = _balanceRange - 1; i >= 0; i--) {
    dayMap[dateJSTMinusDays(i)] = { intake: 0, burn: null, active: 0, resting: 0 };
  }
  for (const log of _logs) {
    if (log.date < startDate) continue;
    if (!dayMap[log.date]) continue;
    dayMap[log.date].intake += log.kcal || 0;
  }
  for (const e of _energyLogs) {
    if (e.date < startDate) continue;
    if (!dayMap[e.date]) continue;
    const active  = e.active_kcal || 0;
    const resting = e.resting_kcal != null
      ? e.resting_kcal
      : (latestBmrKcal() || 0) * bmrFractionForDate(e.date);
    dayMap[e.date].active  = Math.round(active);
    dayMap[e.date].resting = Math.round(resting);
    dayMap[e.date].burn    = active + resting;
  }
  const days = Object.keys(dayMap).sort();
  const labels = days.map(fmtDateLabel);
  const hasAnyBurn = days.some(d => dayMap[d].burn !== null);

  const canvas  = document.getElementById('chart-balance');
  const emptyEl = document.getElementById('balance-empty');
  canvas.hidden  = !hasAnyBurn;
  emptyEl.hidden = hasAnyBurn;

  if (hasAnyBurn) {
    const ctx = canvas.getContext('2d');
    if (_balanceChart) _balanceChart.destroy();
    _balanceChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar',  label: '摂取', data: days.map(d => dayMap[d].intake), backgroundColor: '#2563EB' },
          { type: 'bar',  label: '消費', data: days.map(d => dayMap[d].burn !== null ? Math.round(dayMap[d].burn) : null), backgroundColor: '#E67E22' },
          {
            type: 'line', label: '収支(累計)',
            data: (() => {
              let cum = 0;
              return days.map(d => {
                if (dayMap[d].burn !== null) cum += Math.round(dayMap[d].intake - dayMap[d].burn);
                return cum;
              });
            })(),
            borderColor: '#16A085', backgroundColor: '#16A085',
            tension: 0.3, pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (item) => {
                if (item.dataset.label === '消費') {
                  const d = days[item.dataIndex];
                  return `消費: ${d ? dayMap[d].active : 0}kcal(運動) + ${d ? dayMap[d].resting : 0}kcal(基礎代謝)`;
                }
                return `${item.dataset.label}: ${item.formattedValue}kcal`;
              },
            },
          },
        },
        scales: { y: { title: { display: true, text: 'kcal' } } },
      },
    });
  } else if (_balanceChart) {
    _balanceChart.destroy();
    _balanceChart = null;
  }

  const today = todayJST();
  const t = dayMap[today] || { intake: 0, burn: null };
  const capEl = document.getElementById('balance-today-caption');
  if (t.burn === null) {
    capEl.textContent = `今日: 摂取${t.intake}kcal / 消費データなし`;
  } else {
    const burn = Math.round(t.burn);
    const net = t.intake - burn;
    capEl.textContent = `今日: 摂取${t.intake}kcal / 消費${burn}kcal / 収支${net > 0 ? '+' : ''}${net}kcal`;
  }
}

// ============================================================
// 体組成（Evolt 360、ジムで測定しチャット経由で手入力）
// ============================================================
const EVOLT_MAIN = ['weight_kg', 'bmi', 'body_fat_pct', 'skeletal_muscle_mass_kg', 'lean_body_mass_kg', 'visceral_fat_level', 'bmr_kcal', 'body_age'];
const EVOLT_SUB   = [
  'body_fat_mass_kg', 'subcutaneous_fat_mass_kg', 'visceral_fat_area_cm2',
  'total_body_water_kg', 'icf_kg', 'ecf_kg', 'abdominal_circumference_cm',
  'waist_hip_ratio', 'bwi_score', 'tee_kcal',
  'lean_mass_left_arm_kg', 'lean_mass_right_arm_kg', 'lean_mass_torso_kg',
  'lean_mass_left_leg_kg', 'lean_mass_right_leg_kg',
  'fat_mass_left_arm_kg', 'fat_mass_right_arm_kg', 'fat_mass_torso_kg',
  'fat_mass_left_leg_kg', 'fat_mass_right_leg_kg',
];

const BODY_METRICS = {
  weight_kg:              { label: '体重',         unit: 'kg',   color: '#2563EB', decimals: 1 },
  bmi:                    { label: 'BMI',          unit: '',     color: '#8B5CF6', decimals: 1 },
  body_fat_pct:           { label: '体脂肪率',     unit: '%',    color: '#E67E22', decimals: 1 },
  visceral_fat_level:     { label: '内臓脂肪Lv',   unit: '',     color: '#DC2626', decimals: 0 },
  bmr_kcal:               { label: '基礎代謝',     unit: 'kcal', color: '#F59E0B', decimals: 0 },
  body_age:               { label: '体内年齢',     unit: '歳',   color: '#0EA5E9', decimals: 0 },
  // Evoltメイン
  skeletal_muscle_mass_kg:{ label: '骨格筋量',     unit: 'kg',   color: '#16A085', decimals: 1 },
  lean_body_mass_kg:      { label: '除脂肪量',     unit: 'kg',   color: '#0D9488', decimals: 1 },
  // Evoltサブ
  body_fat_mass_kg:              { label: '体脂肪量',       unit: 'kg',  color: '#64748B', decimals: 1 },
  subcutaneous_fat_mass_kg:      { label: '皮下脂肪量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  visceral_fat_area_cm2:         { label: '内臓脂肪面積',   unit: 'cm²', color: '#64748B', decimals: 1 },
  total_body_water_kg:           { label: '体水分量',       unit: 'kg',  color: '#64748B', decimals: 1 },
  icf_kg:                        { label: '細胞内液',       unit: 'kg',  color: '#64748B', decimals: 1 },
  ecf_kg:                        { label: '細胞外液',       unit: 'kg',  color: '#64748B', decimals: 1 },
  abdominal_circumference_cm:    { label: '腹囲',           unit: 'cm',  color: '#64748B', decimals: 1 },
  waist_hip_ratio:               { label: 'ウエストヒップ比', unit: '',  color: '#64748B', decimals: 2 },
  bwi_score:                     { label: 'BWIスコア',      unit: '',    color: '#64748B', decimals: 1 },
  tee_kcal:                      { label: 'TEE',            unit: 'kcal',color: '#64748B', decimals: 0 },
  lean_mass_left_arm_kg:         { label: '左腕筋肉量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  lean_mass_right_arm_kg:        { label: '右腕筋肉量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  lean_mass_torso_kg:            { label: '体幹筋肉量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  lean_mass_left_leg_kg:         { label: '左脚筋肉量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  lean_mass_right_leg_kg:        { label: '右脚筋肉量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  fat_mass_left_arm_kg:          { label: '左腕脂肪量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  fat_mass_right_arm_kg:         { label: '右腕脂肪量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  fat_mass_torso_kg:             { label: '体幹脂肪量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  fat_mass_left_leg_kg:          { label: '左脚脂肪量',     unit: 'kg',  color: '#64748B', decimals: 1 },
  fat_mass_right_leg_kg:         { label: '右脚脂肪量',     unit: 'kg',  color: '#64748B', decimals: 1 },
};
let _bodyMetric = 'weight_kg';

function latestBmrKcal() {
  const days = bodyRowsByDay();
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].bmr_kcal != null) return days[i].bmr_kcal;
  }
  return null;
}

// 今日はまだ1日が終わっていないので、基礎代謝を24分割して経過時間分だけ加算する
// （過去の日はすでに1日が終わっているので満額）
function bmrFractionForDate(dateStr) {
  const today = todayJST();
  if (dateStr < today) return 1;
  if (dateStr > today) return 0;
  return new Date().getHours() / 24;
}

function buildStatTile(key, value, metric) {
  if (value == null) return '';
  const active = key === _bodyMetric ? ' active' : '';
  return `<button class="body-stat-item${active}" data-metric="${key}" style="--mc:${metric.color}">
    <div class="body-stat-label">${metric.label}</div>
    <div class="body-stat-val">${Number(value).toFixed(metric.decimals)}${metric.unit}</div>
  </button>`;
}

function renderBodyComp() {
  const canvas     = document.getElementById('chart-body');
  const emptyEl    = document.getElementById('hp-empty');
  const statsGrid  = document.getElementById('body-stats-grid');
  const subSection = document.getElementById('body-sub-section');
  const subGrid    = document.getElementById('body-sub-grid');
  const caption    = document.getElementById('body-chart-caption');

  const latest = latestBodyRow();

  if (!latest) {
    canvas.hidden = true;
    statsGrid.hidden = true;
    subSection.hidden = true;
    emptyEl.hidden = false;
    if (_bodyChart) { _bodyChart.destroy(); _bodyChart = null; }
    return;
  }
  canvas.hidden = false;
  statsGrid.hidden = false;
  subSection.hidden = false;
  emptyEl.hidden = true;

  statsGrid.innerHTML = EVOLT_MAIN.map(key => buildStatTile(key, latest[key], BODY_METRICS[key])).join('');
  subGrid.innerHTML = EVOLT_SUB.map(key => buildStatTile(key, latest[key], BODY_METRICS[key])).join('');

  const metric = BODY_METRICS[_bodyMetric];
  const days = bodyRowsByDay();
  const labels = days.map(r => fmtDateLabel(r.date));
  const ctx = canvas.getContext('2d');
  if (_bodyChart) _bodyChart.destroy();
  _bodyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: metric.label,
        data: days.map(r => (r[_bodyMetric] != null ? r[_bodyMetric] : null)),
        borderColor: metric.color,
        backgroundColor: metric.color,
        tension: 0.3,
        pointRadius: 2,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false, title: { display: true, text: metric.unit || metric.label } } },
    },
  });

  caption.hidden = !(_bodyMetric === 'weight_kg' || _bodyMetric === 'body_fat_pct');
}

// ============================================================
// 記録一覧
// ============================================================
function renderLogList() {
  const el = document.getElementById('log-list');
  document.getElementById('log-date-input').value = _logListDate;
  document.getElementById('log-next').disabled = _logListDate >= todayJST();

  const dayLogs = _logs.filter(log => log.date === _logListDate);
  if (dayLogs.length === 0) {
    el.innerHTML = '<div class="empty-state">この日の記録はありません</div>';
    return;
  }
  const dayKcal = dayLogs.reduce((sum, log) => sum + (log.kcal || 0), 0);
  el.innerHTML = `
    <div class="day-total">合計 ${dayKcal}kcal</div>
    ${dayLogs.map(log => `
      <div class="log-row">
        <div class="log-desc">
          <span class="log-source">${escapeHtml(log.source || '記録')}</span>
          ${log.note ? `<span class="log-note">${escapeHtml(log.note)}</span>` : ''}
          <button class="btn-edit-log" data-id="${log.id}" title="編集">✎</button>
        </div>
        <div class="log-macros">
          <span class="macro-tag protein">P ${fmtG(log.amount_g)}g</span>
          <span class="macro-tag fat">F ${fmtG(log.fat_g)}g</span>
          <span class="macro-tag carb">C ${fmtG(log.carb_g)}g</span>
          ${log.kcal ? `<span class="macro-tag kcal">${log.kcal}kcal</span>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}

function shiftLogDate(days) {
  const d = new Date(_logListDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const newDate = ymdStr(d);
  if (newDate > todayJST()) return;
  _logListDate = newDate;
  renderLogList();
}

// ============================================================
// 描画まとめ
// ============================================================
function renderAll() {
  renderTodaySummary();
  renderChart();
  renderPfcChart();
  renderLogList();
  renderBalanceChart();
  renderBodyComp();
}

// ============================================================
// 初期化
// ============================================================
document.querySelectorAll('#nutrition-range-toggle .range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#nutrition-range-toggle .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _range = parseInt(btn.dataset.range);
    renderChart();
  });
});

document.querySelectorAll('#balance-range-toggle .range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#balance-range-toggle .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _balanceRange = parseInt(btn.dataset.range);
    renderBalanceChart();
  });
});

function handleBodyMetricClick(e) {
  const btn = e.target.closest('.body-stat-item');
  if (!btn) return;
  _bodyMetric = btn.dataset.metric;
  renderBodyComp();
}
document.getElementById('body-stats-grid').addEventListener('click', handleBodyMetricClick);
document.getElementById('body-sub-grid').addEventListener('click', handleBodyMetricClick);

document.getElementById('body-sub-toggle').addEventListener('click', () => {
  const grid = document.getElementById('body-sub-grid');
  const open = !grid.hidden;
  grid.hidden = open;
  document.getElementById('body-sub-toggle').textContent = open ? '詳細を見る ▾' : '閉じる ▴';
});

document.getElementById('log-prev').addEventListener('click', () => shiftLogDate(-1));
document.getElementById('log-next').addEventListener('click', () => shiftLogDate(1));
document.getElementById('log-date-input').addEventListener('change', (e) => {
  const v = e.target.value;
  if (!v) return;
  _logListDate = v > todayJST() ? todayJST() : v;
  renderLogList();
});

document.getElementById('btn-refresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.add('spinning');
  await Promise.all([loadLogs(), loadGoals(), loadEnergyLogs(), loadBodyLogs()]);
  renderAll();
  setTimeout(() => btn.classList.remove('spinning'), 400);
});

// ============================================================
// クイック追加（プロテイン20g）
// ============================================================
document.getElementById('btn-quick-protein').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const p = 20, f = 1.8, c = 3.3;
  await addLog({
    date: todayJST(),
    source: 'プロテイン',
    amount_g: p,
    fat_g: f,
    carb_g: c,
    kcal: Math.round(p * 4 + f * 9 + c * 4),
    note: null,
  });
  btn.disabled = false;
});

// ============================================================
// 記録追加モーダル
// ============================================================
const logModal = document.getElementById('log-modal-overlay');
const logForm  = document.getElementById('log-form');

function openLogModal(log) {
  logForm.reset();
  document.getElementById('log-form-title').textContent = log ? '記録を編集' : '記録を追加';
  logForm.elements['id'].value = log ? log.id : '';
  logForm.date.value     = log ? log.date : todayJST();
  logForm.source.value   = log ? (log.source || '') : '';
  logForm.amount_g.value = log ? log.amount_g : '';
  logForm.fat_g.value    = log ? log.fat_g : '';
  logForm.carb_g.value   = log ? log.carb_g : '';
  logForm.kcal.value     = log ? log.kcal : '';
  logForm.note.value     = log ? (log.note || '') : '';
  logModal.hidden = false;
}
function closeLogModal() {
  logModal.hidden = true;
}

document.getElementById('btn-add-log').addEventListener('click', () => openLogModal());
document.getElementById('btn-cancel-log').addEventListener('click', closeLogModal);
logModal.addEventListener('click', (e) => { if (e.target === logModal) closeLogModal(); });

document.getElementById('log-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-edit-log');
  if (!btn) return;
  const log = _logs.find(l => l.id === btn.dataset.id);
  if (log) openLogModal(log);
});

logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(logForm);
  const protein = parseFloat(fd.get('amount_g')) || 0;
  const fat     = parseFloat(fd.get('fat_g'))    || 0;
  const carb    = parseFloat(fd.get('carb_g'))   || 0;
  const kcalRaw = fd.get('kcal');
  const kcal    = kcalRaw ? parseInt(kcalRaw) : Math.round(protein * 4 + fat * 9 + carb * 4);
  const id      = fd.get('id');

  const row = {
    date:     fd.get('date') || todayJST(),
    source:   fd.get('source') || '記録',
    amount_g: protein,
    fat_g:    fat,
    carb_g:   carb,
    kcal,
    note:     fd.get('note') || null,
  };

  if (id) await updateLog(id, row);
  else await addLog(row);
  closeLogModal();
});

// ============================================================
// 目標編集モーダル
// ============================================================
const goalModal = document.getElementById('goal-modal-overlay');
const goalForm  = document.getElementById('goal-form');

function openGoalModal() {
  goalForm.protein_target.value = _goals.protein_target;
  goalForm.fat_target.value     = _goals.fat_target;
  goalForm.carb_target.value    = _goals.carb_target;
  goalModal.hidden = false;
}
function closeGoalModal() {
  goalModal.hidden = true;
}

document.getElementById('btn-edit-goal').addEventListener('click', openGoalModal);
document.getElementById('btn-cancel-goal').addEventListener('click', closeGoalModal);
goalModal.addEventListener('click', (e) => { if (e.target === goalModal) closeGoalModal(); });

goalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(goalForm);
  await saveGoals({
    protein_target: parseInt(fd.get('protein_target')) || 0,
    fat_target:     parseInt(fd.get('fat_target'))     || 0,
    carb_target:    parseInt(fd.get('carb_target'))    || 0,
  });
  closeGoalModal();
});

(async function init() {
  await Promise.all([loadLogs(), loadGoals(), loadEnergyLogs(), loadBodyLogs()]);
  renderAll();
})();
