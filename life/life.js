// ============================================================
// Supabase設定
// ============================================================
const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 定数
// ============================================================
const PURPOSE_COLORS = {
  '娯楽':      { bg: '#fde8e8', color: '#c0392b' },
  '勉強':      { bg: '#ebf5fb', color: '#2471a3' },
  '仕事':      { bg: '#fef5e7', color: '#d68910' },
  '生活必需品': { bg: '#eafaf1', color: '#1e8449' },
  'クラウド':   { bg: '#eaf0fb', color: '#2471a3' },
  'その他':    { bg: '#f4f6f7', color: '#717d7e' },
};

// ============================================================
// 状態
// ============================================================
let _subs          = [];
let _purposeFilter = 'all';
let _usdRate       = null;

async function fetchUsdRate() {
  try {
    const res  = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    const data = await res.json();
    _usdRate   = data.usd.jpy;
    const el = document.getElementById('usd-rate-val');
    if (el) el.textContent = _usdRate.toFixed(2);
  } catch (e) {
    _usdRate = 150;
    console.warn('為替レート取得失敗。¥150で代替します');
  }
}

function toJpy(amount, currency) {
  if (!amount) return 0;
  if (currency === 'USD') return Math.round(amount * (_usdRate || 150));
  return Math.round(amount);
}

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Subscription CRUD
// ============================================================
function normalizeSub(row) {
  return {
    id:            row.id,
    name:          row.name,
    contractForm:  row.contract_form,
    costPerMonth:  row.cost_per_month,
    costPerYear:   row.cost_per_year,
    status:        row.status         || 'active',
    startDate:     row.start_date,
    purpose:       row.purpose,
    paymentMethod: row.payment_method,
    payer:         row.payer          || '自分',
    autoRenew:     row.auto_renew     ?? true,
    note:          row.note,
    currency:      row.currency       || 'JPY',
  };
}

function subToRow(sub) {
  return {
    name:           sub.name,
    contract_form:  sub.contractForm,
    cost_per_month: sub.costPerMonth ? parseInt(sub.costPerMonth) : null,
    cost_per_year:  sub.costPerYear  ? parseInt(sub.costPerYear)  : null,
    status:         sub.status,
    start_date:     sub.startDate     || null,
    purpose:        sub.purpose       || null,
    payment_method: sub.paymentMethod || null,
    payer:          sub.payer         || '自分',
    auto_renew:     sub.autoRenew     ?? true,
    note:           sub.note          || null,
    currency:       sub.currency      || 'JPY',
  };
}

async function loadSubs() {
  const { data } = await db.from('subscriptions').select('*').order('created_at');
  _subs = (data || []).map(normalizeSub);
}

async function addSub(sub) {
  const { data, error } = await db.from('subscriptions').insert([subToRow(sub)]).select().single();
  if (error) { console.error('addSub error:', error); return; }
  _subs.push(normalizeSub(data));
}

async function updateSub(id, sub) {
  const row = subToRow(sub);
  const { error } = await db.from('subscriptions').update(row).eq('id', id);
  if (error) { console.error('updateSub error:', error); return; }
  const idx = _subs.findIndex(s => s.id === id);
  if (idx !== -1) _subs[idx] = normalizeSub({ id, ...row });
}

async function deleteSub(id) {
  const { error } = await db.from('subscriptions').delete().eq('id', id);
  if (error) { console.error('deleteSub error:', error); return; }
  _subs = _subs.filter(s => s.id !== id);
}

// ============================================================
// 計算
// ============================================================
function monthlyEquiv(sub) {
  if (sub.status !== 'active' || sub.payer !== '自分') return 0;
  if (sub.contractForm === 'month') return toJpy(sub.costPerMonth, sub.currency);
  return Math.round(toJpy(sub.costPerYear, sub.currency) / 12);
}

function yearlyEquiv(sub) {
  if (sub.status !== 'active' || sub.payer !== '自分') return 0;
  if (sub.contractForm === 'year') return toJpy(sub.costPerYear, sub.currency);
  return toJpy(sub.costPerMonth, sub.currency) * 12;
}

// ============================================================
// サマリー更新
// ============================================================
function updateSummary() {
  const monthly = _subs.reduce((sum, s) => sum + monthlyEquiv(s), 0);
  const yearly  = _subs.reduce((sum, s) => sum + yearlyEquiv(s),  0);
  const count   = _subs.filter(s => s.status === 'active').length;
  document.getElementById('total-monthly').textContent = '¥' + monthly.toLocaleString();
  document.getElementById('total-yearly').textContent  = '¥' + yearly.toLocaleString();
  document.getElementById('total-count').textContent   = count;
}

// ============================================================
// レンダリング
// ============================================================
function renderSubs() {
  const container = document.getElementById('sub-list');
  const filtered  = _purposeFilter === 'all'
    ? _subs
    : _subs.filter(s => s.purpose === _purposeFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-msg">サブスクがありません。「＋ 追加」から登録してください。</div>';
    return;
  }

  const active    = filtered.filter(s => s.status === 'active');
  const cancelled = filtered.filter(s => s.status === 'cancelled');

  let html = '';
  if (active.length > 0)    html += renderSubGroup(active, false);
  if (cancelled.length > 0) {
    html += '<div class="sub-group-sep">解約済み</div>';
    html += renderSubGroup(cancelled, true);
  }

  container.innerHTML = html;

  container.querySelectorAll('.btn-sub-edit').forEach(btn =>
    btn.addEventListener('click', () => openEditSubForm(btn.dataset.id))
  );
  container.querySelectorAll('.btn-sub-delete').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteSub(btn.dataset.id))
  );
}

function renderSubGroup(subs, muted) {
  const rows = subs.map(s => {
    const clr = PURPOSE_COLORS[s.purpose] || { bg: '#f4f6f7', color: '#717d7e' };
    const purposeBadge = s.purpose
      ? `<span class="badge-purpose" style="background:${clr.bg};color:${clr.color}">${escapeHtml(s.purpose)}</span>`
      : '';
    const formBadge  = `<span class="badge-form badge-form-${s.contractForm}">${s.contractForm === 'month' ? '月' : '年'}</span>`;
    const payerBadge = s.payer === '家族'
      ? `<span class="badge-payer-family">家族</span>`
      : '';

    const isUsd   = s.currency === 'USD';
    const symbol  = isUsd ? '$' : '¥';
    const costAmt = s.contractForm === 'month' ? (s.costPerMonth || 0) : (s.costPerYear || 0);
    const unit    = s.contractForm === 'month' ? '/月' : '/年';
    const costFmt = isUsd ? costAmt.toFixed(2) : costAmt.toLocaleString();
    const costDisp = `${symbol}${costFmt}<span class="cost-unit">${unit}</span>`;

    let monthlyHint = '';
    if (isUsd && costAmt) {
      const jpyMonthly = s.contractForm === 'month'
        ? toJpy(s.costPerMonth, 'USD')
        : Math.round(toJpy(s.costPerYear, 'USD') / 12);
      monthlyHint = `<span class="monthly-equiv">≈¥${jpyMonthly.toLocaleString()}/月</span>`;
    } else if (!isUsd && s.contractForm === 'year' && s.costPerYear) {
      monthlyHint = `<span class="monthly-equiv">≈¥${Math.round(s.costPerYear / 12).toLocaleString()}/月</span>`;
    }

    const metaParts = [
      s.paymentMethod || '',
      s.autoRenew ? '🔄' : '🔔',
    ].filter(Boolean).join(' ');

    return `<div class="sub-row${muted ? ' sub-muted' : ''}">
      <div class="sub-row-left">
        <span class="sub-name">${escapeHtml(s.name)}</span>
        ${s.note ? `<span class="sub-row-note">${escapeHtml(s.note)}</span>` : ''}
      </div>
      <div class="sub-row-center">
        <span class="sub-badges">${payerBadge}${purposeBadge}${formBadge}</span>
        ${metaParts ? `<span class="sub-row-meta">${metaParts}</span>` : ''}
      </div>
      <div class="sub-row-right">
        <span class="sub-cost-inline">${costDisp}${monthlyHint}</span>
        <div class="sub-actions">
          <button class="small-btn btn-sub-edit"   data-id="${s.id}">編集</button>
          <button class="small-btn btn-sub-delete" data-id="${s.id}">削除</button>
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div class="sub-list-wrap">${rows}</div>`;
}

// ============================================================
// フォーム操作
// ============================================================
function updateCostFields(contractForm) {
  document.getElementById('cost-month-wrap').hidden = contractForm === 'year';
  document.getElementById('cost-year-wrap').hidden  = contractForm === 'month';
}

function openAddSubForm() {
  const form = document.getElementById('sub-form');
  form.reset();
  form.elements.id.value = '';
  document.getElementById('sub-form-title').textContent = '新規サブスク';
  updateCostFields('month');
  document.getElementById('sub-modal-overlay').hidden = false;
}

function openEditSubForm(id) {
  const sub = _subs.find(s => s.id === id);
  if (!sub) return;
  const form = document.getElementById('sub-form');
  form.elements.id.value           = sub.id;
  form.elements.name.value         = sub.name;
  form.elements.contractForm.value = sub.contractForm;
  form.elements.costPerMonth.value = sub.costPerMonth || '';
  form.elements.costPerYear.value  = sub.costPerYear  || '';
  form.elements.purpose.value       = sub.purpose       || '';
  form.elements.startDate.value     = sub.startDate      || '';
  form.elements.paymentMethod.value = sub.paymentMethod  || '';
  form.elements.payer.value         = sub.payer          || '自分';
  form.elements.autoRenew.checked   = sub.autoRenew      ?? true;
  form.elements.status.value        = sub.status;
  form.elements.currency.value      = sub.currency       || 'JPY';
  form.elements.note.value         = sub.note || '';
  updateCostFields(sub.contractForm);
  document.getElementById('sub-form-title').textContent = '編集';
  document.getElementById('sub-modal-overlay').hidden = false;
}

async function confirmDeleteSub(id) {
  const sub = _subs.find(s => s.id === id);
  if (!sub || !confirm(`「${sub.name}」を削除しますか？`)) return;
  await deleteSub(id);
  refreshAll();
}

// ============================================================
// refreshAll
// ============================================================
function refreshAll() {
  updateSummary();
  renderSubs();
}

// ============================================================
// タブ切り替え
// ============================================================
function initTabs() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => { t.hidden = true; });
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
      document.getElementById('summary-bar').hidden = btn.dataset.tab !== 'subscriptions';
    });
  });
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();

  document.getElementById('btn-add-sub').addEventListener('click', openAddSubForm);
  document.getElementById('btn-cancel-sub').addEventListener('click', () => {
    document.getElementById('sub-modal-overlay').hidden = true;
  });
  document.getElementById('sub-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  document.querySelector('select[name="contractForm"]').addEventListener('change', e => {
    updateCostFields(e.target.value);
  });

  document.querySelectorAll('.purpose-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.purpose-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _purposeFilter = btn.dataset.purpose;
      renderSubs();
    });
  });

  document.getElementById('sub-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const sub = {
      name:          f.elements.name.value.trim(),
      contractForm:  f.elements.contractForm.value,
      costPerMonth:  f.elements.costPerMonth.value  || null,
      costPerYear:   f.elements.costPerYear.value   || null,
      purpose:       f.elements.purpose.value       || null,
      startDate:     f.elements.startDate.value     || null,
      paymentMethod: f.elements.paymentMethod.value || null,
      payer:         f.elements.payer.value,
      autoRenew:     f.elements.autoRenew.checked,
      status:        f.elements.status.value,
      note:          f.elements.note.value.trim()   || null,
      currency:      f.elements.currency.value      || 'JPY',
    };
    const id = f.elements.id.value;
    if (id) await updateSub(id, sub); else await addSub(sub);
    document.getElementById('sub-modal-overlay').hidden = true;
    refreshAll();
  });

  await fetchUsdRate();
  await loadSubs();
  refreshAll();
});
