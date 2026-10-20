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

const DEFAULT_INCOME   = ['仕送り', '給与', 'Sports Betting'];
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
let _listSort           = { key: 'date', asc: false };
let _listCategoryFilter = '';
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

// ローカル日付から YYYY-MM-DD 文字列を組み立てる（toISOString はUTC変換でJSTとズレるため使わない）
function dateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayJST() {
  const d = new Date();
  return dateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function monthRange(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = dateStr(y, m, 1);
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end = dateStr(y, m, lastDay);
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
    if (tab === 'sim')      renderSim();
    if (tab === 'wishlist') initWishList();
    saveViewState('tab', tab);
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
    saveViewState('dataSub', sub);
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
document.getElementById('input-date').value = todayJST();

// カテゴリ初期化（Supabase から追加分を読み込んでから表示）
loadCategories().then(() => updateCategoryOptions());

document.getElementById('input-category').addEventListener('change', function () {
  setInputConversionMode(this.value === '科目変換');
});

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
    if (btn.classList.contains('edit-type-btn')) return;
    currentType = btn.dataset.type;
    document.querySelectorAll('.type-btn:not(.edit-type-btn)').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setInputConversionMode(false);
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

  let error;
  if (payload.category === '科目変換') {
    const fromPM = document.getElementById('input-conversion-from').value;
    const toPM   = document.getElementById('input-conversion-to').value;
    const base   = { date: payload.date, amount: payload.amount, category: payload.category, memo: payload.memo, location: payload.location };
    const res = await db.from('transactions').insert([
      { ...base, type: 'expense', payment_method: fromPM },
      { ...base, type: 'income',  payment_method: toPM  },
    ]);
    error = res.error;
    if (!error) {
      await Promise.all([
        updateAccountBalance(fromPM, 'expense', payload.amount),
        updateAccountBalance(toPM,   'income',  payload.amount),
      ]);
    }
  } else {
    const res = await db.from('transactions').insert([payload]);
    error = res.error;
    if (!error) await updateAccountBalance(payload.payment_method, payload.type, payload.amount);
  }

  if (error) {
    msgEl.style.color = 'var(--profit-neg)';
    msgEl.textContent = 'エラー: ' + error.message;
  } else {
    msgEl.style.color = 'var(--profit-pos)';
    msgEl.textContent = '✓ 登録しました';
    document.getElementById('input-amount').value = '';
    document.getElementById('input-memo').value   = '';
    document.getElementById('input-location-new').value   = '';
    document.getElementById('input-location-new').style.display = 'none';
    setInputConversionMode(false);
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
  const today = todayJST();
  const effectiveEnd = end > today ? today : end;

  const { data: txns } = await db
    .from('transactions')
    .select('*')
    .gte('date', start)
    .lte('date', effectiveEnd);

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
  const start = dateStr(sixAgo.getFullYear(), sixAgo.getMonth(), sixAgo.getDate());
  const { end }   = monthRange(dashMonth);
  const today = todayJST();
  const effectiveEnd = end > today ? today : end;

  const { data: all } = await db
    .from('transactions')
    .select('date, type, amount')
    .gte('date', start)
    .lte('date', effectiveEnd);

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
    .lte('date', end)
    .order('sort_order');

  // 支払い科目フィルターの選択肢を更新
  const payments = [...new Set((txns || []).map(t => t.payment_method).filter(Boolean))].sort();
  const catSel = document.getElementById('list-category-filter');
  catSel.innerHTML = '<option value="">すべて</option>' + payments.map(p => `<option value="${escapeHtmlF(p)}">${escapeHtmlF(p)}</option>`).join('');
  if (!payments.includes(_listCategoryFilter)) _listCategoryFilter = '';
  catSel.value = _listCategoryFilter;

  const filtered = _listCategoryFilter
    ? (txns || []).filter(t => t.payment_method === _listCategoryFilter)
    : (txns || []);

  const container = document.getElementById('transaction-list');

  // 同じ日付・同じ金額どうしは sort_order 順（ドラッグで決めた順）のまま（sort は安定）
  const listKey = t => _listSort.key === 'date' ? t.date : t.amount;
  const sortFn = (a, b) => {
    const va = listKey(a), vb = listKey(b);
    if (va < vb) return _listSort.asc ? -1 : 1;
    if (va > vb) return _listSort.asc ? 1 : -1;
    return 0;
  };

  const income  = filtered.filter(t => t.type === 'income').sort(sortFn);
  const expense = filtered.filter(t => t.type === 'expense').sort(sortFn);

  const buildItems = list => list.length === 0
    ? '<div class="txn-empty">なし</div>'
    : list.map(t => {
        const memo     = t.memo     ? ` · ${t.memo}`     : '';
        const location = t.location ? ` · 📍${t.location}` : '';
        return `
          <div class="txn-item" data-id="${t.id}">
            <span class="txn-drag-handle" title="ドラッグで並べ替え（同じ${_listSort.key === 'date' ? '日付' : '金額'}の中）">⠿</span>
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

  setupTxnSortable(container, filtered, listKey);

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

// 収入・支出の列それぞれでドラッグ並べ替え。同じ日付（金額順なら同じ金額）の明細の中でだけ動かせる
function setupTxnSortable(container, txns, listKey) {
  if (typeof Sortable === 'undefined') return;
  const byId  = id => txns.find(t => t.id === id);
  const keyOf = el => listKey(byId(el.dataset.id));

  container.querySelectorAll('.list-col').forEach(col => {
    Sortable.create(col, {
      draggable: '.txn-item',
      handle: '.txn-drag-handle',
      animation: 150,
      ghostClass: 'txn-ghost',
      onMove: e => keyOf(e.dragged) === keyOf(e.related),
      onEnd: async e => {
        if (e.oldIndex === e.newIndex) return;
        // 同じグループの明細がもともと持っていた sort_order を、新しい並びの順に配り直す
        const key   = keyOf(e.item);
        const group = [...col.querySelectorAll('.txn-item')].filter(el => keyOf(el) === key).map(el => byId(el.dataset.id));
        const slots = group.map(t => t.sort_order).sort((a, b) => a - b);
        const changed = group.filter((t, i) => t.sort_order !== slots[i]).map(t => ({ id: t.id, sort_order: slots[group.indexOf(t)] }));
        const results = await Promise.all(changed.map(c =>
          db.from('transactions').update({ sort_order: c.sort_order }).eq('id', c.id)));
        if (results.some(r => r.error)) alert('並び順の保存に失敗しました。');
        renderList();
      },
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

document.getElementById('list-category-filter').addEventListener('change', e => {
  _listCategoryFilter = e.target.value;
  renderList();
});

// ============================================================
// 編集モーダル
// ============================================================
function updateEditCategoryOptions() {
  const cats = _editType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  buildOptions(document.querySelector('#edit-form [name="category"]'), cats);
}

function setConversionMode(on) {
  const f = document.getElementById('edit-form');
  document.querySelector('#edit-modal-overlay .type-toggle').hidden = on;
  document.getElementById('edit-payment-group').hidden = on;
  document.getElementById('edit-conversion-wrap').hidden = !on;
  if (on) {
    buildOptions(f.elements.conversion_from, PAYMENT_METHODS);
    buildOptions(f.elements.conversion_to, PAYMENT_METHODS);
  }
}

function setInputConversionMode(on) {
  document.querySelector('#transaction-form .type-toggle').hidden = on;
  document.getElementById('input-payment-group').hidden = on;
  document.getElementById('input-conversion-wrap').hidden = !on;
  if (on) {
    buildOptions(document.getElementById('input-conversion-from'), PAYMENT_METHODS);
    buildOptions(document.getElementById('input-conversion-to'), PAYMENT_METHODS);
  }
}

async function openNewTxnModal(defaultType = 'expense') {
  _editingId = null;
  _editType  = defaultType;

  const f = document.getElementById('edit-form');
  document.querySelectorAll('.edit-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === defaultType);
  });

  const today = todayJST();
  f.elements.id.value     = '';
  f.elements.date.value   = today;
  f.elements.amount.value = '';
  f.elements.memo.value   = '';

  buildOptions(f.elements.payment_method, PAYMENT_METHODS);
  f.elements.payment_method.value = _listCategoryFilter || PAYMENT_METHODS[0];

  updateEditCategoryOptions();
  f.elements.category.value = '';
  setConversionMode(false);
  f.elements.category.onchange = () => setConversionMode(f.elements.category.value === '科目変換');

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
  setConversionMode(false);
  f.elements.category.onchange = () => setConversionMode(f.elements.category.value === '科目変換');

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
  } else if (newPayload.category === '科目変換') {
    const fromPM = f.elements.conversion_from.value;
    const toPM   = f.elements.conversion_to.value;
    await db.from('transactions').insert([
      { ...newPayload, type: 'expense', payment_method: fromPM },
      { ...newPayload, type: 'income',  payment_method: toPM  },
    ]);
    await Promise.all([
      updateAccountBalance(fromPM, 'expense', newPayload.amount),
      updateAccountBalance(toPM,   'income',  newPayload.amount),
    ]);
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

  const lastDay = new Date(y, m, 0).getDate(); // その月の最終日（30日までの月に31日を指定するとSupabase側で無効な日付エラーになりデータ0件扱いになるため）
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

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
  const today = todayJST();

  const [{ data: accounts }, { data: futureTxns }] = await Promise.all([
    db.from('accounts').select('*').order('sort_order'),
    db.from('transactions').select('type, amount, payment_method').gt('date', today),
  ]);

  const container = document.getElementById('accounts-list');

  if (!accounts || accounts.length === 0) {
    container.innerHTML = '<div class="empty-msg">口座データがありません</div>';
    return;
  }

  // 未来の取引が残高に与える影響をアカウント別に集計
  const futureDelta = {};
  for (const t of (futureTxns || [])) {
    const pm = t.payment_method;
    if (!futureDelta[pm]) futureDelta[pm] = 0;
    futureDelta[pm] += t.type === 'income' ? t.amount : -t.amount;
  }

  container.innerHTML = accounts.map(a => {
    const todayBalance = a.balance - (futureDelta[a.account_name] || 0);
    const cls = todayBalance > 0 ? 'positive' : todayBalance < 0 ? 'negative' : 'zero';
    return `
      <div class="account-item" data-name="${a.account_name}">
        <div class="account-name">${a.account_name}</div>
        <div class="account-balance ${cls}" data-value="${a.balance}">
          ${yen(todayBalance)}
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

// サブスク・予定支出・ローンを同じ形にそろえる（予定支出タブとシミュレーションで共通）
// amountOverrides: { 'source:id': 金額 } … その月の金額を確定したもの（planned_amount_overrides）
function buildPlannedItems(subRows, planRows, loanRows, overrideMap = {}, amountOverrides = {}) {
  const usdRate = _usdRateF; // サブスクタブと同じ実勢レート（fetchUsdRateFで取得）を使う

  // サブスクを統一フォーマットに変換
  const subItems = (subRows || []).map(r => ({
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
  const planItems = (planRows || []).map(r => ({
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
  const loanItems = (loanRows || []).map(r => ({
    id:          r.id,
    source:      'loan',
    name:        r.name,
    amount:      r.min_monthly_payment || r.monthly_payment,
    amountMax:   r.min_monthly_payment ? r.monthly_payment : null,
    category:    'loan',
    frequency:   'monthly',
    billingDay:  r.billing_day ?? (r.start_date ? new Date(r.start_date).getDate() : null),
    billingMonth: null,
    startDate:   r.start_date || null,
    endDate:     r.end_date   || null,
    note:        r.note       || null,
    paymentMethod: '',
  }));

  // その月の金額が確定していれば、予定額の代わりに使う（ローンの幅もなくなる）
  const applyAmount = it => {
    const ov = amountOverrides[`${it.source}:${it.id}`];
    if (ov == null) return it;
    return { ...it, plannedAmount: it.amount, plannedAmountMax: it.amountMax || null, amount: ov, amountMax: null, amountConfirmed: true };
  };

  return { subItems: subItems.map(applyAmount), planItems: planItems.map(applyAmount), loanItems: loanItems.map(applyAmount) };
}

function amountOverrideMap(rows) {
  const map = {};
  for (const r of (rows || [])) map[`${r.source}:${r.item_id}`] = r.amount;
  return map;
}

async function renderPlannedTab() {
  const year  = _plannedMonth.getFullYear();
  const month = _plannedMonth.getMonth();
  document.getElementById('planned-month-label').textContent = plannedMonthLabel(_plannedMonth);

  // サブスク（Life）+ 予定支出 + ローン + 日付オーバーライド を並行取得
  const yearMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const [subRes, planRes, loanRes, overrideRes, amountRes] = await Promise.all([
    db.from('subscriptions').select('*').eq('status', 'active'),
    db.from('planned_expenses').select('*').order('billing_day'),
    db.from('loans').select('*'),
    db.from('subscription_billing_overrides').select('*').eq('year_month', yearMonthStr),
    db.from('planned_amount_overrides').select('*').eq('year_month', yearMonthStr),
  ]);
  const overrideMap = {};
  for (const ov of (overrideRes.data || [])) overrideMap[ov.subscription_id] = ov;

  // 編集モーダルが使えるよう _subsF / _loans を補完
  if (_subsF.length === 0 && subRes.data?.length) _subsF = subRes.data.map(normalizeSubF);
  if (_loans.length === 0 && loanRes.data?.length) _loans = loanRes.data.map(normalizeLoan);

  const { subItems, planItems, loanItems } = buildPlannedItems(subRes.data, planRes.data, loanRes.data, overrideMap, amountOverrideMap(amountRes.data));

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
            <button class="planned-amount planned-amount-btn${it.amountConfirmed ? ' is-confirmed' : ''}" data-id="${it.id}" data-source="${it.source}" data-name="${escapeHtmlF(it.name)}" data-amount="${it.amount}" data-confirmed="${!!it.amountConfirmed}" data-planned="${it.amountConfirmed ? it.plannedAmount : it.amount}" data-planned-max="${(it.amountConfirmed ? it.plannedAmountMax : it.amountMax) || ''}" title="この月の金額を確定">
              ${it.amountMax
                ? `¥${it.amount.toLocaleString()}〜¥${it.amountMax.toLocaleString()}`
                : `¥${it.amount.toLocaleString()}`}${it.amountConfirmed ? '<span class="badge-amount-confirmed">確定</span>' : ''}
            </button>
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

  list.querySelectorAll('.planned-amount-btn').forEach(btn => {
    btn.addEventListener('click', () => openAmountOverrideModal(btn.dataset, yearMonthStr));
  });

  list.querySelectorAll('.planned-day-override-btn').forEach(btn => {
    btn.addEventListener('click', () => openDayOverrideModal(btn.dataset.id, btn.dataset.current, btn.dataset.overridden === 'true', yearMonthStr));
  });

  list.querySelectorAll('.planned-register-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { name, amount, category, day, payment } = btn.dataset;
      const billingDate = day
        ? `${yearMonthStr}-${String(day).padStart(2, '0')}`
        : todayJST();
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

// その月の金額を確定（変動する支払いの実際の額を入れる）
function openAmountOverrideModal({ id, source, name, amount, confirmed, planned, plannedMax }, yearMonth) {
  const modal = document.getElementById('amount-override-modal');
  const input = document.getElementById('amount-override-input');
  const isConfirmed = confirmed === 'true';
  const m = Number(yearMonth.split('-')[1]);
  document.getElementById('amount-override-title').textContent = `💴 ${m}月の金額を確定`;
  document.getElementById('amount-override-label').textContent = name;
  document.getElementById('amount-override-planned').textContent = plannedMax
    ? `予定: ¥${Number(planned).toLocaleString()}〜¥${Number(plannedMax).toLocaleString()}`
    : `予定: ¥${Number(planned).toLocaleString()}`;
  input.value = isConfirmed ? amount : '';
  input.placeholder = planned;
  const clearBtn = document.getElementById('btn-amount-override-clear');
  clearBtn.hidden = !isConfirmed;
  modal.hidden = false;
  input.focus();

  const close = () => { modal.hidden = true; };
  document.getElementById('btn-amount-override-save').onclick = async () => {
    const val = parseInt(input.value);
    if (isNaN(val) || val < 0) { alert('金額を入力してください'); return; }
    const { error } = await db.from('planned_amount_overrides')
      .upsert({ source, item_id: id, year_month: yearMonth, amount: val, updated_at: new Date().toISOString() }, { onConflict: 'source,item_id,year_month' });
    if (error) { alert('保存に失敗しました: ' + error.message); return; }
    close();
    renderPlannedTab();
  };
  clearBtn.onclick = async () => {
    await db.from('planned_amount_overrides').delete().eq('source', source).eq('item_id', id).eq('year_month', yearMonth);
    close();
    renderPlannedTab();
  };
  document.getElementById('btn-amount-override-cancel').onclick = close;
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
      saveViewState('plannedSub', sub);
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
    payer:          sub.payer         || '自分',
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
  form.elements.payer.value = '自分';
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
  form.elements.payer.value         = s.payer;
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
      billingDay:    f.elements.billingDay.value   || null,
      paymentMethod: f.elements.paymentMethod.value || null,
      status:        f.elements.status.value,
      payer:         f.elements.payer.value,
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
    renderPlannedTab();
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
    billingDay:      row.billing_day ?? null,
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
    billing_day:      loan.billingDay ? parseInt(loan.billingDay) : null,
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
  form.elements.billingDay.value      = l.billingDay ?? '';
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
      billingDay:      f.elements.billingDay.value  || null,
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
    renderPlannedTab();
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
let _wlPriFilter = new Set();      // 絞り込む優先度（1〜3）
let _wlSort    = 'manual';         // manual = sort_order（ドラッグで決めた順）
let _wlSortable = null;
let _wlSelected = new Set();       // チェックで選んだアイテムのid
let _wlOnlySelected = false;       // true なら選んだものだけ表示
let _wlInited  = false;

// 価格の下限・上限（片方しか入っていない場合はその値を両端に使う）
function wlPriceRange(item) {
  const lo = item.price_min ?? item.price_max;
  const hi = item.price_max ?? item.price_min;
  return lo == null ? null : [lo, hi];
}

async function initWishList() {
  if (_wlInited) { renderWishList(); return; }
  _wlInited = true;
  await Promise.all([loadWlTags(), loadWlItems()]);
  renderWlTagFilters();
  setupWlSortable();
  renderWishList();
  setupWishListUI();
}

async function loadWlTags() {
  const { data } = await db.from('wish_tags').select('name').order('id');
  _wlTags = (data || []).map(r => r.name);
}

async function loadWlItems() {
  const { data } = await db.from('wish_list').select('*').order('sort_order', { nullsFirst: false }).order('created_at');
  _wlItems = data || [];
}

// ドラッグ後: 動かしたアイテムと同じグループ（同じ値）の表示中アイテムだけで、
// もともと持っていた sort_order の値を新しい並びの順に配り直す
// （グループ外・絞り込みで隠れているアイテムの順番は変わらない）
async function saveWlOrder(movedId) {
  const byId  = id => _wlItems.find(i => i.id === id);
  const key   = wlSortKey(byId(movedId));
  const group = [...document.querySelectorAll('#wl-tbody tr[data-id]')]
    .map(tr => byId(tr.dataset.id))
    .filter(i => wlSortKey(i) === key);
  const slots = group.map(i => i.sort_order).sort((a, b) => a - b);

  const changed = [];
  group.forEach((item, idx) => {
    if (item.sort_order !== slots[idx]) {
      item.sort_order = slots[idx];
      changed.push(item);
    }
  });
  _wlItems.sort((a, b) => a.sort_order - b.sort_order);

  const results = await Promise.all(changed.map(i =>
    db.from('wish_list').update({ sort_order: i.sort_order }).eq('id', i.id)));
  if (results.some(r => r.error)) {
    alert('並び順の保存に失敗しました。再読み込みします。');
    await loadWlItems();
  }
  renderWishList();
}

function setupWlSortable() {
  if (_wlSortable || typeof Sortable === 'undefined') return;
  const keyOf = tr => wlSortKey(_wlItems.find(i => i.id === tr.dataset.id));
  _wlSortable = Sortable.create(document.getElementById('wl-tbody'), {
    handle: '.wl-drag-handle',
    animation: 150,
    ghostClass: 'wl-row-ghost',
    // 同じ値の行の上にしか動かせない（金額順なら同じ金額どうしの中だけ）
    onMove: e => keyOf(e.dragged) === keyOf(e.related),
    onEnd: e => { if (e.oldIndex !== e.newIndex) saveWlOrder(e.item.dataset.id); },
  });
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
  if (_wlPriFilter.size > 0)       items = items.filter(i => _wlPriFilter.has(i.priority));
  if (_wlOnlySelected)             items = items.filter(i => _wlSelected.has(i.id));

  items = sortWlItems(items);
  renderWlTotal(items);

  const checkAll = document.getElementById('wl-check-all');
  checkAll.checked = items.length > 0 && items.every(i => _wlSelected.has(i.id));

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
    const rowCls = [item.purchased_at ? 'wl-row-purchased' : '', _wlSelected.has(item.id) ? 'wl-row-selected' : ''].join(' ');
    return `<tr class="${rowCls}" data-id="${item.id}">
      <td class="wl-td-handle"><span class="wl-drag-handle" title="ドラッグで並べ替え">⠿</span></td>
      <td class="wl-td-check"><input type="checkbox" class="wl-row-check" data-id="${item.id}"${_wlSelected.has(item.id) ? ' checked' : ''}></td>
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
  tbody.querySelectorAll('.wl-row-check').forEach(cb =>
    cb.addEventListener('change', () => {
      cb.checked ? _wlSelected.add(cb.dataset.id) : _wlSelected.delete(cb.dataset.id);
      if (_wlSelected.size === 0) _wlOnlySelected = false;
      renderWishList();
    }));
}

// 並べ替えの基準値。同じ値どうしは「同じグループ」で、その中は sort_order（ドラッグで決めた順）になる
// manual は全部同じグループ（= 全体を自由に並べ替え）
function wlSortKey(item) {
  switch (_wlSort) {
    case 'priority_desc':
    case 'priority_asc':  return item.priority;
    case 'price_desc':
    case 'price_asc':     { const r = wlPriceRange(item); return r ? (r[0] + r[1]) / 2 : null; }
    case 'deadline_asc':
    case 'deadline_desc': return item.deadline || null;
    default:              return 0;
  }
}

// 並べ替え。金額は価格帯の中央値で比べる。値なし（価格未設定・期限なし）は常に最後
// _wlItems は sort_order 順で読み込み済みで、sort は安定なので、同じ値どうしは sort_order 順のまま
function sortWlItems(items) {
  const dir = _wlSort.endsWith('_desc') ? -1 : 1;
  return [...items].sort((a, b) => {
    const ka = wlSortKey(a), kb = wlSortKey(b);
    if (ka === kb) return 0;
    if (ka == null || kb == null) return (ka == null) - (kb == null);
    return (ka < kb ? -1 : 1) * dir;
  });
}

// 表示中アイテムの合計金額（下限〜上限）。チェックがあれば、表示中のうちチェックしたものだけを合計する
function renderWlTotal(items) {
  const el = document.getElementById('wl-total');
  if (!el) return;
  const picked = items.filter(i => _wlSelected.has(i.id));
  const target = picked.length > 0 ? picked : items;
  let sumMin = 0, sumMax = 0, noPrice = 0;
  target.forEach(i => {
    const r = wlPriceRange(i);
    if (!r) { noPrice++; return; }
    sumMin += r[0];
    sumMax += r[1];
  });
  const amount = sumMin === sumMax
    ? `¥${sumMin.toLocaleString()}`
    : `¥${sumMin.toLocaleString()} 〜 ¥${sumMax.toLocaleString()}`;
  const label = picked.length > 0
    ? `選択中 <span class="wl-total-count">${picked.length}件</span>`
    : `合計 <span class="wl-total-count">${items.length}件</span>`;
  const selBtns = _wlSelected.size > 0
    ? `<span class="wl-total-actions">
        <button type="button" class="wl-sel-btn${_wlOnlySelected ? ' active' : ''}" id="wl-only-sel-btn">選択だけ表示</button>
        <button type="button" class="wl-sel-btn" id="wl-clear-sel-btn">選択解除</button>
      </span>`
    : '';
  el.innerHTML = `
    <span class="wl-total-label">${label}</span>
    <span class="wl-total-amount">${amount}</span>
    ${noPrice ? `<span class="wl-total-note">価格未設定 ${noPrice}件</span>` : ''}
    ${selBtns}`;

  document.getElementById('wl-only-sel-btn')?.addEventListener('click', () => {
    _wlOnlySelected = !_wlOnlySelected;
    renderWishList();
  });
  document.getElementById('wl-clear-sel-btn')?.addEventListener('click', () => {
    _wlSelected.clear();
    _wlOnlySelected = false;
    renderWishList();
  });
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
    // 新しいアイテムは一番下に追加
    payload.sort_order = Math.max(0, ..._wlItems.map(i => i.sort_order || 0)) + 1;
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

  document.querySelectorAll('.wl-pri-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.pri);
      _wlPriFilter.has(p) ? _wlPriFilter.delete(p) : _wlPriFilter.add(p);
      btn.classList.toggle('active', _wlPriFilter.has(p));
      renderWishList();
    });
  });

  document.getElementById('wl-sort').addEventListener('change', e => {
    _wlSort = e.target.value;
    renderWishList();
  });

  // ヘッダーのチェック: 表示中のアイテムをまとめて選択／解除
  document.getElementById('wl-check-all').addEventListener('change', e => {
    document.querySelectorAll('#wl-tbody .wl-row-check').forEach(cb => {
      e.target.checked ? _wlSelected.add(cb.dataset.id) : _wlSelected.delete(cb.dataset.id);
    });
    if (_wlSelected.size === 0) _wlOnlySelected = false;
    renderWishList();
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
  else if (tab === 'sim')      await renderSim();
  else if (tab === 'wishlist') await initWishList();
  else                         await renderDashboard();
  btn.classList.remove('spinning');
});

// ============================================================
// シミュレーション（必要な額・バイト日数・休み・貯金の推移）
// ============================================================
// sim_jobs      … バイト（時給・1日の時間・交通費・給料が入る月）
// sim_recurring … 毎月の支出/収入（食費・仕送りなど）
// sim_months    … 月ごとの「この月だけ」の項目（items）と出勤日数（work_days: {jobId: 日数}）
//   保存していない月は、それより前で一番近い保存済みの月の出勤日数を引き継ぐ
let _simMonth = new Date(); _simMonth.setDate(1);
let _simJobs = [];
let _simRecurring = [];
let _simMonths = {};
let _simPlannedSrc = null;
let _simAmountOverrides = {}; // { 'YYYY-MM': { 'source:id': 金額 } }
let _simInited = false;
let _simChart = null;
let _simSaveTimers = {}; // 月ごとの保存待ち（別の月の保存を消さないよう分ける）

const SIM_EXCLUDE_CATEGORIES = ['科目変換']; // 口座間の移動は収入・支出に数えない

function simYm(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
function simYmToDate(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1);
}
function simPrevYm(ym) {
  const d = simYmToDate(ym); d.setMonth(d.getMonth() - 1);
  return ymKey(d);
}
function simShiftYm(ym, k) {
  const d = simYmToDate(ym); d.setMonth(d.getMonth() + k);
  return ymKey(d);
}
// 臨時収入を受け取る時期の表示（offset: 0=この月 / 1=翌月 / 2=翌々月）
function simPayWhenLabel(ym, it) {
  const off = Number(it.pay_offset) || 0;
  if (!off && !it.pay_day) return '';
  const m = simYmToDate(simShiftYm(ym, off)).getMonth() + 1;
  return `${m}月${it.pay_day ? it.pay_day + '日' : ''}に受取`;
}
const SIM_PAY_OFFSET_MAX = 2;

function simSignedYen(n) {
  return (n < 0 ? '−' : n > 0 ? '+' : '') + yen(n);
}

async function loadSimData() {
  const [jobRes, recRes, monRes, subRes, planRes, loanRes, amountRes] = await Promise.all([
    db.from('sim_jobs').select('*').order('sort_order').order('id'),
    db.from('sim_recurring').select('*').order('sort_order').order('id'),
    db.from('sim_months').select('*'),
    db.from('subscriptions').select('*').eq('status', 'active'),
    db.from('planned_expenses').select('*'),
    db.from('loans').select('*'),
    db.from('planned_amount_overrides').select('*'),
  ]);
  const byMonth = {};
  for (const r of (amountRes.data || [])) (byMonth[r.year_month] ||= []).push(r);
  _simAmountOverrides = {};
  for (const ym in byMonth) _simAmountOverrides[ym] = amountOverrideMap(byMonth[ym]);
  _simJobs = jobRes.data || [];
  _simRecurring = recRes.data || [];
  _simMonths = {};
  for (const r of (monRes.data || [])) _simMonths[r.year_month] = r;
  _simPlannedSrc = { subs: subRes.data, plans: planRes.data, loans: loanRes.data };
}

// その月の計画（保存していなければ前の月の出勤日数を引き継ぐ）
function simMonthPlan(ym) {
  const saved = _simMonths[ym];
  if (saved) return { items: saved.items || [], workDays: saved.work_days || {}, saving: saved.saving ?? null, saved: true };
  const prev = Object.keys(_simMonths).filter(k => k < ym).sort().pop();
  const workDays = prev ? { ..._simMonths[prev].work_days } : {};
  // 研修が途中で終わった月から引き継ぐときは、研修中＋研修後の合計を出勤日数にする
  for (const job of _simJobs) {
    const tKey = `${job.id}:t`;
    if (workDays[tKey] != null && simTrainingPhase(job, ym) !== 'both') {
      workDays[job.id] = (Number(workDays[job.id]) || 0) + (Number(workDays[tKey]) || 0);
      delete workDays[tKey];
    }
  }
  return {
    items: [],
    workDays,
    saving: prev ? (_simMonths[prev].saving ?? null) : null,  // 貯金に回す額も前の月を引き継ぐ
    saved: false,
    inheritedFrom: prev || null,
  };
}

// 研修の時期: none=研修の設定なし / training=この月はずっと研修中 / regular=研修が終わった後 / both=この月の途中で研修が終わる
function simTrainingPhase(job, ym) {
  const s = job.settings || {};
  if (!s.training_wage || !s.training_end) return 'none';
  const d = simYmToDate(ym);
  const first = dateStr(d.getFullYear(), d.getMonth(), 1);
  const last  = dateStr(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
  if (s.training_end < first) return 'regular';
  if (s.training_end >= last) return 'training';
  return 'both';
}

// 時給バイトの1日の給料（training=true なら研修中の時給）
function simHourlyDayPay(job, training = false) {
  const s = job.settings || {};
  const wage = training ? (s.training_wage || job.hourly_wage) : job.hourly_wage;
  return Math.round((wage || 0) * Number(job.hours_per_day || 0)) + (job.transport_per_day || 0);
}

function simKomaRates(job)   { return (job.settings?.koma_rates   || [1350, 1850, 2500]); }
function simKomaLengths(job) { return (job.settings?.koma_lengths || [60, 90, 120]); }
function simKomaPay(rate, len) { return Math.round(rate * len / 60); }
const SIM_KOMA_CANCEL_RATE = 0.6; // 当日キャンセルのコマは0.6倍
function simKomaCancelPay(rate, len) { return Math.round(rate * len / 60 * SIM_KOMA_CANCEL_RATE); }

// 源泉徴収（交通費を除いた給料にかかる）
//   乙欄: 8.8万円未満は 3.063%（1円未満切り捨て）。TRY の明細（2026年7〜10月）と一致
//         8.8万円以上は税額表の金額（9/25 は 91,425円 → 3,200円）→ 3.5% を100円単位に切り上げた目安
//   甲欄: 10.5万円未満は 0円（令和8年分の月額表・扶養0人）。それ以上は目安
function simWithholding(job, taxable) {
  const w = job.settings?.withholding;
  if (!w || w === 'none' || taxable <= 0) return { tax: 0, estimate: false };
  if (w === 'otsu') {
    return taxable < 88000
      ? { tax: Math.floor(taxable * 0.03063), estimate: false }
      : { tax: Math.ceil(taxable * 0.035 / 100) * 100, estimate: true };
  }
  return taxable < 105000
    ? { tax: 0, estimate: false }
    : { tax: Math.floor((taxable - 105000) * 0.034 / 10) * 10, estimate: true };
}
const SIM_WITHHOLDING_LABEL = { otsu: '乙欄', kou: '甲欄' };

// バイト1つの、その月の出勤日数・給料・日払い・源泉徴収
//   earned は源泉徴収を引く前、net は引いた後（手取り）
// work_days のキー: `${id}` 出勤日数（研修が途中で終わる月は研修後の日数） / `${id}:t` 研修中の日数
//                  `${id}:adv` 日払いをもらう日数 / `${id}:k:${時給}-${分}` コマ数 / `${id}:c:${時給}-${分}` 当日キャンセルのコマ数
function simJobMonth(job, wd, ym) {
  const id = job.id;
  const n = key => Number(wd[key]) || 0;
  if (job.job_type === 'koma') {
    let komaPay = 0, komaCount = 0, cancelCount = 0, cancelPay = 0;
    for (const r of simKomaRates(job)) for (const l of simKomaLengths(job)) {
      const c = n(`${id}:k:${r}-${l}`);
      komaCount += c;
      komaPay += c * simKomaPay(r, l);
      const x = n(`${id}:c:${r}-${l}`);
      cancelCount += x;
      cancelPay += x * simKomaCancelPay(r, l);
    }
    const days = n(id);
    const transport = days * (job.transport_per_day || 0);
    const wh = simWithholding(job, komaPay + cancelPay);
    const earned = komaPay + cancelPay + transport;
    return { days, earned, net: earned - wh.tax, tax: wh.tax, taxEstimate: wh.estimate, advance: 0, komaCount, cancelCount, cancelPay };
  }
  const phase = simTrainingPhase(job, ym);
  let days, earned;
  if (phase === 'both') {
    days = n(id) + n(`${id}:t`);
    earned = n(id) * simHourlyDayPay(job) + n(`${id}:t`) * simHourlyDayPay(job, true);
  } else {
    days = n(id);
    earned = days * simHourlyDayPay(job, phase === 'training');
  }
  const advPer = Math.min(job.settings?.advance_per_day || 0, simHourlyDayPay(job, phase === 'training'));
  const advance = Math.min(n(`${id}:adv`), days) * advPer;
  const wh = simWithholding(job, earned - days * (job.transport_per_day || 0));
  return { days, earned, net: earned - wh.tax, tax: wh.tax, taxEstimate: wh.estimate, advance, phase };
}

function simPlannedTotal(y, m) {
  if (!_simPlannedSrc) return 0;
  const overrides = _simAmountOverrides[simYm(y, m)] || {};
  const { subItems, planItems, loanItems } = buildPlannedItems(_simPlannedSrc.subs, _simPlannedSrc.plans, _simPlannedSrc.loans, {}, overrides);
  // 予定支出タブで確定した金額があればそれを使う。ローンの幅が残っていれば多いほうの額で計算する（足りなくならないように）
  return [...subItems, ...planItems, ...loanItems]
    .filter(it => isActiveInMonth(it, y, m))
    .reduce((s, it) => s + (it.amountMax || it.amount), 0);
}

// 月の計算結果
function simCalc(ym) {
  const d = simYmToDate(ym);
  const y = d.getFullYear(), m = d.getMonth();
  const plan = simMonthPlan(ym);
  const prevPlan = simMonthPlan(simPrevYm(ym));
  const sum = arr => arr.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const planned      = simPlannedTotal(y, m);
  const recurringExp = sum(_simRecurring.filter(r => r.kind === 'expense'));
  const monthExp     = sum(plan.items.filter(it => it.kind === 'expense'));
  const recurringInc = sum(_simRecurring.filter(r => r.kind === 'income'));
  // 臨時収入: 働いた（決まった）月で数える額と、実際に受け取る月で数える額を分ける
  const oneOffEarned = sum(plan.items.filter(it => it.kind === 'income'));
  const arriving = [];  // この月に受け取る臨時収入（前の月の分も含む）
  for (let k = 0; k <= SIM_PAY_OFFSET_MAX; k++) {
    const fromYm = simShiftYm(ym, -k);
    const items = k === 0 ? plan.items : simMonthPlan(fromYm).items;
    for (const it of items) {
      if (it.kind === 'income' && (Number(it.pay_offset) || 0) === k) arriving.push({ ...it, fromYm });
    }
  }
  const oneOffCash = sum(arriving);
  const otherIncome = recurringInc + oneOffEarned;

  let workDays = 0, workIncome = 0, paidWage = 0, withheld = 0;
  const jobMonths = {};
  for (const job of _simJobs) {
    const cur = simJobMonth(job, plan.workDays, ym);
    jobMonths[job.id] = cur;
    workDays   += cur.days;
    workIncome += cur.net;
    // 実際にこの月に入るお金: 日払いはその月、残り（差額）は給料日に入る（翌月払いなら前の月に働いた分）
    // 源泉徴収は給料日の支払いから引かれる
    if (job.pay_timing === 'same') { paidWage += cur.net; withheld += cur.tax; }
    else {
      const prev = simJobMonth(job, prevPlan.workDays, simPrevYm(ym));
      paidWage += cur.advance + (prev.net - prev.advance);
      withheld += prev.tax;
    }
  }
  // 臨時収入（短期バイトなど）に日数が入っていれば出勤日に数える
  workDays += plan.items.reduce((s, it) => s + (it.kind === 'income' ? (Number(it.days) || 0) : 0), 0);

  const need = planned + recurringExp + monthExp;
  // 入るお金 − 必要な額 = 余り。余りを「貯金」と「自由に使えるお金」に分ける
  // 貯金の額を決めていない月は、余りを全部貯金に回したことにする
  const cashIncome = recurringInc + oneOffCash + paidWage;
  const leftover = cashIncome - need;
  const room = Math.max(0, leftover);
  const saving = plan.saving == null ? room : Math.min(plan.saving, room);
  const free = room - saving;
  return {
    leftover, saving, free, savingSet: plan.saving != null,
    ym, plan, planned, need, jobMonths,
    otherIncome, workDays, workIncome,
    income: otherIncome + workIncome,          // 働いた月で数えた収入（計画用）
    cashIncome,                                // 実際にこの月に入る収入（推移用・源泉徴収を引いた後）
    arriving,
    withheld,                                  // この月の支払いから引かれる源泉徴収
    daysInMonth: new Date(y, m + 1, 0).getDate(),
  };
}

async function simSaveMonth(ym, plan) {
  const row = { year_month: ym, items: plan.items, work_days: plan.workDays, saving: plan.saving ?? null, updated_at: new Date().toISOString() };
  _simMonths[ym] = row;
  const { error } = await db.from('sim_months').upsert(row);
  if (error) alert('保存に失敗しました: ' + error.message);
}

// 今月の実績（科目変換を除く）
async function simActualThisMonth() {
  const { start, end } = monthRange(new Date());
  const { data } = await db.from('transactions').select('type, amount, category').gte('date', start).lte('date', end);
  let income = 0, expense = 0;
  for (const t of (data || [])) {
    if (SIM_EXCLUDE_CATEGORIES.includes(t.category)) continue;
    if (t.type === 'income') income += t.amount; else expense += t.amount;
  }
  return { income, expense };
}

async function renderSim() {
  if (!_simInited) { initSim(); _simInited = true; }
  await loadSimData();
  const sub = document.querySelector('.sim-sub-btn.active')?.dataset.sub;
  if (sub === 'trend') await renderSimTrend();
  else                 await renderSimMonth();
}

async function renderSimMonth() {
  const ym = ymKey(_simMonth);
  const c = simCalc(ym);
  document.getElementById('sim-month-label').textContent = monthLabel(_simMonth);

  const note = document.getElementById('sim-inherit-note');
  if (!c.plan.saved && c.plan.inheritedFrom) {
    note.textContent = `出勤日数は ${simYmToDate(c.plan.inheritedFrom).getMonth() + 1}月の計画を引き継いでいます（変えるとこの月の計画として保存されます）`;
    note.hidden = false;
  } else note.hidden = true;

  // 上のカードは「その月に実際に入るお金」で比べる（日払いはその月、残りは給料日の月）
  const diff = c.cashIncome - c.need;
  document.getElementById('sim-need').textContent   = yen(c.need);
  document.getElementById('sim-income').textContent = yen(c.cashIncome);
  document.getElementById('sim-income-sub').textContent = [
    c.income !== c.cashIncome ? `働いた分 ${yen(c.income)}` : '',
    c.withheld ? `源泉 −${yen(c.withheld)}` : '',
  ].filter(Boolean).join(' / ');
  const diffEl = document.getElementById('sim-diff');
  diffEl.textContent = simSignedYen(diff);
  diffEl.style.color = diff < 0 ? 'var(--profit-neg)' : 'var(--profit-pos)';
  document.getElementById('sim-planned-total').textContent = yen(c.planned);
  const confirmedCount = Object.keys(_simAmountOverrides[ym] || {}).length;
  document.getElementById('sim-planned-sub').textContent = confirmedCount
    ? `予定支出タブから自動で計算（${confirmedCount}件は金額確定済み）`
    : '予定支出タブから自動で計算';

  // 出勤日・休み
  const off = Math.max(0, c.daysInMonth - c.workDays);
  document.getElementById('sim-work-days').textContent = c.workDays;
  document.getElementById('sim-off-days').textContent  = off;
  document.getElementById('sim-days-fill').style.width = Math.min(100, c.workDays / c.daysInMonth * 100) + '%';
  renderSimHint(c, c.income - c.need, off);

  renderSimJobs(c);
  renderSimItems(c);

  renderSimUse(c);
}

// 余りの使い道（貯金に回す額 → 残りが自由に使えるお金）
function renderSimUse(c) {
  const el = document.getElementById('sim-use');
  if (c.leftover < 0) {
    el.innerHTML = `
      <div class="sim-use-title">💡 余りの使い道</div>
      <div class="sim-use-short">この月は ${yen(c.leftover)} 足りません</div>
      <div class="sim-row-sub">貯金から出すか、上の「収入」を増やす必要があります。自由に使えるお金・貯金はどちらも ¥0 です。</div>`;
    return;
  }
  const perDay = Math.floor(c.free / c.daysInMonth);
  el.innerHTML = `
    <div class="sim-use-title">💡 余りの使い道</div>
    <div class="sim-use-formula">入るお金 ${yen(c.cashIncome)} − 必要な額 ${yen(c.need)} ＝ <b>余り ${yen(c.leftover)}</b></div>
    <div class="sim-use-split">
      <div class="sim-use-box sim-use-free">
        <div class="sim-use-label">自由に使えるお金</div>
        <div class="sim-use-value">${yen(c.free)}</div>
        <div class="sim-row-sub">1日あたり ${yen(perDay)}</div>
      </div>
      <div class="sim-use-box sim-use-save">
        <div class="sim-use-label">貯金に回す</div>
        <div class="sim-use-value">${yen(c.saving)}</div>
        <div class="sim-row-sub">${c.savingSet ? `余りの ${c.leftover ? Math.round(c.saving / c.leftover * 100) : 0}%` : '未設定（余りを全部貯金）'}</div>
      </div>
    </div>
    <input type="range" class="sim-use-range" id="sim-saving-range" min="0" max="${c.leftover}" step="1000" value="${c.saving}">
    <div class="sim-use-actions">
      <div class="sim-stepper">
        <button data-saving-step="-5000">−</button>
        <input type="number" id="sim-saving-input" min="0" max="${c.leftover}" step="1000" value="${c.saving}" inputmode="numeric">
        <button data-saving-step="5000">＋</button>
      </div>
      <span class="sim-row-sub">貯金に回す額（5,000円ずつ）</span>
    </div>`;

  const range = document.getElementById('sim-saving-range');
  // ドラッグ中は数字だけ書き換える（描き直すとつまみが離れてしまうため）。離したら保存
  range.addEventListener('input', () => {
    const save = Number(range.value), free = c.leftover - save;
    el.querySelector('.sim-use-save .sim-use-value').textContent = yen(save);
    el.querySelector('.sim-use-free .sim-use-value').textContent = yen(free);
    el.querySelector('.sim-use-free .sim-row-sub').textContent = `1日あたり ${yen(Math.floor(free / c.daysInMonth))}`;
    document.getElementById('sim-saving-input').value = save;
  });
  range.addEventListener('change', () => simSetSaving(Number(range.value), true));
  document.getElementById('sim-saving-input').addEventListener('change', e => simSetSaving(Number(e.target.value) || 0, true));
  el.querySelectorAll('[data-saving-step]').forEach(btn => {
    btn.addEventListener('click', () => simSetSaving(c.saving + Number(btn.dataset.savingStep)));
  });
}

function simSetSaving(val, saveNow = false) {
  const ym = ymKey(_simMonth);
  const plan = simMonthPlan(ym);
  const max = Math.max(0, simCalc(ym).leftover);
  plan.saving = Math.max(0, Math.min(max, val));
  _simMonths[ym] = { year_month: ym, items: plan.items, work_days: plan.workDays, saving: plan.saving };
  renderSimMonth();
  clearTimeout(_simSaveTimers[ym]);
  _simSaveTimers[ym] = setTimeout(() => simSaveMonth(ym, plan), saveNow ? 0 : 600);
}

function renderSimHint(c, diff, off) {
  const hint = document.getElementById('sim-hint');
  // 1日（コマなら1コマ）増やすといくら増えるか
  const units = _simJobs.map(j => {
    const jm = c.jobMonths[j.id];
    if (j.job_type === 'koma') {
      // いちばん多く入れているコマ（なければ最初のコマ）で数える
      let best = null;
      for (const r of simKomaRates(j)) for (const l of simKomaLengths(j)) {
        const cnt = Number(c.plan.workDays[`${j.id}:k:${r}-${l}`]) || 0;
        if (!best || cnt > best.cnt) best = { r, l, cnt };
      }
      return best && { job: j, pay: simKomaPay(best.r, best.l), unit: 'コマ', label: `${escapeHtmlF(j.name)}（${best.r}円・${best.l}分コマ）`, key: `${j.id}:k:${best.r}-${best.l}`, cur: best.cnt };
    }
    const training = jm.phase === 'training';
    return { job: j, pay: simHourlyDayPay(j, training), unit: '日', label: escapeHtmlF(j.name), key: String(j.id), cur: Number(c.plan.workDays[j.id]) || 0 };
  }).filter(u => u && u.pay > 0)
    // 乙欄なら手取りで数える（交通費にはかからないが、ここでは少し多めに見積もる）
    .map(u => u.job.settings?.withholding === 'otsu' ? { ...u, pay: Math.floor(u.pay * (1 - 0.03063)) } : u);

  if (units.length === 0) {
    hint.innerHTML = diff < 0
      ? `あと <b>${yen(diff)}</b> 足りません。下の「収入」にバイトを登録すると、何日働けばいいか出せます。`
      : `バイトなしで足りています。`;
    return;
  }
  if (diff < 0) {
    const lines = units.map(u => {
      const n = Math.ceil(-diff / u.pay);
      const offNote = u.unit === '日' ? (n <= off ? `（休みは${off - n}日）` : '（休みの日が足りません）') : '';
      return `<div class="sim-hint-line"><span>${u.label}なら <b>あと${n}${u.unit}</b>${offNote}</span>
        <button class="sim-hint-btn" data-key="${u.key}" data-val="${u.cur + n}">${u.cur + n}${u.unit}にする</button></div>`;
    }).join('');
    hint.innerHTML = `<div class="sim-hint-head sim-short">この働き方を毎月続けると あと ${yen(diff)} 足りません</div>${lines}`;
  } else {
    const lines = units.map(u => {
      const n = Math.min(u.cur, Math.floor(diff / u.pay));
      if (n <= 0) return '';
      const offNote = u.unit === '日' ? `（休みは${off + n}日）` : '';
      return `<div class="sim-hint-line"><span>${u.label}を <b>${n}${u.unit}減らしても</b>足ります${offNote}</span>
        <button class="sim-hint-btn" data-key="${u.key}" data-val="${u.cur - n}">${u.cur - n}${u.unit}にする</button></div>`;
    }).join('');
    hint.innerHTML = `<div class="sim-hint-head sim-ok">この働き方を毎月続けると ${yen(diff)} 余ります</div>${lines}`;
  }
  hint.querySelectorAll('.sim-hint-btn').forEach(btn => {
    btn.addEventListener('click', () => simSetWork(btn.dataset.key, Number(btn.dataset.val), true));
  });
}

function renderSimJobs(c) {
  const wrap = document.getElementById('sim-jobs');
  if (_simJobs.length === 0) {
    wrap.innerHTML = '<p class="empty-msg">「＋ バイト」でバイトを登録してください</p>';
    return;
  }
  const wd = c.plan.workDays;
  const stepper = (key, label, max) => `
    <div class="sim-step-row">
      <span class="sim-step-label">${label}</span>
      <div class="sim-stepper">
        <button data-key="${key}" data-step="-1">−</button>
        <input type="number" min="0" max="${max}" value="${Number(wd[key]) || 0}" data-key="${key}" inputmode="numeric">
        <button data-key="${key}" data-step="1">＋</button>
      </div>
    </div>`;

  wrap.innerHTML = _simJobs.map(j => {
    const jm = c.jobMonths[j.id];
    const s = j.settings || {};
    const payLabel = (j.pay_timing === 'same' ? '当月' : '翌月') + (j.pay_day ? `${j.pay_day}日` : '') + '払い';
    let detail = '', body = '';
    if (j.job_type === 'koma') {
      const rates = simKomaRates(j), lens = simKomaLengths(j);
      detail = `コマ制${j.transport_per_day ? `・交通費 1日${yen(j.transport_per_day)}` : ''}`;
      const komaTable = (kind, payFn) => `
        <table class="sim-koma-table">
          <thead><tr><th></th>${lens.map(l => `<th>${l}分</th>`).join('')}</tr></thead>
          <tbody>${rates.map(r => `<tr><th>${r.toLocaleString()}円</th>${lens.map(l => {
            const key = `${j.id}:${kind}:${r}-${l}`;
            return `<td><input type="number" min="0" value="${Number(wd[key]) || 0}" data-key="${key}" inputmode="numeric" title="1コマ ${yen(payFn(r, l))}"></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table>`;
      body = `
        ${komaTable('k', simKomaPay)}
        <div class="sim-row-sub">合計 ${jm.komaCount}コマ</div>
        <details class="sim-koma-cancel"${jm.cancelCount ? ' open' : ''}>
          <summary>当日キャンセル（0.6倍）${jm.cancelCount ? ` ${jm.cancelCount}コマ・${yen(jm.cancelPay)}` : ''}</summary>
          ${komaTable('c', simKomaCancelPay)}
        </details>
        ${stepper(String(j.id), '出勤日', c.daysInMonth)}`;
    } else {
      const phase = jm.phase;
      const wageText = phase === 'training' ? `研修中 時給${yen(s.training_wage)}`
                     : phase === 'both'     ? `研修中 ${yen(s.training_wage)} → ${yen(j.hourly_wage)}`
                     : `時給${yen(j.hourly_wage)}`;
      detail = `${wageText} × ${Number(j.hours_per_day)}時間${j.transport_per_day ? ` ＋ 交通費${yen(j.transport_per_day)}` : ''}`;
      if (phase === 'both') {
        const endDay = Number(s.training_end.slice(8, 10));
        body = stepper(`${j.id}:t`, `研修中（〜${endDay}日）`, c.daysInMonth) + stepper(String(j.id), `研修後（${endDay + 1}日〜）`, c.daysInMonth);
      } else {
        body = stepper(String(j.id), phase === 'training' ? '出勤日（研修中）' : '出勤日', c.daysInMonth);
      }
      if (s.advance_per_day) {
        body += stepper(`${j.id}:adv`, `日払い（1日${yen(s.advance_per_day)}）`, c.daysInMonth);
        if (jm.advance > 0) {
          body += `<div class="sim-row-sub">日払いで ${yen(jm.advance)} → 残り ${yen(jm.net - jm.advance)} は${payLabel.replace('払い', '')}に受け取り</div>`;
        }
      }
    }
    return `
      <div class="sim-job">
        <div class="sim-job-top">
          <div>
            <div class="sim-row-name">${escapeHtmlF(j.name)} <span class="sim-badge">${payLabel}</span></div>
            <div class="sim-row-sub">${detail}</div>
          </div>
          <button class="planned-edit-btn sim-job-edit" data-id="${j.id}">編集</button>
        </div>
        ${body}
        ${jm.tax ? `<div class="sim-job-tax"><span>源泉徴収（${SIM_WITHHOLDING_LABEL[s.withholding]}${jm.taxEstimate ? '・目安' : ''}）</span><span>−${yen(jm.tax)}</span></div>` : ''}
        <div class="sim-job-total"><span>${jm.days}日${jm.tax ? '・手取り' : ''}</span><span class="sim-row-amount">${yen(jm.net)}</span></div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.sim-stepper button').forEach(btn => {
    btn.addEventListener('click', () => {
      const cur = Number(simMonthPlan(ymKey(_simMonth)).workDays[btn.dataset.key]) || 0;
      simSetWork(btn.dataset.key, cur + Number(btn.dataset.step));
    });
  });
  wrap.querySelectorAll('input[data-key]').forEach(inp => {
    inp.addEventListener('change', () => simSetWork(inp.dataset.key, Number(inp.value) || 0, true));
  });
  wrap.querySelectorAll('.sim-job-edit').forEach(btn => {
    btn.addEventListener('click', () => openSimJobModal(btn.dataset.id));
  });
}

// 出勤日数を変える（＋−は連打できるよう、保存は少し待ってからまとめて）
// 出勤日数・コマ数などを変える（＋−は連打できるよう、保存は少し待ってからまとめて）
function simSetWork(key, val, saveNow = false) {
  const ym = ymKey(_simMonth);
  const plan = simMonthPlan(ym);
  const isKoma = key.includes(':k:') || key.includes(':c:');
  const max = isKoma ? 999 : simCalc(ym).daysInMonth;
  plan.workDays = { ...plan.workDays, [key]: Math.max(0, Math.min(max, val)) };
  _simMonths[ym] = { year_month: ym, items: plan.items, work_days: plan.workDays, saving: plan.saving ?? null }; // 先に画面に反映
  renderSimMonth();
  clearTimeout(_simSaveTimers[ym]);
  _simSaveTimers[ym] = setTimeout(() => simSaveMonth(ym, plan), saveNow ? 0 : 500);
}

function renderSimItems(c) {
  const row = (name, amount, target, key, days, when) => `
    <div class="sim-row sim-row-tap" data-target="${target}" data-key="${key}">
      <span class="sim-row-name">${escapeHtmlF(name)}${days ? `<span class="sim-badge">${days}日</span>` : ''}${when ? `<span class="sim-badge sim-badge-when">${when}</span>` : ''}</span>
      <span class="sim-row-amount">${yen(Number(amount) || 0)}</span>
    </div>`;
  const empty = '<p class="sim-empty">なし</p>';
  const fill = (id, html) => { document.getElementById(id).innerHTML = html || empty; };

  fill('sim-recurring-expense', _simRecurring.filter(r => r.kind === 'expense').map(r => row(r.name, r.amount, 'recurring-expense', r.id)).join(''));
  fill('sim-recurring-income',  _simRecurring.filter(r => r.kind === 'income').map(r => row(r.name, r.amount, 'recurring-income', r.id)).join(''));
  fill('sim-month-expense', c.plan.items.map((it, i) => it.kind === 'expense' ? row(it.name, it.amount, 'month-expense', i) : '').join(''));
  // この月の臨時収入（受け取りが先の月なら、その時期を表示）＋ 前の月の分でこの月に受け取るもの
  const fromPrev = c.arriving.filter(it => it.fromYm !== c.ym).map(it => `
    <div class="sim-row sim-row-from">
      <span class="sim-row-name">${escapeHtmlF(it.name)}<span class="sim-badge">${simYmToDate(it.fromYm).getMonth() + 1}月の分</span></span>
      <span class="sim-row-amount">${yen(Number(it.amount) || 0)}</span>
    </div>`).join('');
  fill('sim-month-income', c.plan.items.map((it, i) => it.kind === 'income' ? row(it.name, it.amount, 'month-income', i, it.days, simPayWhenLabel(c.ym, it)) : '').join('') + fromPrev);

  document.querySelectorAll('#tab-sim .sim-row-tap').forEach(el => {
    el.addEventListener('click', () => openSimItemModal(el.dataset.target, el.dataset.key));
  });
}

// ---------- モーダル: バイト ----------
function simToggleJobType(type) {
  document.querySelectorAll('#sim-job-form [data-job-type]').forEach(el => { el.hidden = el.dataset.jobType !== type; });
}

function openSimJobModal(id = null) {
  const f = document.getElementById('sim-job-form');
  f.reset();
  const job = id ? _simJobs.find(j => String(j.id) === String(id)) : null;
  const s = job?.settings || {};
  f.elements.id.value = job ? job.id : '';
  if (job) {
    f.elements.name.value            = job.name;
    f.elements.jobType.value         = job.job_type || 'hourly';
    f.elements.hourlyWage.value      = job.hourly_wage || '';
    f.elements.hoursPerDay.value     = Number(job.hours_per_day) || '';
    f.elements.trainingWage.value    = s.training_wage || '';
    f.elements.trainingEnd.value     = s.training_end || '';
    f.elements.advancePerDay.value   = s.advance_per_day || '';
    f.elements.transportPerDay.value = job.transport_per_day || '';
    f.elements.payTiming.value       = job.pay_timing;
    f.elements.payDay.value          = job.pay_day || '';
    f.elements.withholding.value     = s.withholding || 'none';
  }
  simToggleJobType(f.elements.jobType.value);
  document.getElementById('sim-job-title').textContent = job ? 'バイトを編集' : 'バイトを追加';
  document.getElementById('btn-sim-del-job').hidden = !job;
  document.getElementById('sim-job-modal').hidden = false;
}

async function saveSimJob(e) {
  e.preventDefault();
  const f = e.target;
  if (!f.elements.name.value.trim()) { f.elements.name.focus(); return; }
  const num = name => Number(f.elements[name].value) || 0;
  const type = f.elements.jobType.value;
  const settings = type === 'koma'
    ? {}  // コマの時給・長さは simKomaRates / simKomaLengths の決まった3種類
    : { training_wage: num('trainingWage') || null, training_end: f.elements.trainingEnd.value || null,
        advance_per_day: num('advancePerDay') || null };
  settings.withholding = f.elements.withholding.value;
  const row = {
    name:              f.elements.name.value.trim(),
    job_type:          type,
    hourly_wage:       type === 'koma' ? 0 : num('hourlyWage'),
    hours_per_day:     type === 'koma' ? 0 : num('hoursPerDay'),
    transport_per_day: num('transportPerDay'),
    pay_timing:        f.elements.payTiming.value,
    pay_day:           num('payDay') || null,
    settings,
  };
  const id = f.elements.id.value;
  const { error } = id
    ? await db.from('sim_jobs').update(row).eq('id', id)
    : await db.from('sim_jobs').insert({ ...row, sort_order: _simJobs.length + 1 });
  if (error) { alert('保存に失敗しました: ' + error.message); return; }
  document.getElementById('sim-job-modal').hidden = true;
  await renderSim();
  // 追加したら、そのバイトのカード（コマ数・日数を入れる場所）を見せる
  if (!id) document.querySelector('#sim-jobs .sim-job:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteSimJob() {
  const id = document.getElementById('sim-job-form').elements.id.value;
  if (!id || !(await showConfirm('このバイトを削除しますか？'))) return;
  await db.from('sim_jobs').delete().eq('id', id);
  document.getElementById('sim-job-modal').hidden = true;
  await renderSim();
}

// ---------- モーダル: 支出・収入の項目 ----------
const SIM_ITEM_TITLES = {
  'recurring-expense': ['毎月の支出', '食費・日用品など'],
  'recurring-income':  ['毎月の収入', '仕送りなど'],
  'month-expense':     ['この月だけの支出', '飲み会・旅行・欲しい物など'],
  'month-income':      ['臨時収入', '短期バイト・臨時の仕送りなど'],
};

async function openSimItemModal(target, key = '') {
  const f = document.getElementById('sim-item-form');
  f.reset();
  f.elements.target.value = target;
  f.elements.key.value = key;
  let item = null;
  if (key !== '') {
    item = target.startsWith('recurring')
      ? _simRecurring.find(r => String(r.id) === String(key))
      : simMonthPlan(ymKey(_simMonth)).items[Number(key)];
  }
  if (item) {
    f.elements.name.value = item.name; f.elements.amount.value = item.amount; f.elements.days.value = item.days || '';
    f.elements.payOffset.value = item.pay_offset || 0; f.elements.payDay.value = item.pay_day || '';
  }
  document.getElementById('sim-item-days-wrap').hidden = target !== 'month-income';
  document.getElementById('sim-item-when-wrap').hidden = target !== 'month-income';
  // 受け取る時期の選択肢に月の名前を出す（例: 11月（この月）/ 12月（翌月））
  const offSel = f.elements.payOffset;
  [...offSel.options].forEach(o => {
    const m = simYmToDate(simShiftYm(ymKey(_simMonth), Number(o.value))).getMonth() + 1;
    o.textContent = `${m}月（${['この月', '翌月', '翌々月'][Number(o.value)]}）`;
  });
  const [title, ph] = SIM_ITEM_TITLES[target];
  const monthPrefix = target.startsWith('month') ? `${_simMonth.getMonth() + 1}月・` : '';
  document.getElementById('sim-item-title').textContent = monthPrefix + title + (item ? 'を編集' : 'を追加');
  f.elements.name.placeholder = ph;
  document.getElementById('btn-sim-del-item').hidden = !item;

  // この月だけの支出は Wish List（未購入）から選べる
  const pick = document.getElementById('sim-wl-pick');
  pick.hidden = !(target === 'month-expense' && !item);
  if (!pick.hidden) {
    const { data } = await db.from('wish_list').select('id, name, price_min, price_max, purchased_at').is('purchased_at', null).order('sort_order', { nullsFirst: false });
    const sel = document.getElementById('sim-wl-select');
    sel.innerHTML = '<option value="">選ばない</option>' + (data || []).map(w => {
      const r = wlPriceRange(w);
      return `<option value="${r ? r[1] : ''}" data-name="${escapeHtmlF(w.name)}">${escapeHtmlF(w.name)}${r ? `（${yen(r[1])}）` : ''}</option>`;
    }).join('');
  }
  document.getElementById('sim-item-modal').hidden = false;
}

async function saveSimItem(e) {
  e.preventDefault();
  const f = e.target;
  const name = f.elements.name.value.trim();
  const amount = Number(f.elements.amount.value) || 0;
  if (!name) { f.elements.name.focus(); return; }
  const target = f.elements.target.value, key = f.elements.key.value;
  const kind = target.endsWith('income') ? 'income' : 'expense';

  if (target.startsWith('recurring')) {
    const { error } = key
      ? await db.from('sim_recurring').update({ name, amount }).eq('id', key)
      : await db.from('sim_recurring').insert({ kind, name, amount, sort_order: _simRecurring.length + 1 });
    if (error) { alert('保存に失敗しました: ' + error.message); return; }
  } else {
    const ym = ymKey(_simMonth);
    const plan = simMonthPlan(ym);
    const items = [...plan.items];
    const it = { kind, name, amount };
    if (target === 'month-income') {
      if (Number(f.elements.days.value) > 0)      it.days = Number(f.elements.days.value);
      if (Number(f.elements.payOffset.value) > 0) it.pay_offset = Number(f.elements.payOffset.value);
      if (Number(f.elements.payDay.value) > 0)    it.pay_day = Number(f.elements.payDay.value);
    }
    if (key !== '') items[Number(key)] = it;
    else items.push(it);
    await simSaveMonth(ym, { ...plan, items });
  }
  document.getElementById('sim-item-modal').hidden = true;
  await renderSim();
}

async function deleteSimItem() {
  const f = document.getElementById('sim-item-form');
  const target = f.elements.target.value, key = f.elements.key.value;
  if (key === '' || !(await showConfirm('この項目を削除しますか？'))) return;
  if (target.startsWith('recurring')) {
    await db.from('sim_recurring').delete().eq('id', key);
  } else {
    const ym = ymKey(_simMonth);
    const plan = simMonthPlan(ym);
    await simSaveMonth(ym, { ...plan, items: plan.items.filter((_, i) => i !== Number(key)) });
  }
  document.getElementById('sim-item-modal').hidden = true;
  await renderSim();
}

// ---------- 貯金の推移 ----------
async function renderSimTrend() {
  const months = Number(document.getElementById('sim-trend-months').value) || 6;
  const [{ data: accounts }, act] = await Promise.all([
    db.from('accounts').select('balance'),
    simActualThisMonth(),
  ]);
  const start = (accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  document.getElementById('sim-start-balance').textContent = (start < 0 ? '−' : '') + yen(start);

  const rows = [];
  let balance = start;
  const d = new Date(); d.setDate(1);
  for (let i = 0; i < months; i++) {
    const ym = ymKey(d);
    const c = simCalc(ym);
    // 自由に使えるお金は使い切る前提。残高が増えるのは貯金の分（足りない月は減る）
    let inc = c.cashIncome, exp = c.need + c.free;
    if (i === 0) {
      // 今月は、もう口座に反映されている分を除いて「これからの分」だけ足し引きする
      inc = Math.max(0, c.cashIncome - act.income);
      exp = Math.max(0, c.need + c.free - act.expense);
    }
    balance += inc - exp;
    rows.push({ ym, label: `${d.getMonth() + 1}月`, year: d.getFullYear(), free: c.free, saving: c.leftover < 0 ? c.leftover : c.saving, balance, workDays: c.workDays, isNow: i === 0, withheld: c.withheld });
    d.setMonth(d.getMonth() + 1);
  }

  const withheldTotal = rows.reduce((s, r) => s + r.withheld, 0);
  const taxEl = document.getElementById('sim-trend-tax');
  taxEl.hidden = !withheldTotal;
  taxEl.innerHTML = `この期間に引かれる源泉徴収 <b>${yen(withheldTotal)}</b><br><span class="sim-row-sub">1年の給料が少なければ、確定申告で戻ってくる見込みです（この推移には入れていません）</span>`;

  document.getElementById('sim-trend-tbody').innerHTML = rows.map(r => `
    <tr class="sim-trend-row" data-ym="${r.ym}">
      <td>${r.label}${r.isNow ? '<span class="sim-badge">これから</span>' : ''}<div class="sim-row-sub">出勤${r.workDays}日</div></td>
      <td class="sim-free">${yen(r.free)}</td>
      <td class="${r.saving < 0 ? 'sim-neg' : 'sim-save'}">${r.saving < 0 ? '−' : ''}${yen(r.saving)}</td>
      <td class="${r.balance < 0 ? 'sim-neg' : ''}"><b>${r.balance < 0 ? '−' : ''}${yen(r.balance)}</b></td>
    </tr>`).join('');
  document.querySelectorAll('#sim-trend-tbody .sim-trend-row').forEach(tr => {
    tr.addEventListener('click', () => {
      _simMonth = simYmToDate(tr.dataset.ym);
      document.querySelector('.sim-sub-btn[data-sub="month"]').click();
    });
  });

  if (_simChart) _simChart.destroy();
  const ctx = document.getElementById('sim-trend-chart');
  _simChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['今', ...rows.map(r => r.label + '末')],
      datasets: [{
        label: '口座残高',
        data: [start, ...rows.map(r => r.balance)],
        borderColor: '#4A90D9',
        backgroundColor: 'rgba(74,144,217,0.12)',
        fill: true,
        tension: 0,
        pointBackgroundColor: [start, ...rows.map(r => r.balance)].map(v => v < 0 ? '#E74C3C' : '#4A90D9'),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '¥' + c.parsed.y.toLocaleString() } } },
      scales: { y: { ticks: { callback: v => '¥' + (v / 10000).toLocaleString() + '万' } } },
    },
  });
}

function initSim() {
  document.querySelectorAll('.sim-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sim-sub-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sim-sub-content').forEach(c => { c.hidden = true; });
      btn.classList.add('active');
      document.getElementById(`sim-sub-${btn.dataset.sub}`).hidden = false;
      saveViewState('simSub', btn.dataset.sub);
      if (btn.dataset.sub === 'trend') renderSimTrend();
      else                             renderSimMonth();
    });
  });
  document.getElementById('sim-prev').addEventListener('click', () => { _simMonth.setMonth(_simMonth.getMonth() - 1); renderSimMonth(); });
  document.getElementById('sim-next').addEventListener('click', () => { _simMonth.setMonth(_simMonth.getMonth() + 1); renderSimMonth(); });
  document.getElementById('sim-trend-months').addEventListener('change', renderSimTrend);

  document.getElementById('btn-sim-add-job').addEventListener('click', () => openSimJobModal());
  document.getElementById('sim-job-form').addEventListener('submit', saveSimJob);
  document.getElementById('sim-job-type').addEventListener('change', e => simToggleJobType(e.target.value));
  document.getElementById('btn-sim-del-job').addEventListener('click', deleteSimJob);

  document.querySelectorAll('#tab-sim .sim-add-link').forEach(btn => {
    btn.addEventListener('click', () => openSimItemModal(btn.dataset.add));
  });
  document.getElementById('sim-item-form').addEventListener('submit', saveSimItem);
  document.getElementById('btn-sim-del-item').addEventListener('click', deleteSimItem);
  document.getElementById('sim-wl-select').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    const f = document.getElementById('sim-item-form');
    if (!opt.value && !opt.dataset.name) return;
    f.elements.name.value = opt.dataset.name || '';
    if (opt.value) f.elements.amount.value = opt.value;
  });

  // キャンセル・外側タップで閉じる
  document.querySelectorAll('#tab-sim [data-close]').forEach(btn => {
    btn.addEventListener('click', () => { document.getElementById(btn.dataset.close).hidden = true; });
  });
  document.querySelectorAll('#tab-sim .sim-modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
  });
}

// ============================================================
// 見ていたタブを覚えておき、ページを更新しても同じ画面を開く
// （この端末のブラウザにだけ保存。読めなくても入力タブで開くだけ）
// ============================================================
function loadViewState() {
  try { return JSON.parse(localStorage.getItem('finance-view') || '{}'); } catch { return {}; }
}
function saveViewState(key, val) {
  try {
    const st = loadViewState();
    st[key] = val;
    localStorage.setItem('finance-view', JSON.stringify(st));
  } catch { /* 保存できない環境では何もしない */ }
}

(function restoreView() {
  const st = loadViewState();
  // シミュのサブタブは、タブを開く前に選んでおく（renderSim が見るため）
  if (st.simSub) {
    const btn = document.querySelector(`.sim-sub-btn[data-sub="${st.simSub}"]`);
    if (btn) {
      document.querySelectorAll('.sim-sub-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.sim-sub-content').forEach(c => { c.hidden = c.id !== `sim-sub-${st.simSub}`; });
    }
  }
  if (st.tab && st.tab !== 'input') document.querySelector(`.nav-btn[data-tab="${st.tab}"]`)?.click();
  if (st.tab === 'data' && st.dataSub)       document.querySelector(`.data-sub-btn[data-sub="${st.dataSub}"]`)?.click();
  if (st.tab === 'planned' && st.plannedSub) document.querySelector(`.sub-nav-btn[data-sub="${st.plannedSub}"]`)?.click();
})();
