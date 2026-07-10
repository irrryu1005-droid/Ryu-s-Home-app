// ============================================================
// 【設定】ここに自分のSupabase情報を入力してください
// Supabase Dashboard → Settings → API で確認できます
// ============================================================
const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';
// ============================================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 定数
// ============================================================
let INCOME_CATEGORIES  = [];
let EXPENSE_CATEGORIES = [];

const DEFAULT_INCOME   = ['仕送り', 'バイト', 'Sports Betting'];
const DEFAULT_EXPENSE  = ['食費', '交通費', '衣類・アクセサリー', '娯楽費', '旅費', 'サブスクリプション', '美容', 'ガジェット', '必需品', '科目変換'];

async function loadCategories() {
  const { data, error } = await db.from('finance_categories').select('type,name').order('id');
  if (error || !data || data.length === 0) {
    INCOME_CATEGORIES  = [...DEFAULT_INCOME];
    EXPENSE_CATEGORIES = [...DEFAULT_EXPENSE];
    return;
  }
  INCOME_CATEGORIES  = [];
  EXPENSE_CATEGORIES = [];
  for (const row of data) {
    if (row.type === 'income')  INCOME_CATEGORIES.push(row.name);
    else                        EXPENSE_CATEGORIES.push(row.name);
  }
}

async function saveNewCategory(type, name) {
  const { error } = await db.from('finance_categories').insert({ type, name });
  if (error) return;
  if (type === 'income')  INCOME_CATEGORIES.push(name);
  else                    EXPENSE_CATEGORIES.push(name);
}

const PAYMENT_METHODS = [
  'deposit（銀行）', 'cash（現金）', 'PayPay',
  'Rakuten Pay', 'non-trade payables', 'credit trade payable',
];

async function buildLocationOptions() {
  const { data } = await db
    .from('location_options')
    .select('name')
    .order('sort_order')
    .order('id');

  const locs = (data || []).map(r => r.name);
  const sel = document.getElementById('input-location');
  sel.innerHTML = '<option value="">-- 未選択 --</option>'
    + locs.map(l => `<option value="${l}">${l}</option>`).join('')
    + '<option value="__new__">＋ 新しい場所を追加</option>';
}

async function saveCustomLocation(name) {
  await db.from('location_options').upsert({ name }, { onConflict: 'name', ignoreDuplicates: true });
}

// ============================================================
// 状態
// ============================================================
let currentType = 'expense';
let dashMonth   = new Date();
let listMonth   = new Date();
let chart       = null;
let _listSort   = { key: 'date', asc: false };
let _editType   = 'expense';
let _editingId  = null;
let _finPnlYear  = new Date().getFullYear();
let _finPnlMonth = new Date().getMonth() + 1;

// ============================================================
// ユーティリティ
// ============================================================
function yen(n) {
  return '¥' + Math.abs(n).toLocaleString('ja-JP');
}

function monthRange(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(y, m, 1).toISOString().split('T')[0];
  const end   = new Date(y, m + 1, 0).toISOString().split('T')[0];
  return { start, end };
}

function monthLabel(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function ymKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================
// 口座残高の自動更新（収入なら+、支出なら−）
// ============================================================
async function updateAccountBalance(accountName, type, amount) {
  const { data: account } = await db
    .from('accounts')
    .select('balance')
    .eq('account_name', accountName)
    .single();

  if (!account) return;

  const delta = type === 'income' ? amount : -amount;
  await db
    .from('accounts')
    .update({ balance: account.balance + delta })
    .eq('account_name', accountName);
}

// ============================================================
// ナビゲーション
// ============================================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    if (tab === 'data')     { renderFinancePnl(); }
    if (tab === 'list')     renderList();
    if (tab === 'accounts') renderAccounts();
    if (tab === 'planned')  renderPlannedTab();
    if (tab === 'wishlist') initWishList();
  });
});

// Data タブのサブナビ
document.querySelectorAll('.data-sub-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.data-sub-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.data-sub-content').forEach(c => { c.hidden = true; });
    btn.classList.add('active');
    const sub = btn.dataset.sub;
    document.getElementById(`data-sub-${sub}`).hidden = false;
    if (sub === 'dashboard') renderDashboard();
    if (sub === 'pnl')       renderFinancePnl();
  });
});

// ============================================================
// 入力フォーム
// ============================================================
function buildOptions(selectEl, items) {
  selectEl.innerHTML = items.map(v => `<option value="${v}">${v}</option>`).join('');
}

function updateCategoryOptions() {
  const cats = currentType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  buildOptions(document.getElementById('input-category'), cats);
}

// 支払科目は固定
buildOptions(document.getElementById('input-payment'), PAYMENT_METHODS);

// 場所の選択肢を初期化
buildLocationOptions();

// 場所「＋ 新しい場所を追加」選択時
document.getElementById('input-location').addEventListener('change', function () {
  const newInput = document.getElementById('input-location-new');
  if (this.value === '__new__') {
    newInput.style.display = 'block';
    newInput.focus();
  } else {
    newInput.style.display = 'none';
    newInput.value = '';
  }
});

// 今日の日付をデフォルトに
document.getElementById('input-date').value = new Date().toISOString().split('T')[0];

// カテゴリ初期化（Supabase から追加分を読み込んでから表示）
loadCategories().then(() => updateCategoryOptions());

// カテゴリ管理ボタン
document.getElementById('btn-manage-categories').addEventListener('click', () => {
  const wrap = document.getElementById('new-category-wrap');
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) document.getElementById('input-new-category').focus();
});

document.getElementById('btn-save-new-category').addEventListener('click', async () => {
  const name = document.getElementById('input-new-category').value.trim();
  if (!name) return;
  await saveNewCategory(currentType, name);
  document.getElementById('input-new-category').value = '';
  document.getElementById('new-category-wrap').style.display = 'none';
  updateCategoryOptions();
  document.getElementById('input-category').value = name;
});

// 収入/支出トグル
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentType = btn.dataset.type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateCategoryOptions();

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.style.background = currentType === 'income'
      ? 'var(--income)'
      : 'var(--expense)';
  });
});

// フォーム送信
document.getElementById('transaction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl    = document.getElementById('form-message');
  const submitBtn = document.getElementById('submit-btn');

  submitBtn.disabled    = true;
  submitBtn.textContent = '登録中...';
  msgEl.style.color     = '';
  msgEl.textContent     = '';

  const locationSel = document.getElementById('input-location').value;
  const locationNew = document.getElementById('input-location-new').value.trim();
  let location = '';
  if (locationSel === '__new__') {
    location = locationNew;
    if (location) await saveCustomLocation(location);
  } else {
    location = locationSel;
  }

  const payload = {
    date:           document.getElementById('input-date').value,
    type:           currentType,
    amount:         parseInt(document.getElementById('input-amount').value, 10),
    category:       document.getElementById('input-category').value,
    payment_method: document.getElementById('input-payment').value,
    memo:           document.getElementById('input-memo').value.trim(),
    location:       location || null,
  };

  const { error } = await db.from('transactions').insert([payload]);

  if (error) {
    msgEl.style.color = 'var(--profit-neg)';
    msgEl.textContent = 'エラー: ' + error.message;
  } else {
    // 口座残高を自動更新（収入なら+、支出なら−）
    await updateAccountBalance(payload.payment_method, payload.type, payload.amount);

    msgEl.style.color = 'var(--profit-pos)';
    msgEl.textContent = '✓ 登録しました';
    document.getElementById('input-amount').value = '';
    document.getElementById('input-memo').value   = '';
    document.getElementById('input-location-new').value   = '';
    document.getElementById('input-location-new').style.display = 'none';
    await buildLocationOptions();
    setTimeout(() => { msgEl.textContent = ''; }, 2500);
  }

  submitBtn.disabled    = false;
  submitBtn.textContent = '登録する';
});

// ============================================================
// ダッシュボード
// ============================================================
document.getElementById('dash-prev').addEventListener('click', () => {
  dashMonth = new Date(dashMonth.getFullYear(), dashMonth.getMonth() - 1, 1);
  renderDashboard();
});
document.getElementById('dash-next').addEventListener('click', () => {
  dashMonth = new Date(dashMonth.getFullYear(), dashMonth.getMonth() + 1, 1);
  renderDashboard();
});

async function renderDashboard() {
  document.getElementById('dash-month-label').textContent = monthLabel(dashMonth);

  const { start, end } = monthRange(dashMonth);

  const { data: txns } = await db
    .from('transactions')
    .select('*')
    .gte('date', start)
    .lte('date', end);

  const rows = txns || [];

  // 収入・支出・損益
  const income  = rows.filter(t => t.type === 'income' ).reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const profit  = income - expense;

  document.getElementById('dash-income').textContent  = yen(income);
  document.getElementById('dash-expense').textContent = yen(expense);

  const profitEl = document.getElementById('dash-profit');
  profitEl.textContent = (profit >= 0 ? '+' : '−') + yen(profit);
  profitEl.className   = 'card-value' + (profit < 0 ? ' negative' : '');

  // カテゴリ別
  const totals = {};
  rows.filter(t => t.type === 'expense').forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const tbody = document.getElementById('category-tbody');
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  tbody.innerHTML = entries.length
    ? entries.map(([cat, amt]) =>
        `<tr><td>${cat}</td><td>${yen(amt)}</td></tr>`
      ).join('')
    : '<tr><td colspan="2" class="empty-msg">支出データなし</td></tr>';

  // 月別グラフ（直近6ヶ月）
  await renderChart();
}

async function renderChart() {
  // 6ヶ月分まとめて取得
  const sixAgo = new Date(dashMonth.getFullYear(), dashMonth.getMonth() - 5, 1);
  const { start } = { start: sixAgo.toISOString().split('T')[0] };
  const { end }   = monthRange(dashMonth);

  const { data: all } = await db
    .from('transactions')
    .select('date, type, amount')
    .gte('date', start)
    .lte('date', end);

  const labels      = [];
  const incomeData  = [];
  const expenseData = [];

  for (let i = 5; i >= 0; i--) {
    const d   = new Date(dashMonth.getFullYear(), dashMonth.getMonth() - i, 1);
    const key = ymKey(d);
    labels.push(`${d.getMonth() + 1}月`);

    const monthRows = (all || []).filter(t => t.date.startsWith(key));
    incomeData.push( monthRows.filter(t => t.type === 'income' ).reduce((s, t) => s + t.amount, 0));
    expenseData.push(monthRows.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  }

  if (chart) chart.destroy();

  chart = new Chart(document.getElementById('monthly-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '収入',
          data: incomeData,
          backgroundColor: 'rgba(245, 166, 35, 0.75)',
          borderRadius: 6,
        },
        {
          label: '支出',
          data: expenseData,
          backgroundColor: 'rgba(74, 144, 217, 0.75)',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => '¥' + v.toLocaleString() },
        },
      },
    },
  });
}

// ============================================================
// 一覧
// ============================================================
document.getElementById('btn-add-txn').addEventListener('click', () => openNewTxnModal('expense'));

document.getElementById('list-prev').addEventListener('click', () => {
  listMonth = new Date(listMonth.getFullYear(), listMonth.getMonth() - 1, 1);
  renderList();
});
document.getElementById('list-next').addEventListener('click', () => {
  listMonth = new Date(listMonth.getFullYear(), listMonth.getMonth() + 1, 1);
  renderList();
});

async function renderList() {
  document.getElementById('list-month-label').textContent = monthLabel(listMonth);

  const { start, end } = monthRange(listMonth);

  const { data: txns } = await db
    .from('transactions')
    .select('*')
    .gte('date', start)
    .lte('date', end);

  const container = document.getElementById('transaction-list');

  const sortFn = (a, b) => {
    const va = _listSort.key === 'date' ? a.date : a.amount;
    const vb = _listSort.key === 'date' ? b.date : b.amount;
    if (va < vb) return _listSort.asc ? -1 : 1;
    if (va > vb) return _listSort.asc ? 1 : -1;
    return 0;
  };

  const income  = (txns || []).filter(t => t.type === 'income').sort(sortFn);
  const expense = (txns || []).filter(t => t.type === 'expense').sort(sortFn);

  const buildItems = list => list.length === 0
    ? '<div class="txn-empty">なし</div>'
    : list.map(t => {
        const memo     = t.memo     ? ` · ${t.memo}`     : '';
        const location = t.location ? ` · 📍${t.location}` : '';
        return `
          <div class="txn-item">
            <div class="txn-info">
              <div class="txn-category">${t.category}</div>
              <div class="txn-meta">${t.date}${location}${memo}</div>
            </div>
            <div class="txn-amount ${t.type}">${yen(t.amount)}</div>
            <button class="txn-edit"   data-id="${t.id}" title="編集">✎</button>
            <button class="txn-delete" data-id="${t.id}" title="削除">×</button>
          </div>`;
      }).join('');

  const incomeTotal  = income.reduce((s, t) => s + t.amount, 0);
  const expenseTotal = expense.reduce((s, t) => s + t.amount, 0);

  container.innerHTML = `
    <div class="list-columns">
      <div class="list-col list-col-income">
        <div class="list-col-header">
          <span class="list-col-label">収入</span>
          <span class="list-col-total">${yen(incomeTotal)}</span>
        </div>
        ${buildItems(income)}
      </div>
      <div class="list-col list-col-expense">
        <div class="list-col-header">
          <span class="list-col-label">支出</span>
          <span class="list-col-total">${yen(expenseTotal)}</span>
        </div>
        ${buildItems(expense)}
      </div>
    </div>`;

  container.querySelectorAll('.txn-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { data: txn } = await db.from('transactions').select('*').eq('id', btn.dataset.id).single();
      if (txn) openEditModal(txn);
    });
  });

  container.querySelectorAll('.txn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('この記録を削除しますか？')) return;

      const { data: txn } = await db
        .from('transactions')
        .select('type, amount, payment_method')
        .eq('id', btn.dataset.id)
        .single();

      const { error } = await db
        .from('transactions')
        .delete()
        .eq('id', btn.dataset.id);

      if (!error) {
        if (txn) {
          const reverseType = txn.type === 'income' ? 'expense' : 'income';
          await updateAccountBalance(txn.payment_method, reverseType, txn.amount);
        }
        renderList();
      }
    });
  });
}

// ============================================================
// 一覧ソート
// ============================================================
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _listSort = { key: btn.dataset.key, asc: btn.dataset.asc === 'true' };
    renderList();
  });
});

// ============================================================
// 編集モーダル
// ============================================================
function updateEditCategoryOptions() {
  const cats = _editType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  buildOptions(document.querySelector('#edit-form [name="category"]'), cats);
}

async function openNewTxnModal(defaultType = 'expense') {
  _editingId = null;
  _editType  = defaultType;

  const f = document.getElementById('edit-form');
  document.querySelectorAll('.edit-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === defaultType);
  });

  const today = new Date().toLocaleDateString('sv-SE');
  f.elements.id.value     = '';
  f.elements.date.value   = today;
  f.elements.amount.value = '';
  f.elements.memo.value   = '';

  buildOptions(f.elements.payment_method, PAYMENT_METHODS);
  f.elements.payment_method.value = PAYMENT_METHODS[0];

  updateEditCategoryOptions();
  f.elements.category.value = '';

  const { data: locs } = await db.from('location_options').select('name').order('sort_order').order('id');
  const locSel = f.elements.location;
  locSel.innerHTML = '<option value="">-- 未選択 --</option>'
    + (locs || []).map(l => `<option value="${l.name}">${l.name}</option>`).join('');
  locSel.value = '';

  const saveBtn = document.getElementById('btn-edit-save');
  saveBtn.style.background = defaultType === 'income' ? 'var(--income)' : 'var(--expense)';

  document.getElementById('edit-modal-overlay').style.display = 'flex';
}

async function openEditModal(txn) {
  _editingId = txn.id;
  _editType  = txn.type;

  const f = document.getElementById('edit-form');

  document.querySelectorAll('.edit-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === txn.type);
  });

  f.elements.date.value   = txn.date;
  f.elements.amount.value = txn.amount;
  f.elements.memo.value   = txn.memo || '';
  f.elements.id.value     = txn.id;

  buildOptions(f.elements.payment_method, PAYMENT_METHODS);
  f.elements.payment_method.value = txn.payment_method;

  updateEditCategoryOptions();
  f.elements.category.value = txn.category;

  const { data: locs } = await db.from('location_options').select('name').order('sort_order').order('id');
  const locSel = f.elements.location;
  locSel.innerHTML = '<option value="">-- 未選択 --</option>'
    + (locs || []).map(l => `<option value="${l.name}">${l.name}</option>`).join('');
  locSel.value = txn.location || '';

  const saveBtn = document.getElementById('btn-edit-save');
  saveBtn.style.background = _editType === 'income' ? 'var(--income)' : 'var(--expense)';

  document.getElementById('edit-modal-overlay').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').style.display = 'none';
  _editingId = null;
}

document.querySelectorAll('.edit-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _editType = btn.dataset.type;
    document.querySelectorAll('.edit-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateEditCategoryOptions();
    document.getElementById('btn-edit-save').style.background =
      _editType === 'income' ? 'var(--income)' : 'var(--expense)';
  });
});

document.getElementById('btn-edit-cancel').addEventListener('click', closeEditModal);

document.getElementById('edit-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEditModal();
});

document.getElementById('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const id = f.elements.id.value;

  const newPayload = {
    date:           f.elements.date.value,
    type:           _editType,
    amount:         parseInt(f.elements.amount.value, 10),
    category:       f.elements.category.value,
    payment_method: f.elements.payment_method.value,
    memo:           f.elements.memo.value.trim(),
    location:       f.elements.location.value || null,
  };

  if (id) {
    const { data: oldTxn } = await db
      .from('transactions')
      .select('type, amount, payment_method')
      .eq('id', id)
      .single();
    const { error } = await db.from('transactions').update(newPayload).eq('id', id);
    if (!error && oldTxn) {
      const reverseOld = oldTxn.type === 'income' ? 'expense' : 'income';
      await updateAccountBalance(oldTxn.payment_method, reverseOld, oldTxn.amount);
      await updateAccountBalance(newPayload.payment_method, newPayload.type, newPayload.amount);
    }
  } else {
    const { error } = await db.from('transactions').insert([newPayload]);
    if (!error) await updateAccountBalance(newPayload.payment_method, newPayload.type, newPayload.amount);
  }

  closeEditModal();
  renderList();
});

// ============================================================
// 損益計算書
// ============================================================
document.getElementById('fin-pnl-prev').addEventListener('click', () => {
  _finPnlMonth--;
  if (_finPnlMonth < 1) { _finPnlMonth = 12; _finPnlYear--; }
  renderFinancePnl();
});
document.getElementById('fin-pnl-next').addEventListener('click', () => {
  _finPnlMonth++;
  if (_finPnlMonth > 12) { _finPnlMonth = 1; _finPnlYear++; }
  renderFinancePnl();
});

async function renderFinancePnl() {
  const y = _finPnlYear, m = _finPnlMonth;
  document.getElementById('fin-pnl-month-label').textContent = `${y}年${m}月`;

  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end   = `${y}-${String(m).padStart(2, '0')}-31`;

  const { data: txns } = await db
    .from('transactions')
    .select('type, amount, category, payment_method')
    .gte('date', start)
    .lte('date', end);

  const expenses = {};
  const revenues = {};

  for (const t of (txns || [])) {
    const cat     = t.category       || 'その他';
    const payment = t.payment_method || '未設定';
    if (t.type === 'expense') {
      if (!expenses[cat]) expenses[cat] = {};
      expenses[cat][payment] = (expenses[cat][payment] || 0) + t.amount;
    } else {
      if (!revenues[cat]) revenues[cat] = {};
      revenues[cat][payment] = (revenues[cat][payment] || 0) + t.amount;
    }
  }

  const sum      = obj => Object.values(obj).flatMap(Object.values).reduce((a, b) => a + b, 0);
  const expTotal = sum(expenses);
  const revTotal = sum(revenues);
  const profit   = revTotal - expTotal;

  const buildSection = (type, label, data, total) => {
    if (total === 0) return '';
    let rows = '';
    for (const [cat, payments] of Object.entries(data)) {
      const catTotal = Object.values(payments).reduce((a, b) => a + b, 0);
      const catPct   = Math.round(catTotal / total * 100);
      rows += `
        <div class="pnl-row sport">
          <div class="pnl-row-label">${cat}</div>
          <div class="pnl-bar-wrap"><div class="pnl-bar" style="width:${catPct}%"></div></div>
          <div class="pnl-row-amount">¥${catTotal.toLocaleString()}</div>
        </div>`;
      const entries = Object.entries(payments);
      if (entries.length > 1) {
        for (const [payment, amt] of entries) {
          const pct = Math.round(amt / total * 100);
          rows += `
            <div class="pnl-row league">
              <div class="pnl-row-label">${payment}</div>
              <div class="pnl-bar-wrap"><div class="pnl-bar" style="width:${pct}%"></div></div>
              <div class="pnl-row-amount">¥${amt.toLocaleString()}</div>
            </div>`;
        }
      }
    }
    return `
      <div class="pnl-section ${type}">
        <div class="pnl-sec-header">
          <span>${label}</span>
          <span class="pnl-sec-total">¥${total.toLocaleString()}</span>
        </div>
        ${rows}
      </div>`;
  };

  const profitType  = profit >= 0 ? 'profit' : 'netloss';
  const profitLabel = profit >= 0 ? '利益' : '損失';
  const profitSign  = profit >= 0 ? '+' : '';
  const resultBlock = `
    <div class="pnl-section ${profitType}">
      <div class="pnl-sec-header"><span>${profitLabel}</span></div>
      <div class="pnl-profit-body ${profit >= 0 ? 'is-profit' : 'is-loss'}">${profitSign}¥${Math.abs(profit).toLocaleString()}</div>
    </div>`;

  const expBlock = buildSection('expense', '費用', expenses, expTotal);
  const revBlock = buildSection('revenue', '収益', revenues, revTotal);

  if (!expBlock && !revBlock) {
    document.getElementById('fin-pnl-container').innerHTML =
      '<div class="empty-msg">この月のデータはありません</div>';
    return;
  }

  const leftCol  = profit >= 0 ? `${expBlock}${resultBlock}` : `${expBlock}`;
  const rightCol = profit >= 0 ? `${revBlock}` : `${revBlock}${resultBlock}`;

  document.getElementById('fin-pnl-container').innerHTML = `
    <div class="pnl-heading">損益計算書</div>
    <div class="pnl-columns">
      <div class="pnl-col">${leftCol}</div>
      <div class="pnl-col">${rightCol}</div>
    </div>`;
}

// ============================================================
// 口座残高
// ============================================================
async function renderAccounts() {
  const { data: accounts } = await db
    .from('accounts')
    .select('*')
    .order('sort_order');

  const container = document.getElementById('accounts-list');

  if (!accounts || accounts.length === 0) {
    container.innerHTML = '<div class="empty-msg">口座データがありません</div>';
    return;
  }

  container.innerHTML = accounts.map(a => {
    const cls = a.balance > 0 ? 'positive' : a.balance < 0 ? 'negative' : 'zero';
    return `
      <div class="account-item" data-name="${a.account_name}">
        <div class="account-name">${a.account_name}</div>
        <div class="account-balance ${cls}" data-value="${a.balance}">
          ${yen(a.balance)}
        </div>
      </div>
    `;
  }).join('');

  // 残高タップで編集
  container.querySelectorAll('.account-balance').forEach(el => {
    el.addEventListener('click', () => startEditBalance(el));
  });
}

function startEditBalance(el) {
  if (el.querySelector('input')) return; // 編集中なら無視

  const current = el.dataset.value;
  const accountName = el.closest('.account-item').dataset.name;

  el.innerHTML = `
    <input class="account-edit-input" type="number" value="${current}" autofocus>
  `;

  const input = el.querySelector('input');

  async function saveBalance() {
    const newVal = parseInt(input.value, 10);
    if (isNaN(newVal)) { renderAccounts(); return; }

    await db
      .from('accounts')
      .update({ balance: newVal })
      .eq('account_name', accountName);

    renderAccounts();
  }

  input.addEventListener('blur',  saveBalance);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { input.blur(); }
    if (e.key === 'Escape') { renderAccounts(); }
  });
}

// ============================================================
// 予定支出タブ
// ============================================================
let _plannedMonth = new Date();
_plannedMonth.setDate(1);

const PLANNED_CATEGORY_LABEL = {
  transport: '🚃 交通',
  loan:      '💴 ローン・返済',
  utility:   '💡 光熱費・通信',
  other:     '📦 その他',
  subscription: '💳 サブスク',
};

function plannedMonthLabel(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// その月に発生するか判定
function isActiveInMonth(item, year, month) {
  const start = item.startDate ? new Date(item.startDate) : null;
  const end   = item.endDate   ? new Date(item.endDate)   : null;
  const mStart = new Date(year, month, 1);
  const mEnd   = new Date(year, month + 1, 0);
  if (start && start > mEnd)   return false;
  if (end   && end   < mStart) return false;
  if (item.frequency === 'monthly')   return true;
  if (item.frequency === 'once')      return start && start >= mStart && start <= mEnd;
  if (item.frequency === 'quarterly') {
    if (!start) return false;
    const diff = (year - start.getFullYear()) * 12 + (month - start.getMonth());
    return diff >= 0 && diff % 3 === 0;
  }
  if (item.frequency === 'yearly') {
    const billingM = item.billingMonth != null ? item.billingMonth : (start ? start.getMonth() : 0);
    return month === billingM;
  }
  return false;
}

async function renderPlannedTab() {
  const year  = _plannedMonth.getFullYear();
  const month = _plannedMonth.getMonth();
  document.getElementById('planned-month-label').textContent = plannedMonthLabel(_plannedMonth);

  // サブスク（Life）+ 予定支出 + ローン + 日付オーバーライド を並行取得
  const yearMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const [subRes, planRes, loanRes, overrideRes] = await Promise.all([
    db.from('subscriptions').select('*').eq('status', 'active'),
    db.from('planned_expenses').select('*').order('billing_day'),
    db.from('loans').select('*'),
    db.from('subscription_billing_overrides').select('*').eq('year_month', yearMonthStr),
  ]);
  const overrideMap = {};
  for (const ov of (overrideRes.data || [])) overrideMap[ov.subscription_id] = ov;

  const usdRate = 150; // 簡易レート（Life と共有不可なため固定）

  // 編集モーダルが使えるよう _subsF / _loans を補完
  if (_subsF.length === 0 && subRes.data?.length) _subsF = subRes.data.map(normalizeSubF);
  if (_loans.length === 0 && loanRes.data?.length) _loans = loanRes.data.map(normalizeLoan);

  // サブスクを統一フォーマットに変換
  const subItems = (subRes.data || []).map(r => ({
    id:          r.id,
    source:      'subscription',
    name:        r.name,
    amount:      r.contract_form === 'year'
                   ? Math.round(r.currency === 'USD' ? (r.cost_per_year||0)*usdRate : (r.cost_per_year||0))
                   : (r.currency === 'USD' ? Math.round((r.cost_per_month||0)*usdRate) : (r.cost_per_month||0)),
    category:    'subscription',
    frequency:   r.contract_form === 'year' ? 'yearly' : 'monthly',
    billingDay:   overrideMap[r.id]?.billing_day ?? (() => { const d = r.start_date ? new Date(r.start_date) : null; return r.billing_day || (d ? d.getDate() : null); })(),
    billingDayOverridden: !!overrideMap[r.id],
    billingMonth: r.start_date ? new Date(r.start_date).getMonth() : null,
    startDate:   r.start_date  || null,
    endDate:     null,
    note:        r.note        || null,
    paymentMethod: r.payment_method || '',
  }));

  // planned_expenses を統一フォーマットに変換
  const planItems = (planRes.data || []).map(r => ({
    id:          r.id,
    source:      'planned',
    name:        r.name,
    amount:      r.amount,
    category:    r.category || 'other',
    frequency:   r.frequency || 'monthly',
    billingDay:  r.billing_day   || null,
    billingMonth: null,
    startDate:   r.start_date   || null,
    endDate:     r.end_date     || null,
    note:        r.note         || null,
    paymentMethod: '',
  }));

  // ローンを統一フォーマットに変換
  const loanItems = (loanRes.data || []).map(r => ({
    id:          r.id,
    source:      'loan',
    name:        r.name,
    amount:      r.min_monthly_payment || r.monthly_payment,
    amountMax:   r.min_monthly_payment ? r.monthly_payment : null,
    category:    'loan',
    frequency:   'monthly',
    billingDay:  r.start_date ? new Date(r.start_date).getDate() : null,
    billingMonth: null,
    startDate:   r.start_date || null,
    endDate:     r.end_date   || null,
    note:        r.note       || null,
    paymentMethod: '',
  }));

  const all = [...subItems, ...planItems, ...loanItems].filter(it => isActiveInMonth(it, year, month));
  all.sort((a, b) => (a.billingDay || 99) - (b.billingDay || 99));

  const totalMin = all.reduce((s, it) => s + it.amount, 0);
  const totalMax = all.reduce((s, it) => s + (it.amountMax || it.amount), 0);
  document.getElementById('planned-total').textContent = totalMin !== totalMax
    ? `¥${totalMin.toLocaleString()}〜¥${totalMax.toLocaleString()}`
    : `¥${totalMin.toLocaleString()}`;

  // カテゴリ別グループ
  const groups = {};
  for (const it of all) {
    if (!groups[it.category]) groups[it.category] = [];
    groups[it.category].push(it);
  }

  const list = document.getElementById('planned-list');
  if (all.length === 0) {
    list.innerHTML = '<p class="empty-msg">この月の予定支出はありません</p>';
    return;
  }

  list.innerHTML = Object.entries(groups).map(([cat, items]) => {
    const rows = items.map(it => {
      const dayLabel = it.billingDay ? it.billingDay + '日' : '-';
      const overrideMark = it.billingDayOverridden ? ' <span class="badge-day-override">今月変更</span>' : '';
      const typeBadge = it.source === 'subscription'
        ? `<span class="badge-sub">サブスク</span><span class="badge-freq">${it.frequency === 'yearly' ? '年' : '月'}</span>`
        : it.source === 'loan'
        ? `<span class="badge-sub" style="background:#e8f4e8;color:#27ae60">ローン</span>`
        : '';
      const dayOverrideBtn = it.source === 'subscription'
        ? `<button class="planned-day-override-btn" data-id="${it.id}" data-current="${it.billingDay || ''}" data-overridden="${it.billingDayOverridden}" title="今月の支払日を変更">📅</button>`
        : '';
      return `
        <div class="planned-item">
          <div class="planned-item-left">
            <span class="planned-day">${dayLabel}${overrideMark}</span>
            ${dayOverrideBtn}
            <div>
              <div class="planned-name">${escapeHtmlF(it.name)} ${typeBadge}</div>
              ${it.note ? `<div class="planned-note">${escapeHtmlF(it.note)}</div>` : ''}
            </div>
          </div>
          <div class="planned-item-right">
            <span class="planned-amount">${it.amountMax
              ? `¥${it.amount.toLocaleString()}〜¥${it.amountMax.toLocaleString()}`
              : `¥${it.amount.toLocaleString()}`}</span>
            <button class="planned-register-btn" data-id="${it.id}" data-source="${it.source}" data-name="${escapeHtmlF(it.name)}" data-amount="${it.amount}" data-category="${it.category}" data-day="${it.billingDay || ''}" data-payment="${escapeHtmlF(it.paymentMethod)}" title="支出として登録">✓</button>
            <button class="planned-edit-btn" data-id="${it.id}" data-source="${it.source}">編集</button>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="planned-group">
        <div class="planned-group-title">${PLANNED_CATEGORY_LABEL[cat] || cat}</div>
        <div class="planned-items-wrap">${rows}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.planned-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { id, source } = btn.dataset;
      if (source === 'subscription') openEditSubF(id);
      else if (source === 'loan')   openEditLoan(id);
      else                          openPlannedEditForm(id, planRes.data);
    });
  });

  list.querySelectorAll('.planned-day-override-btn').forEach(btn => {
    btn.addEventListener('click', () => openDayOverrideModal(btn.dataset.id, btn.dataset.current, btn.dataset.overridden === 'true', yearMonthStr));
  });

  list.querySelectorAll('.planned-register-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { name, amount, category, day, payment } = btn.dataset;
      const billingDate = day
        ? `${yearMonthStr}-${String(day).padStart(2, '0')}`
        : new Date().toLocaleDateString('sv-SE');
      openPlannedRegisterModal({ name, amount: parseInt(amount), category, date: billingDate, paymentMethod: payment });
    });
  });
}

function openDayOverrideModal(subId, currentDay, isOverridden, yearMonth) {
  const modal = document.getElementById('day-override-modal');
  const input = document.getElementById('day-override-input');
  const label = document.getElementById('day-override-label');
  const clearBtn = document.getElementById('btn-day-override-clear');
  label.textContent = `今月（${yearMonth}）の支払日`;
  input.value = currentDay || '';
  clearBtn.hidden = !isOverridden;
  modal.hidden = false;

  const saveBtn = document.getElementById('btn-day-override-save');
  const cancelBtn = document.getElementById('btn-day-override-cancel');

  const close = () => { modal.hidden = true; };

  const onSave = async () => {
    const day = parseInt(input.value);
    if (!day || day < 1 || day > 31) { alert('1〜31の日付を入力してください'); return; }
    await db.from('subscription_billing_overrides')
      .upsert({ subscription_id: subId, year_month: yearMonth, billing_day: day }, { onConflict: 'subscription_id,year_month' });
    close();
    renderPlannedTab();
  };

  const onClear = async () => {
    await db.from('subscription_billing_overrides')
      .delete().eq('subscription_id', subId).eq('year_month', yearMonth);
    close();
    renderPlannedTab();
  };

  saveBtn.onclick = onSave;
  cancelBtn.onclick = close;
  clearBtn.onclick = onClear;
  modal.onclick = (e) => { if (e.target === modal) close(); };
}

function openPlannedRegisterModal({ name, amount, category, date, paymentMethod }) {
  const modal = document.getElementById('planned-register-modal');
  const form  = document.getElementById('planned-register-form');
  form.elements.prName.value    = name;
  form.elements.prAmount.value  = amount;
  form.elements.prDate.value    = date;
  form.elements.prPayment.value = paymentMethod || PAYMENT_METHODS[0];
  form.elements.prMemo.value    = name;
  modal.hidden = false;

  const close = () => { modal.hidden = true; };
  document.getElementById('btn-pr-cancel').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('btn-pr-save');
    saveBtn.disabled = true;
    const payload = {
      date:           form.elements.prDate.value,
      type:           'expense',
      amount:         parseInt(form.elements.prAmount.value),
      category:       category,
      payment_method: form.elements.prPayment.value,
      memo:           form.elements.prMemo.value.trim(),
      location:       null,
    };
    const { error } = await db.from('transactions').insert([payload]);
    if (error) { alert('登録エラー: ' + error.message); saveBtn.disabled = false; return; }
    await updateAccountBalance(payload.payment_method, 'expense', payload.amount);
    close();
    saveBtn.disabled = false;
    const flash = document.getElementById('pr-flash');
    flash.textContent = `✓ ${name} を登録しました`;
    flash.hidden = false;
    setTimeout(() => { flash.hidden = true; }, 3000);
  };
}

function escapeHtmlF(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openPlannedEditForm(id, rows) {
  const r = rows.find(x => x.id === id);
  if (!r) return;
  const f = document.getElementById('planned-form');
  f.elements.id.value         = r.id;
  f.elements.name.value       = r.name;
  f.elements.amount.value     = r.amount;
  f.elements.category.value   = r.category || 'other';
  f.elements.frequency.value  = r.frequency || 'monthly';
  f.elements.billingDay.value = r.billing_day || '';
  f.elements.startDate.value  = r.start_date || '';
  f.elements.endDate.value    = r.end_date   || '';
  f.elements.note.value       = r.note       || '';
  document.getElementById('planned-form-title').textContent = '予定支出を編集';
  document.getElementById('planned-modal').hidden = false;
}

function initPlannedTab() {
  document.getElementById('planned-prev').addEventListener('click', () => {
    _plannedMonth.setMonth(_plannedMonth.getMonth() - 1);
    renderPlannedTab();
  });
  document.getElementById('planned-next').addEventListener('click', () => {
    _plannedMonth.setMonth(_plannedMonth.getMonth() + 1);
    renderPlannedTab();
  });

  document.getElementById('btn-add-planned').addEventListener('click', () => {
    document.getElementById('planned-form').reset();
    document.getElementById('planned-form').elements.id.value = '';
    document.getElementById('planned-form-title').textContent = '予定支出を追加';
    document.getElementById('planned-modal').hidden = false;
  });

  document.getElementById('btn-cancel-planned').addEventListener('click', () => {
    document.getElementById('planned-modal').hidden = true;
  });

  document.getElementById('planned-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  document.getElementById('planned-frequency').addEventListener('change', e => {
    const showDay = ['monthly', 'quarterly'].includes(e.target.value);
    document.getElementById('planned-day-wrap').hidden = !showDay;
  });

  document.getElementById('planned-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const id = f.elements.id.value;
    const payload = {
      name:        f.elements.name.value.trim(),
      amount:      parseInt(f.elements.amount.value),
      category:    f.elements.category.value,
      frequency:   f.elements.frequency.value,
      billing_day: f.elements.billingDay.value ? parseInt(f.elements.billingDay.value) : null,
      start_date:  f.elements.startDate.value  || null,
      end_date:    f.elements.endDate.value     || null,
      note:        f.elements.note.value.trim() || null,
    };
    if (id) {
      await db.from('planned_expenses').update(payload).eq('id', id);
    } else {
      await db.from('planned_expenses').insert([payload]);
    }
    document.getElementById('planned-modal').hidden = true;
    renderPlannedTab();
  });
}

// ============================================================
// USD 為替レート（サブスク換算用）
// ============================================================
let _usdRateF = 150;

async function fetchUsdRateF() {
  try {
    const res  = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    const data = await res.json();
    _usdRateF  = data.usd.jpy;
  } catch {
    _usdRateF = 150;
  }
}

function toJpyF(amount, currency) {
  if (!amount) return 0;
  return currency === 'USD' ? Math.round(amount * _usdRateF) : Math.round(amount);
}

// ============================================================
// 予定支出サブタブ切り替え
// ============================================================
function initPlannedSubTabs() {
  document.querySelectorAll('.sub-nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sub-content').forEach(c => { c.hidden = true; });
      btn.classList.add('active');
      const sub = btn.dataset.sub;
      document.getElementById(`sub-${sub}`).hidden = false;
      if (sub === 'subscriptions') { await loadSubsF(); renderSubsF(); }
      if (sub === 'loans')         { await loadLoans(); renderLoans(); }
    });
  });
}

// ============================================================
// サブスク管理（Finance 内）
// ============================================================
let _subsF = [];

function normalizeSubF(row) {
  return {
    id:            row.id,
    name:          row.name,
    contractForm:  row.contract_form,
    costPerMonth:  row.cost_per_month,
    costPerYear:   row.cost_per_year,
    status:        row.status         || 'active',
    startDate:     row.start_date     || '',
    billingDay:    row.billing_day    ?? null,
    purpose:       row.purpose        || '',
    paymentMethod: row.payment_method || '',
    payer:         row.payer          || '自分',
    note:          row.note           || '',
    currency:      row.currency       || 'JPY',
  };
}

function subFToRow(sub) {
  return {
    name:           sub.name,
    contract_form:  sub.contractForm,
    cost_per_month: sub.costPerMonth ? parseInt(sub.costPerMonth) : null,
    cost_per_year:  sub.costPerYear  ? parseInt(sub.costPerYear)  : null,
    status:         sub.status,
    start_date:     sub.startDate     || null,
    billing_day:    sub.billingDay    ? parseInt(sub.billingDay)  : null,
    purpose:        sub.purpose       || null,
    payment_method: sub.paymentMethod || null,
    note:           sub.note          || null,
    currency:       sub.currency      || 'JPY',
  };
}

async function loadSubsF() {
  const { data } = await db.from('subscriptions').select('*').order('created_at');
  _subsF = (data || []).map(normalizeSubF);
}

function renderSubsF() {
  const summaryEl = document.getElementById('sub-summary-f');
  const listEl    = document.getElementById('sub-list-f');

  const active = _subsF.filter(s => s.status === 'active');
  const monthlyTotal = active.reduce((sum, s) => {
    return sum + (s.contractForm === 'month'
      ? (s.costPerMonth || 0)
      : Math.round((s.costPerYear || 0) / 12));
  }, 0);
  const yearlyTotal = active.reduce((sum, s) => {
    return sum + (s.contractForm === 'year'
      ? (s.costPerYear || 0)
      : (s.costPerMonth || 0) * 12);
  }, 0);

  summaryEl.innerHTML = `
    <div class="sub-summary-grid">
      <div class="sub-summary-item">
        <div class="sub-summary-label">月額換算</div>
        <div class="sub-summary-val">¥${monthlyTotal.toLocaleString()}</div>
      </div>
      <div class="sub-summary-item">
        <div class="sub-summary-label">年間合計</div>
        <div class="sub-summary-val">¥${yearlyTotal.toLocaleString()}</div>
      </div>
      <div class="sub-summary-item">
        <div class="sub-summary-label">契約数</div>
        <div class="sub-summary-val">${active.length}</div>
      </div>
    </div>`;

  if (_subsF.length === 0) {
    listEl.innerHTML = '<div class="empty-msg">サブスクがありません</div>';
    return;
  }

  const cancelled = _subsF.filter(s => s.status === 'cancelled');
  let html = '';
  if (active.length > 0)    html += renderSubGroupF(active, false);
  if (cancelled.length > 0) {
    html += '<div class="sub-group-sep-f">解約済み</div>';
    html += renderSubGroupF(cancelled, true);
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('.btn-sub-edit-f').forEach(btn => {
    btn.addEventListener('click', () => openEditSubF(btn.dataset.id));
  });
  listEl.querySelectorAll('.btn-sub-del-f').forEach(btn => {
    btn.addEventListener('click', () => deleteSubF(btn.dataset.id));
  });
}

function renderSubGroupF(subs, muted) {
  return subs.map(s => {
    const isUsd  = s.currency === 'USD';
    const amtKey = s.contractForm === 'month' ? s.costPerMonth : s.costPerYear;
    const unit   = s.contractForm === 'month' ? '/月' : '/年';
    const symbol = isUsd ? '$' : '¥';
    const amtFmt = isUsd
      ? (amtKey || 0).toFixed(2)
      : (amtKey || 0).toLocaleString();

    let jpyHint = '';
    if (isUsd && amtKey) {
      const monthly = s.contractForm === 'month'
        ? toJpyF(amtKey, 'USD')
        : Math.round(toJpyF(amtKey, 'USD') / 12);
      jpyHint = `<span class="sub-jpy-hint-f">≈¥${monthly.toLocaleString()}/月</span>`;
    } else if (!isUsd && s.contractForm === 'year' && amtKey) {
      jpyHint = `<span class="sub-jpy-hint-f">≈¥${Math.round(amtKey / 12).toLocaleString()}/月</span>`;
    }

    const payerBadge   = s.payer === '家族' ? '<span class="badge-payer-f">家族</span>' : '';
    const purposeBadge = s.purpose ? `<span class="badge-purpose-f">${escapeHtmlF(s.purpose)}</span>` : '';
    const formBadge    = `<span class="badge-contract-f">${s.contractForm === 'month' ? '月' : '年'}</span>`;

    return `
      <div class="sub-row-f${muted ? ' sub-muted-f' : ''}">
        <div class="sub-row-f-left">
          <span class="sub-name-f">${escapeHtmlF(s.name)}</span>
          ${s.note ? `<span class="sub-row-f-note">${escapeHtmlF(s.note)}</span>` : ''}
        </div>
        <div class="sub-row-f-center">
          <span class="sub-badges-f">${payerBadge}${purposeBadge}${formBadge}</span>
          ${s.paymentMethod ? `<span class="sub-row-f-meta">${escapeHtmlF(s.paymentMethod)}</span>` : ''}
        </div>
        <div class="sub-row-f-right">
          <span class="sub-cost-f">${symbol}${amtFmt}<span class="sub-unit-f">${unit}</span>${jpyHint}</span>
          <div class="sub-actions-f">
            <button class="planned-edit-btn btn-sub-edit-f" data-id="${s.id}">編集</button>
            <button class="planned-edit-btn btn-sub-del-f"  data-id="${s.id}">削除</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateSubCostFieldsF(contractForm) {
  document.getElementById('sub-cost-month-f').hidden = contractForm === 'year';
  document.getElementById('sub-cost-year-f').hidden  = contractForm === 'month';
}

function openAddSubF() {
  const form = document.getElementById('sub-form-f');
  form.reset();
  form.elements.id.value = '';
  document.getElementById('sub-form-title-f').textContent = 'サブスクを追加';
  updateSubCostFieldsF('month');
  document.getElementById('sub-modal-f').hidden = false;
}

function openEditSubF(id) {
  const s = _subsF.find(x => x.id === id);
  if (!s) return;
  const form = document.getElementById('sub-form-f');
  form.elements.id.value            = s.id;
  form.elements.name.value          = s.name;
  form.elements.contractForm.value  = s.contractForm;
  form.elements.currency.value      = s.currency;
  form.elements.costPerMonth.value  = s.costPerMonth || '';
  form.elements.costPerYear.value   = s.costPerYear  || '';
  form.elements.purpose.value       = s.purpose;
  form.elements.startDate.value     = s.startDate;
  form.elements.billingDay.value    = s.billingDay ?? '';
  form.elements.paymentMethod.value = s.paymentMethod;
  form.elements.status.value        = s.status;
  form.elements.note.value          = s.note;
  document.getElementById('sub-form-title-f').textContent = '編集';
  updateSubCostFieldsF(s.contractForm);
  document.getElementById('sub-modal-f').hidden = false;
}

async function deleteSubF(id) {
  const s = _subsF.find(x => x.id === id);
  if (!s || !await showConfirm(`「${s.name}」を削除しますか？`)) return;
  await db.from('subscriptions').delete().eq('id', id);
  _subsF = _subsF.filter(x => x.id !== id);
  renderSubsF();
}

function initSubsF() {
  document.getElementById('btn-add-sub-f').addEventListener('click', openAddSubF);

  document.getElementById('btn-cancel-sub-f').addEventListener('click', () => {
    document.getElementById('sub-modal-f').hidden = true;
  });
  document.getElementById('sub-modal-f').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });
  document.getElementById('sub-contract-f').addEventListener('change', e => {
    updateSubCostFieldsF(e.target.value);
  });

  document.getElementById('sub-form-f').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const id = f.elements.id.value;
    const sub = {
      name:          f.elements.name.value.trim(),
      contractForm:  f.elements.contractForm.value,
      currency:      f.elements.currency.value,
      costPerMonth:  f.elements.costPerMonth.value || null,
      costPerYear:   f.elements.costPerYear.value  || null,
      purpose:       f.elements.purpose.value      || null,
      startDate:     f.elements.startDate.value    || null,
      paymentMethod: f.elements.paymentMethod.value || null,
      status:        f.elements.status.value,
      note:          f.elements.note.value.trim()  || null,
    };
    if (id) {
      await db.from('subscriptions').update(subFToRow(sub)).eq('id', id);
    } else {
      await db.from('subscriptions').insert([subFToRow(sub)]);
    }
    document.getElementById('sub-modal-f').hidden = true;
    await loadSubsF();
    renderSubsF();
  });
}

// ============================================================
// ローン管理
// ============================================================
let _loans = [];

function normalizeLoan(row) {
  return {
    id:              row.id,
    name:            row.name,
    totalAmount:     row.total_amount,
    monthlyPayment:  row.monthly_payment,
    minPayment:      row.min_monthly_payment || null,
    remainingAmount: row.remaining_amount,
    startDate:       row.start_date || '',
    endDate:         row.end_date   || '',
    note:            row.note       || '',
  };
}

function loanToRow(loan) {
  return {
    name:             loan.name,
    total_amount:     parseInt(loan.totalAmount),
    monthly_payment:  parseInt(loan.monthlyPayment),
    min_monthly_payment: loan.minPayment ? parseInt(loan.minPayment) : null,
    remaining_amount: loan.remainingAmount ? parseInt(loan.remainingAmount) : null,
    start_date:       loan.startDate || null,
    end_date:         loan.endDate   || null,
    note:             loan.note      || null,
  };
}

async function loadLoans() {
  const { data } = await db.from('loans').select('*').order('created_at');
  _loans = (data || []).map(normalizeLoan);
}

function renderLoans() {
  const listEl = document.getElementById('loan-list');
  if (_loans.length === 0) {
    listEl.innerHTML = '<div class="empty-msg">ローンがありません。「＋ 追加」から登録してください。</div>';
    return;
  }
  listEl.innerHTML = _loans.map(l => {
    const progress = (l.remainingAmount != null && l.totalAmount)
      ? Math.round((1 - l.remainingAmount / l.totalAmount) * 100)
      : null;
    return `
      <div class="loan-item">
        <div class="loan-item-top">
          <span class="loan-name">${escapeHtmlF(l.name)}</span>
          <span class="loan-monthly">${l.minPayment
            ? `¥${l.minPayment.toLocaleString()}〜¥${(l.monthlyPayment||0).toLocaleString()}`
            : `¥${(l.monthlyPayment||0).toLocaleString()}`}<span class="loan-monthly-unit">/月</span></span>
        </div>
        <div class="loan-item-detail">
          ${l.remainingAmount != null
            ? `<span>残高 ¥${l.remainingAmount.toLocaleString()} / ¥${l.totalAmount.toLocaleString()}</span>`
            : `<span>借入総額 ¥${l.totalAmount.toLocaleString()}</span>`}
          ${l.endDate ? `<span>〜${l.endDate}</span>` : ''}
        </div>
        ${progress != null ? `
          <div class="loan-progress-wrap">
            <div class="loan-progress-bar" style="width:${progress}%"></div>
          </div>
          <div class="loan-progress-label">返済進捗 ${progress}%</div>` : ''}
        ${l.note ? `<div class="loan-note">${escapeHtmlF(l.note)}</div>` : ''}
        <div class="loan-actions">
          <button class="planned-edit-btn btn-loan-borrow" data-id="${l.id}">＋ 追加借入</button>
          <button class="planned-edit-btn btn-loan-edit"   data-id="${l.id}">編集</button>
          <button class="planned-edit-btn btn-loan-del"    data-id="${l.id}">削除</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.btn-loan-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditLoan(btn.dataset.id));
  });
  listEl.querySelectorAll('.btn-loan-del').forEach(btn => {
    btn.addEventListener('click', () => deleteLoan(btn.dataset.id));
  });
  listEl.querySelectorAll('.btn-loan-borrow').forEach(btn => {
    btn.addEventListener('click', () => openBorrowMore(btn.dataset.id, btn));
  });
}

function openBorrowMore(id, btn) {
  const wrap = document.createElement('div');
  wrap.className = 'borrow-inline';
  wrap.innerHTML = `
    <input type="number" class="borrow-input" placeholder="追加借入額（円）" min="1">
    <button class="borrow-confirm">追加</button>
    <button class="borrow-cancel-btn">×</button>
  `;
  btn.replaceWith(wrap);

  const input = wrap.querySelector('.borrow-input');
  input.focus();

  wrap.querySelector('.borrow-confirm').addEventListener('click', async () => {
    const amount = parseInt(input.value);
    if (!amount || amount <= 0) { input.focus(); return; }
    await addBorrowing(id, amount);
  });
  wrap.querySelector('.borrow-cancel-btn').addEventListener('click', renderLoans);
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const amount = parseInt(input.value);
      if (!amount || amount <= 0) return;
      await addBorrowing(id, amount);
    }
    if (e.key === 'Escape') renderLoans();
  });
}

async function addBorrowing(id, amount) {
  const l = _loans.find(x => x.id === id);
  if (!l) return;
  await db.from('loans').update({
    remaining_amount: (l.remainingAmount || 0) + amount,
    total_amount:     (l.totalAmount     || 0) + amount,
  }).eq('id', id);
  await loadLoans();
  renderLoans();
}

function openAddLoan() {
  const form = document.getElementById('loan-form');
  form.reset();
  form.elements.id.value = '';
  document.getElementById('loan-form-title').textContent = 'ローンを追加';
  document.getElementById('loan-modal').hidden = false;
}

function openEditLoan(id) {
  const l = _loans.find(x => x.id === id);
  if (!l) return;
  const form = document.getElementById('loan-form');
  form.elements.id.value              = l.id;
  form.elements.name.value            = l.name;
  form.elements.totalAmount.value     = l.totalAmount;
  form.elements.monthlyPayment.value  = l.monthlyPayment;
  form.elements.minPayment.value      = l.minPayment || '';
  form.elements.remainingAmount.value = l.remainingAmount != null ? l.remainingAmount : '';
  form.elements.startDate.value       = l.startDate;
  form.elements.endDate.value         = l.endDate;
  form.elements.note.value            = l.note;
  document.getElementById('loan-form-title').textContent = '編集';
  document.getElementById('loan-modal').hidden = false;
}

async function deleteLoan(id) {
  const l = _loans.find(x => x.id === id);
  if (!l || !await showConfirm(`「${l.name}」を削除しますか？`)) return;
  await db.from('loans').delete().eq('id', id);
  _loans = _loans.filter(x => x.id !== id);
  renderLoans();
}

function initLoans() {
  document.getElementById('btn-add-loan').addEventListener('click', openAddLoan);

  document.getElementById('btn-cancel-loan').addEventListener('click', () => {
    document.getElementById('loan-modal').hidden = true;
  });
  document.getElementById('loan-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  document.getElementById('loan-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const id = f.elements.id.value;
    const loan = {
      name:            f.elements.name.value.trim(),
      totalAmount:     f.elements.totalAmount.value,
      monthlyPayment:  f.elements.monthlyPayment.value,
      minPayment:      f.elements.minPayment.value  || null,
      remainingAmount: f.elements.remainingAmount.value || null,
      startDate:       f.elements.startDate.value  || null,
      endDate:         f.elements.endDate.value     || null,
      note:            f.elements.note.value.trim() || null,
    };
    if (id) {
      await db.from('loans').update(loanToRow(loan)).eq('id', id);
    } else {
      await db.from('loans').insert([loanToRow(loan)]);
    }
    document.getElementById('loan-modal').hidden = true;
    await loadLoans();
    renderLoans();
  });
}

// ============================================================
// 初期表示
// ============================================================
// Wish List
// ============================================================
let _wlItems   = [];
let _wlTags    = [];
let _wlFilter  = 'all';
let _wlTagFilter = new Set();
let _wlInited  = false;

async function initWishList() {
  if (_wlInited) { renderWishList(); return; }
  _wlInited = true;
  await Promise.all([loadWlTags(), loadWlItems()]);
  renderWlTagFilters();
  renderWishList();
  setupWishListUI();
}

async function loadWlTags() {
  const { data } = await db.from('wish_tags').select('name').order('id');
  _wlTags = (data || []).map(r => r.name);
}

async function loadWlItems() {
  const { data } = await db.from('wish_list').select('*').order('priority', { ascending: false }).order('created_at');
  _wlItems = data || [];
}

function renderWlTagFilters() {
  const wrap = document.getElementById('wl-tag-filters');
  if (!wrap) return;
  wrap.innerHTML = _wlTags.map(t => {
    const active = _wlTagFilter.has(t) ? ' active' : '';
    return `<button class="wl-tag-filter-btn${active}" data-tag="${escapeHtmlF(t)}">${escapeHtmlF(t)}</button>`;
  }).join('');
  wrap.querySelectorAll('.wl-tag-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _wlTagFilter.has(btn.dataset.tag) ? _wlTagFilter.delete(btn.dataset.tag) : _wlTagFilter.add(btn.dataset.tag);
      btn.classList.toggle('active', _wlTagFilter.has(btn.dataset.tag));
      renderWishList();
    });
  });
}

function renderWishList() {
  const tbody = document.getElementById('wl-tbody');
  const empty = document.getElementById('wl-empty');
  if (!tbody) return;

  let items = _wlItems;
  if (_wlFilter === 'unpurchased') items = items.filter(i => !i.purchased_at);
  if (_wlFilter === 'purchased')   items = items.filter(i =>  i.purchased_at);
  if (_wlTagFilter.size > 0)       items = items.filter(i => i.tags?.some(t => _wlTagFilter.has(t)));

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = items.map(item => {
    const stars = '★'.repeat(item.priority) + '☆'.repeat(3 - item.priority);
    const nameCell = item.url
      ? `<a href="${escapeHtmlF(item.url)}" target="_blank" class="wl-item-link">${escapeHtmlF(item.name)}</a>`
      : escapeHtmlF(item.name);
    const price = item.price_min || item.price_max
      ? [item.price_min ? `¥${item.price_min.toLocaleString()}` : '—',
         item.price_max ? `¥${item.price_max.toLocaleString()}` : '—'].join(' 〜 ')
      : '—';
    const tags = (item.tags || []).map(t => `<span class="wl-tag-badge">${escapeHtmlF(t)}</span>`).join('');
    const deadline = item.deadline ? item.deadline.slice(0, 7).replace('-', '/') : '—';
    const purchased = item.purchased_at ? `<span class="wl-purchased-badge">${item.purchased_at.slice(0,10)}</span>` : '—';
    return `<tr class="${item.purchased_at ? 'wl-row-purchased' : ''}">
      <td class="wl-td-priority">${stars}</td>
      <td class="wl-td-name">${nameCell}</td>
      <td class="wl-td-price">${price}</td>
      <td class="wl-td-tags">${tags}</td>
      <td class="wl-td-deadline">${deadline}</td>
      <td class="wl-td-purchased">${purchased}</td>
      <td class="wl-td-actions">
        <button class="small-btn wl-edit-btn" data-id="${item.id}">編集</button>
        <button class="small-btn wl-delete-btn" data-id="${item.id}">削除</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.wl-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openWlModal(btn.dataset.id)));
  tbody.querySelectorAll('.wl-delete-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteWlItem(btn.dataset.id)));
}

function renderWlFormTags(selectedTags = []) {
  const wrap = document.getElementById('wl-tag-checkboxes');
  if (!wrap) return;
  wrap.innerHTML = _wlTags.map(t => {
    const checked = selectedTags.includes(t) ? 'checked' : '';
    return `<label class="wl-tag-check"><input type="checkbox" name="tags" value="${escapeHtmlF(t)}" ${checked}> ${escapeHtmlF(t)}</label>`;
  }).join('');
}

function setWlStars(n) {
  document.querySelector('input[name="priority"]').value = n;
  document.querySelectorAll('#wl-star-select .wl-star-btn').forEach((btn, i) => {
    const active = i < n;
    btn.classList.toggle('active', active);
    btn.textContent = active ? '★' : '☆';
  });
}

function openWlModal(id = null) {
  const form  = document.getElementById('wl-form');
  const title = document.getElementById('wl-modal-title');
  form.reset();
  renderWlFormTags([]);
  setWlStars(2);

  if (id) {
    const item = _wlItems.find(i => i.id === id);
    if (!item) return;
    title.textContent = 'アイテムを編集';
    form.elements.id.value           = item.id;
    form.elements.name.value         = item.name;
    form.elements.price_min.value    = item.price_min ?? '';
    form.elements.price_max.value    = item.price_max ?? '';
    form.elements.url.value          = item.url        ?? '';
    form.elements.deadline.value     = item.deadline   ?? '';
    form.elements.purchased_at.value = item.purchased_at ?? '';
    renderWlFormTags(item.tags || []);
    setWlStars(item.priority || 2);
  } else {
    title.textContent = 'アイテムを追加';
  }
  document.getElementById('wl-modal').hidden = false;
}

async function saveWlItem(e) {
  e.preventDefault();
  const f    = e.target;
  const id   = f.elements.id.value;
  const tags = [...f.querySelectorAll('input[name="tags"]:checked')].map(cb => cb.value);
  const payload = {
    name:         f.elements.name.value.trim(),
    price_min:    f.elements.price_min.value    ? parseInt(f.elements.price_min.value)    : null,
    price_max:    f.elements.price_max.value    ? parseInt(f.elements.price_max.value)    : null,
    priority:     parseInt(f.elements.priority.value) || 2,
    url:          f.elements.url.value.trim()          || null,
    deadline:     f.elements.deadline.value            || null,
    purchased_at: f.elements.purchased_at.value        || null,
    tags,
  };
  if (id) {
    await db.from('wish_list').update(payload).eq('id', id);
  } else {
    await db.from('wish_list').insert(payload);
  }
  document.getElementById('wl-modal').hidden = true;
  await loadWlItems();
  renderWishList();
}

function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('wl-confirm-overlay');
    document.getElementById('wl-confirm-msg').textContent = msg;
    overlay.hidden = false;
    const cleanup = (result) => {
      overlay.hidden = true;
      document.getElementById('wl-confirm-ok').onclick = null;
      document.getElementById('wl-confirm-cancel').onclick = null;
      resolve(result);
    };
    document.getElementById('wl-confirm-ok').onclick     = () => cleanup(true);
    document.getElementById('wl-confirm-cancel').onclick = () => cleanup(false);
  });
}

function deleteWlItem(id) {
  const item = _wlItems.find(i => i.id === id);
  if (!item) return;
  showConfirm(`「${item.name}」を削除しますか？`).then(async ok => {
    if (!ok) return;
    await db.from('wish_list').delete().eq('id', id);
    await loadWlItems();
    renderWishList();
  });
}

function setupWishListUI() {
  document.getElementById('wl-add-btn').addEventListener('click', () => openWlModal());
  document.getElementById('wl-cancel-btn').addEventListener('click', () => {
    document.getElementById('wl-modal').hidden = true;
  });
  document.getElementById('wl-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });
  document.getElementById('wl-form').addEventListener('submit', saveWlItem);

  document.querySelectorAll('#wl-star-select button').forEach(btn => {
    btn.addEventListener('click', () => setWlStars(parseInt(btn.dataset.star)));
  });

  document.querySelectorAll('.wl-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wl-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _wlFilter = btn.dataset.filter;
      renderWishList();
    });
  });

  document.getElementById('wl-new-tag-btn').addEventListener('click', async () => {
    const input = document.getElementById('wl-new-tag-input');
    const name  = input.value.trim();
    if (!name || _wlTags.includes(name)) return;
    await db.from('wish_tags').insert({ name });
    _wlTags.push(name);
    input.value = '';
    renderWlTagFilters();
    renderWlFormTags([...document.querySelectorAll('input[name="tags"]:checked')].map(cb => cb.value));
  });
}

// ============================================================
fetchUsdRateF();
renderFinancePnl();
initPlannedTab();
initPlannedSubTabs();
initSubsF();
initLoans();
renderPlannedTab();

// データ更新ボタン
document.getElementById('btn-refresh').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  const tab = document.querySelector('.nav-btn.active')?.dataset.tab;
  if      (tab === 'data')     await renderFinancePnl();
  else if (tab === 'list')     await renderList();
  else if (tab === 'accounts') await renderAccounts();
  else if (tab === 'planned')  await renderPlannedTab();
  else if (tab === 'wishlist') await initWishList();
  else                         await renderDashboard();
  btn.classList.remove('spinning');
});
