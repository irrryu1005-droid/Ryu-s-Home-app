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
    if (tab === 'accounts') { renderAccounts(); renderAccountHistory(); }
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
        const location = t.location ? ` · <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${t.location}` : '';
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
  transport: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/></svg> 交通',
  loan:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg> ローン・返済',
  utility:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> 光熱費・通信',
  other:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/></svg> その他',
  subscription: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> サブスク',
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
  const { start: mStart, end: mEnd } = monthRange(new Date(year, month, 1));
  const [subRes, planRes, loanRes, overrideRes, amountRes, paidRes, txnRes] = await Promise.all([
    db.from('subscriptions').select('*').eq('status', 'active'),
    db.from('planned_expenses').select('*').order('billing_day'),
    db.from('loans').select('*'),
    db.from('subscription_billing_overrides').select('*').eq('year_month', yearMonthStr),
    db.from('planned_amount_overrides').select('*').eq('year_month', yearMonthStr),
    db.from('planned_paid').select('*').eq('year_month', yearMonthStr),
    db.from('transactions').select('memo, amount').eq('type', 'expense').gte('date', mStart).lte('date', mEnd),
  ]);
  const overrideMap = {};
  for (const ov of (overrideRes.data || [])) overrideMap[ov.subscription_id] = ov;

  // 編集モーダルが使えるよう _subsF / _loans を補完
  if (_subsF.length === 0 && subRes.data?.length) _subsF = subRes.data.map(normalizeSubF);
  if (_loans.length === 0 && loanRes.data?.length) _loans = loanRes.data.map(normalizeLoan);

  const { subItems, planItems, loanItems } = buildPlannedItems(subRes.data, planRes.data, loanRes.data, overrideMap, amountOverrideMap(amountRes.data));

  const all = [...subItems, ...planItems, ...loanItems].filter(it => isActiveInMonth(it, year, month));
  all.sort((a, b) => (a.billingDay || 99) - (b.billingDay || 99));

  // 支払い済み: ✓で登録したもの（planned_paid）。前に✓で登録した分は「メモが同じ名前・同じ金額の支出」がこの月にあれば済みとみなす
  const paidKeys = new Set((paidRes.data || []).map(r => `${r.source}:${r.item_id}`));
  const txns = [...(txnRes.data || [])];
  for (const it of all) {
    if (paidKeys.has(`${it.source}:${it.id}`)) { it.paid = 'marked'; continue; }
    const i = txns.findIndex(t => (t.memo || '').trim() === it.name && (t.amount === it.amount || t.amount === it.amountMax));
    if (i !== -1) { it.paid = 'matched'; txns.splice(i, 1); }
  }

  const totalMin = all.reduce((s, it) => s + it.amount, 0);
  const totalMax = all.reduce((s, it) => s + (it.amountMax || it.amount), 0);
  document.getElementById('planned-total').textContent = totalMin !== totalMax
    ? `¥${totalMin.toLocaleString()}〜¥${totalMax.toLocaleString()}`
    : `¥${totalMin.toLocaleString()}`;

  // 今月を表示中のときだけ、支払日が明日以降（支払日なしも含む）の分を「残り」として出す
  const now = new Date();
  const isThisMonth = year === now.getFullYear() && month === now.getMonth();
  document.getElementById('planned-remaining-card').hidden = !isThisMonth;
  if (isThisMonth) {
    // 支払い済み（✓で登録したもの）は残りから外す
    const rest = all.filter(it => !it.paid && (!it.billingDay || it.billingDay > now.getDate()));
    const paidCount = all.filter(it => it.paid).length;
    const restMin = rest.reduce((s, it) => s + it.amount, 0);
    const restMax = rest.reduce((s, it) => s + (it.amountMax || it.amount), 0);
    document.getElementById('planned-remaining').textContent = restMin !== restMax
      ? `¥${restMin.toLocaleString()}〜¥${restMax.toLocaleString()}`
      : `¥${restMin.toLocaleString()}`;
    document.getElementById('planned-remaining-sub').textContent = `（明日以降・${rest.length}件${paidCount ? `／支払い済み ${paidCount}件を除く` : ''}）`;
    document.getElementById('planned-remaining').onclick = () => openPlannedRemainingModal(rest);
  }

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
        ? `<span class="badge-sub" style="background:#e8f4e8;color:#34c759">ローン</span>`
        : '';
      const dayOverrideBtn = it.source === 'subscription'
        ? `<button class="planned-day-override-btn" data-id="${it.id}" data-current="${it.billingDay || ''}" data-overridden="${it.billingDayOverridden}" title="今月の支払日を変更"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg></button>`
        : '';
      return `
        <div class="planned-item${it.paid ? ' planned-item-paid' : ''}">
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
            ${it.paid
              ? `<button class="planned-paid-badge" data-id="${it.id}" data-source="${it.source}" data-kind="${it.paid}" title="${it.paid === 'marked' ? 'タップで支払い済みを取り消す' : '同じ名前・金額の支出が記録されています'}">済</button>`
              : `<button class="planned-register-btn" data-id="${it.id}" data-source="${it.source}" data-name="${escapeHtmlF(it.name)}" data-amount="${it.amount}" data-category="${it.category}" data-day="${it.billingDay || ''}" data-payment="${escapeHtmlF(it.paymentMethod)}" title="支出として登録">✓</button>`}
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

  // 「済」: ✓で付けた印は取り消せる（登録した支出の記録はそのまま）
  list.querySelectorAll('.planned-paid-badge').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.kind !== 'marked') { alert('この月に同じ名前・同じ金額の支出が記録されているので、支払い済みとして数えています。外したいときは一覧タブでその支出を消すか、メモを変えてください。'); return; }
      if (!(await showConfirm('支払い済みの印を取り消しますか？（登録した支出の記録は消えません）'))) return;
      await db.from('planned_paid').delete().eq('source', btn.dataset.source).eq('item_id', btn.dataset.id).eq('year_month', yearMonthStr);
      renderPlannedTab();
    });
  });

  list.querySelectorAll('.planned-register-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { id, source, name, amount, category, day, payment } = btn.dataset;
      const billingDate = day
        ? `${yearMonthStr}-${String(day).padStart(2, '0')}`
        : todayJST();
      openPlannedRegisterModal({ id, source, yearMonth: yearMonthStr, name, amount: parseInt(amount), category, date: billingDate, paymentMethod: payment });
    });
  });
}

// 「今月の残りで必要な金額」の明細（支払日順）
function openPlannedRemainingModal(rest) {
  const modal = document.getElementById('planned-remaining-modal');
  const body  = document.getElementById('planned-remaining-body');
  const fmt = it => it.amountMax
    ? `¥${it.amount.toLocaleString()}〜¥${it.amountMax.toLocaleString()}`
    : `¥${it.amount.toLocaleString()}`;
  const total = { amount: rest.reduce((s, it) => s + it.amount, 0), amountMax: null };
  const totalMax = rest.reduce((s, it) => s + (it.amountMax || it.amount), 0);
  if (totalMax !== total.amount) total.amountMax = totalMax;

  body.innerHTML = rest.length === 0
    ? `<p class="empty-msg">明日以降の予定支出はありません</p>`
    : `<div class="pr-list">${rest.map(it => `
        <div class="pr-row">
          <span class="pr-day">${it.billingDay ? it.billingDay + '日' : '日付なし'}</span>
          <span class="pr-name">${escapeHtmlF(it.name)}${it.amountConfirmed ? '<span class="badge-amount-confirmed">確定</span>' : ''}</span>
          <span class="pr-amount">${fmt(it)}</span>
        </div>`).join('')}
        <div class="pr-row pr-total">
          <span class="pr-day"></span>
          <span class="pr-name">合計（${rest.length}件）</span>
          <span class="pr-amount">${fmt(total)}</span>
        </div>
      </div>`;

  modal.hidden = false;
  const close = () => { modal.hidden = true; };
  document.getElementById('btn-planned-remaining-close').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
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
  document.getElementById('amount-override-title').innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg> ${m}月の金額を確定`;
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

function openPlannedRegisterModal({ id, source, yearMonth, name, amount, category, date, paymentMethod }) {
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
    const { data: inserted, error } = await db.from('transactions').insert([payload]).select('id');
    if (error) { alert('登録エラー: ' + error.message); saveBtn.disabled = false; return; }
    await updateAccountBalance(payload.payment_method, 'expense', payload.amount);
    // この月のこの予定支出を「支払い済み」に（残りで必要な金額・シミュの予想から外れる）
    if (id && source && yearMonth) {
      await db.from('planned_paid').upsert({ source, item_id: id, year_month: yearMonth, transaction_id: inserted?.[0]?.id || null, amount: payload.amount, paid_date: payload.date }, { onConflict: 'source,item_id,year_month' });
    }
    close();
    renderPlannedTab();
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
  else if (tab === 'accounts') { await renderAccounts(); await renderAccountHistory(); }
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
let _simTrips = [];           // 旅行（事前に払うもの＋旅行中に使うもの）
let _simGoals = [];           // 貯金の目標（複数）{ id, name, target_amount, start_ym, deadline_ym, saved_amount, monthly_amount, sort_order }
let _simPaid = new Set();     // 予定支出で✓（支払い済み）にしたもの 'YYYY-MM:source:id'
let _simGoalsDone = [];       // 達成した目標（達成日 achieved_at がある）
let _simGoalCache = null;     // simGoalsPlan() の結果（データが変わったら null に戻す）
const SIM_DAILY_LABEL = '日割り';
let _simInited = false;
let _simChart = null;
let _simSaveTimers = {}; // 月ごとの保存待ち（別の月の保存を消さないよう分ける）

const SIM_MONEY_ACCOUNTS = ['deposit（銀行）', 'PayPay', 'cash（現金）']; // シミュで「手元のお金」として合計する口座

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
const SIM_DEFAULT_ACCOUNT = 'deposit（銀行）'; // 入る口座を決めていない収入は銀行に入ることにする
const SIM_ADVANCE_ACCOUNT = 'cash（現金）';    // 日払いは手渡し

function simSignedYen(n) {
  return (n < 0 ? '−' : n > 0 ? '+' : '') + yen(n);
}

async function loadSimData() {
  const [jobRes, recRes, monRes, subRes, planRes, loanRes, amountRes, tripRes, goalRes, paidRes] = await Promise.all([
    db.from('sim_jobs').select('*').order('sort_order').order('id'),
    db.from('sim_recurring').select('*').order('sort_order').order('id'),
    db.from('sim_months').select('*'),
    db.from('subscriptions').select('*').eq('status', 'active'),
    db.from('planned_expenses').select('*'),
    db.from('loans').select('*'),
    db.from('planned_amount_overrides').select('*'),
    db.from('sim_trips').select('*').order('start_date'),
    db.from('sim_goals').select('*').order('sort_order').order('id'),
    db.from('planned_paid').select('source, item_id, year_month'),
  ]);
  _simPaid = new Set((paidRes.data || []).map(r => `${r.year_month}:${r.source}:${r.item_id}`));
  _simGoals = (goalRes.data || []).filter(g => !g.achieved_at);
  _simGoalsDone = (goalRes.data || []).filter(g => g.achieved_at).sort((a, b) => b.achieved_at.localeCompare(a.achieved_at));
  _simGoalCache = null;
  _simTrips = tripRes.data || [];
  const byMonth = {};
  for (const r of (amountRes.data || [])) (byMonth[r.year_month] ||= []).push(r);
  _simAmountOverrides = {};
  for (const ym in byMonth) _simAmountOverrides[ym] = amountOverrideMap(byMonth[ym]);
  _simJobs = jobRes.data || [];
  _simRecurring = recRes.data || [];
  _simMonths = {};
  for (const r of (monRes.data || [])) _simMonths[r.year_month] = r;
  _simPlannedSrc = { subs: subRes.data, plans: planRes.data, loans: loanRes.data };
  // 支出・旅行から作った目標は、目標額をいまの支出の額に合わせる（あとで支出の額を変えてもついていく）
  for (const g of _simGoals) {
    const amt = simExpenseRefAmount(g.expense_ref);
    if (amt == null || amt === g.target_amount) continue;
    g.target_amount = amt;
    db.from('sim_goals').update({ target_amount: amt }).eq('id', g.id).then(({ error }) => { if (error) console.error(error); });
  }
}

// 目標の expense_ref（'YYYY-MM|trip:旅行id' か 'YYYY-MM|名前|日'）から、いまの支出の額を出す。見つからなければ null
function simExpenseRefAmount(ref) {
  if (!ref) return null;
  const [ym, key, day = ''] = ref.split('|');
  if (key.startsWith('trip:')) {
    const trip = _simTrips.find(t => String(t.id) === key.slice(5));
    const amt = trip ? simTripMonth(trip, ym).amount : 0;
    return amt || null;
  }
  const d = simYmToDate(ym);
  const y = d.getFullYear(), m = d.getMonth();
  const hit = (name, dd) => name === key && String(dd || '') === day;
  const { subItems, planItems, loanItems } = buildPlannedItems(_simPlannedSrc.subs, _simPlannedSrc.plans, _simPlannedSrc.loans, {}, _simAmountOverrides[ym] || {});
  const it = [...subItems, ...planItems, ...loanItems].find(it => isActiveInMonth(it, y, m) && hit(it.name, it.billingDay));
  if (it) return it.amountMax || it.amount;
  const r = _simRecurring.find(r => r.kind === 'expense' && simLongActive(r, ym) && hit(r.name, r.day));
  if (r) return Number(r.amount) || null;
  const p = simMonthPlan(ym).items.find(it => it.kind === 'expense' && hit(it.name, it.day));
  return p ? Number(p.amount) || null : null;
}

// その月の計画（保存していなければ前の月の出勤日数を引き継ぐ）
function simMonthPlan(ym) {
  const saved = _simMonths[ym];
  if (saved) return { items: saved.items || [], workDays: saved.work_days || {}, saving: saved.saving ?? null, saved: true };
  const prev = Object.keys(_simMonths).filter(k => k < ym).sort().pop();
  const workDays = prev ? { ..._simMonths[prev].work_days } : {};
  // 研修が途中で終わった月から引き継ぐときは、研修中＋研修後の合計を出勤日数にする
  for (const job of _simJobs) {
    // 塾（コマ制）はコマ数が月ごとにバラバラなので引き継がない（コマ数・キャンセル・出勤日とも0から）
    if (job.job_type === 'koma') {
      for (const k of Object.keys(workDays)) {
        if (k === String(job.id) || k.startsWith(`${job.id}:`)) delete workDays[k];
      }
      continue;
    }
    delete workDays[`${job.id}:advd`];  // 日払いの日は月ごとに違うので引き継がない
    // カレンダーで選んだ出勤日は、次の月には「日数」として引き継ぐ
    if (Array.isArray(workDays[`${job.id}:wd`])) {
      workDays[job.id] = workDays[`${job.id}:wd`].length;
      delete workDays[`${job.id}:wd`];
      delete workDays[`${job.id}:t`];
    }
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
    const wdDates = Array.isArray(wd[`${id}:wd`]) ? wd[`${id}:wd`] : null;
    const days = wdDates ? wdDates.length : n(id);
    const transport = days * (job.transport_per_day || 0);
    const wh = simWithholding(job, komaPay + cancelPay);
    const earned = komaPay + cancelPay + transport;
    return { days, earned, net: earned - wh.tax, tax: wh.tax, taxEstimate: wh.estimate, advance: 0, komaCount, cancelCount, cancelPay, wdDates };
  }
  const phase = simTrainingPhase(job, ym);
  // 出勤日: `${id}:wd` に日にちの配列（カレンダーで選んだ日）。なければ前の作りの日数 `${id}` / `${id}:t`
  const wdDates = Array.isArray(wd[`${id}:wd`]) ? [...wd[`${id}:wd`]].sort((a, b) => a - b) : null;
  let days, earned;
  if (wdDates) {
    // 研修が途中で終わる月は、研修の最終日までの日を研修中の時給で
    const endDay = phase === 'both' ? Number(job.settings.training_end.slice(8, 10)) : null;
    const tDays = phase === 'training' ? wdDates.length : phase === 'both' ? wdDates.filter(d => d <= endDay).length : 0;
    days = wdDates.length;
    earned = tDays * simHourlyDayPay(job, true) + (days - tDays) * simHourlyDayPay(job);
  } else if (phase === 'both') {
    days = n(id) + n(`${id}:t`);
    earned = n(id) * simHourlyDayPay(job) + n(`${id}:t`) * simHourlyDayPay(job, true);
  } else {
    days = n(id);
    earned = days * simHourlyDayPay(job, phase === 'training');
  }
  const advPer = Math.min(job.settings?.advance_per_day || 0, simHourlyDayPay(job, phase === 'training'));
  // 日払いの日: `${id}:advd` に日にちの配列（なければ前の作りの日数 `${id}:adv` だけ）
  let advDays = Array.isArray(wd[`${id}:advd`]) ? [...wd[`${id}:advd`]].sort((a, b) => a - b) : null;
  if (advDays && wdDates) advDays = advDays.filter(d => wdDates.includes(d));  // 日払いは出勤した日だけ
  const advCount = Math.min(advDays ? advDays.length : n(`${id}:adv`), days);
  const advance = advCount * advPer;
  const wh = simWithholding(job, earned - days * (job.transport_per_day || 0));
  return { days, earned, net: earned - wh.tax, tax: wh.tax, taxEstimate: wh.estimate, advance, advPer, advDays: advDays ? advDays.slice(0, advCount) : null, advCount, phase, wdDates };
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

// 長期間の支出: start_ym〜end_ym の月だけ（空なら始まり・終わりなし）
function simLongActive(r, ym) {
  return (!r.start_ym || r.start_ym <= ym) && (!r.end_ym || r.end_ym >= ym);
}
function simLongRangeLabel(r) {
  const f = v => v ? `${Number(v.slice(0, 4)) !== new Date().getFullYear() ? v.slice(0, 4) + '年' : ''}${Number(v.slice(5, 7))}月` : '';
  if (!r.start_ym && !r.end_ym) return '毎月';
  return `${f(r.start_ym) || '今'}〜${f(r.end_ym) || ''}`;
}

// 旅行のうち、その月に払う分: 事前に払うもの（払う日の月）＋ 旅行中に使うもの（旅行の日数で割って、その月に入る日の分）
function simTripMonth(trip, ym) {
  const events = [];
  for (const it of (trip.prepaid || [])) {
    if (it.date && it.date.slice(0, 7) === ym && Number(it.amount)) {
      events.push({ date: it.date, label: `${trip.name}・${it.name || '事前払い'}`, amount: Number(it.amount), kind: 'prepaid' });
    }
  }
  const onsite = (trip.onsite || []).reduce((t, it) => t + (Number(it.amount) || 0), 0);
  if (onsite && trip.start_date && trip.end_date) {
    const days = [];
    for (let d = new Date(trip.start_date + 'T00:00:00'); ; d.setDate(d.getDate() + 1)) {
      const ds = dateStr(d.getFullYear(), d.getMonth(), d.getDate());
      if (ds > trip.end_date) break;
      days.push(ds);
    }
    const base = Math.floor(onsite / days.length);
    days.forEach((ds, i) => {
      if (ds.slice(0, 7) !== ym) return;
      const amt = i === days.length - 1 ? onsite - base * (days.length - 1) : base;
      if (amt) events.push({ date: ds, label: `${trip.name}・旅行中`, amount: amt, kind: 'onsite' });
    });
  }
  return { amount: events.reduce((t, e) => t + e.amount, 0), events };
}

// 貯金の目標: 今たまっている額に、今月から毎月の「貯金に回す」を月末ごとに足していく
//   → { months: [{ ym, end, saved }], reachYm, deadlineSaved, needPerMonth, monthsLeft }
// 貯金の目標（複数）: 目標ごとに「毎月の額」を積み立てる。届いたらその目標は止まる。余りが足りない月は上の目標から順に
//   その月の「貯金に回す」= 目標への積み立ての合計 ＋ 目標以外の貯金（月の計画の saving）
//   → { alloc: { ym: { per: {id: 額}, goalsTotal, extra } }, months: [{ ym, end, per: {id: その月末の額}, total }], stats: { id: {...} } }
// 目標の毎月の額。空（null）なら「目標まで残り ÷ 今月（開始月が先ならその月）〜期限の月数」（100円単位で切り上げ）。期限もなければ0
// 期限の月のうち積み立てに数える割合。日にち（deadline_date）があれば 日にち ÷ その月の日数、なければ月末まで（1）
// 支出のための目標（expense_ref あり）は、支払いの月は積み立てず前の月までに貯める（0）
function simGoalDeadlineFrac(g) {
  if (g.expense_ref) return 0;
  if (!g.deadline_date) return 1;
  const y = Number(g.deadline_date.slice(0, 4)), m = Number(g.deadline_date.slice(5, 7));
  return Number(g.deadline_date.slice(8, 10)) / new Date(y, m, 0).getDate();
}
// 期限の表示: 日にちがあれば「1月10日」、なければ「1月」
function simGoalDeadlineLabel(g) {
  return g.deadline_date ? `${simYmLabel(g.deadline_ym)}${Number(g.deadline_date.slice(8, 10))}日` : simYmLabel(g.deadline_ym);
}
// 期限までの月数。期限の月は日割り（1月10日なら 10/31 か月）なので小数になることがある
function simGoalMonthsLeft(g, fromYm = ymKey(new Date())) {
  if (!g.deadline_ym) return null;
  if (g.start_ym && g.start_ym > fromYm) fromYm = g.start_ym;  // 開始月より前は数えない
  if (g.deadline_ym < fromYm) return null;
  return (Number(g.deadline_ym.slice(0, 4)) - Number(fromYm.slice(0, 4))) * 12 + (Number(g.deadline_ym.slice(5, 7)) - Number(fromYm.slice(5, 7))) + simGoalDeadlineFrac(g);
}
// 「3か月」「2か月と10日」の形
function simGoalMonthsLeftLabel(g) {
  const n = simGoalMonthsLeft(g);
  if (n == null) return '';
  const full = Math.floor(n + 1e-9);
  if (n - full < 1e-9) return `${full}か月`;
  const day = Number(g.deadline_date.slice(8, 10));
  return full ? `${full}か月と${day}日` : `${day}日`;
}
// fromYm の月から期限まで、savedNow からの残りを割った毎月の額（前の月までの不足分も自然に上乗せされる）
function simGoalPaceAt(g, fromYm, savedNow) {
  const n = simGoalMonthsLeft(g, fromYm);
  return n ? Math.max(0, Math.ceil((g.target_amount - savedNow) / n / 100) * 100) : null;
}
function simGoalPace(g) {
  return simGoalPaceAt(g, ymKey(new Date()), g.saved_amount || 0);
}
function simGoalMonthly(g) {
  return g.monthly_amount != null ? g.monthly_amount : (simGoalPace(g) ?? 0);
}
const simGoalIsAuto = g => g.monthly_amount == null;

function simGoalsPlan(maxMonths = 36) {
  if (!_simGoals.length) return null;
  if (_simGoalCache) return _simGoalCache;
  const saved = {}, stats = {};
  for (const g of _simGoals) {
    saved[g.id] = g.saved_amount || 0;
    stats[g.id] = { reachYm: saved[g.id] >= g.target_amount ? 'now' : null };
  }
  const alloc = {}, months = [];
  let extraTotal = 0;
  const d = new Date(); d.setDate(1);
  const nowYm = ymKey(d);
  for (let k = 0; k < maxMonths; k++) {
    const ym = ymKey(d);
    // 支出のための目標: 支払いの月は、前の月までに貯めた分（目標額まで）で払う → その月の必要な額から引く
    const usedPer = {};
    for (const g of _simGoals) if (g.expense_ref && g.deadline_ym === ym) usedPer[g.id] = Math.min(saved[g.id], g.target_amount);
    const used = Object.values(usedPer).reduce((t, v) => t + v, 0);
    let left = simCalc(ym, true, used).room;
    const per = {}, wants = {};
    for (const g of _simGoals) {
      const pastDeadline = g.deadline_ym && ym > g.deadline_ym;  // 期限を過ぎた月は積み立てない
      const notStarted = g.start_ym && ym < g.start_ym;          // 開始月より前も積み立てない
      // 自動の目標は月ごとに割り直す（足りなかった月の分を翌月以降に上乗せ）。毎月の額を決めた目標は固定
      const monthly = simGoalIsAuto(g) ? (simGoalPaceAt(g, ym, saved[g.id]) ?? 0) : g.monthly_amount;
      // 期限の月は日割り（1月10日が期限なら、その月の額の 10/31）
      const share = ym === g.deadline_ym ? Math.round(monthly * simGoalDeadlineFrac(g)) : monthly;
      const want = pastDeadline || notStarted ? 0 : Math.min(share, Math.max(0, g.target_amount - saved[g.id]));
      const give = Math.min(want, left);
      per[g.id] = give; wants[g.id] = want; left -= give; saved[g.id] += give;
      if (!stats[g.id].reachYm && saved[g.id] >= g.target_amount) stats[g.id].reachYm = ym;
      if (give < want) stats[g.id].shortYm ||= ym;   // 余りが足りず、毎月の額を積み立てられなかった最初の月
    }
    for (const id in usedPer) saved[id] -= usedPer[id];  // 払ったので、その目標の貯金は減る
    const extra = Math.min(simMonthPlan(ym).saving ?? 0, left);
    extraTotal += extra;
    const goalsTotal = Object.values(per).reduce((t, v) => t + v, 0);
    alloc[ym] = { per, wants, goalsTotal, extra, used, usedPer };
    months.push({ ym, end: dateStr(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()), per: { ...saved }, total: Object.values(saved).reduce((t, v) => t + v, 0) + extraTotal });
    d.setMonth(d.getMonth() + 1);
  }
  for (const g of _simGoals) {
    const st = stats[g.id];
    if (g.deadline_ym && g.deadline_ym >= nowYm) {
      st.needPerMonth = simGoalPace(g);
      st.deadlineOk = st.reachYm === 'now' || (!!st.reachYm && st.reachYm <= g.deadline_ym);
    }
  }
  return (_simGoalCache = { alloc, months, stats, startTotal: _simGoals.reduce((t, g) => t + (g.saved_amount || 0), 0) });
}
// その日の終わりの貯金（使っちゃいけないお金）。今日〜月末は今の額、月末ごとにその月の貯金が足される
// その日の終わりの貯金の合計（使っちゃいけないお金）。月末ごとにその月の積み立てが足される
function simGoalSavedAt(plan, ds) {
  if (!plan) return null;
  let v = plan.startTotal;
  for (const m of plan.months) { if (m.end <= ds) v = m.total; else break; }
  return v;
}
function simYmLabel(ym) {
  const y = Number(ym.slice(0, 4));
  return `${y !== new Date().getFullYear() ? y + '年' : ''}${Number(ym.slice(5, 7))}月`;
}

// 月の計算結果。noGoals=true は目標の計算用（貯金の分け方を決める前の「余り」だけ欲しいとき）
// goalUsed: 支出のための目標で、この月に貯めた分から払う額（目標の計算の中から渡す。ふだんは simGoalsPlan から読む）
function simCalc(ym, noGoals = false, goalUsed = null) {
  const d = simYmToDate(ym);
  const y = d.getFullYear(), m = d.getMonth();
  const plan = simMonthPlan(ym);
  const prevPlan = simMonthPlan(simPrevYm(ym));
  const sum = arr => arr.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const planned      = simPlannedTotal(y, m);
  const recurringExp = sum(_simRecurring.filter(r => r.kind === 'expense' && simLongActive(r, ym)));
  // 旅行
  const tripMonths = _simTrips.map(t => ({ trip: t, ...simTripMonth(t, ym) })).filter(t => t.amount);
  const tripExp = tripMonths.reduce((t, x) => t + x.amount, 0);
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
  // この月に入るお金の明細 { name, note, day, amount, fromPrev }
  const pm = simYmToDate(simPrevYm(ym)).getMonth() + 1, cm = m + 1;
  const cashRows = [];
  const pushRow = (row) => { if (row.amount) cashRows.push({ account: SIM_DEFAULT_ACCOUNT, ...row }); };
  for (const job of _simJobs) {
    const cur = simJobMonth(job, plan.workDays, ym);
    jobMonths[job.id] = cur;
    workDays   += cur.days;
    workIncome += cur.net;
    // 実際にこの月に入るお金: 日払いはその月、残り（差額）は給料日に入る（翌月払いなら前の月に働いた分）
    // 源泉徴収は給料日の支払いから引かれる
    const taxNote = t => t ? `・源泉 −${yen(t)}` : '';
    if (job.pay_timing === 'same') {
      paidWage += cur.net; withheld += cur.tax;
      pushRow({ name: job.name, note: `${cm}月に働いた分${taxNote(cur.tax)}`, day: job.pay_day, amount: cur.net, fromPrev: false, account: job.settings?.account || SIM_DEFAULT_ACCOUNT });
    } else {
      const prev = simJobMonth(job, prevPlan.workDays, simPrevYm(ym));
      paidWage += cur.advance + (prev.net - prev.advance);
      withheld += prev.tax;
      if (cur.advDays) {
        for (const dd of cur.advDays) pushRow({ name: job.name, note: '日払い', day: dd, amount: cur.advPer, fromPrev: false, account: SIM_ADVANCE_ACCOUNT });
      } else {
        pushRow({ name: job.name, note: `日払い（${cm}月・${cur.advCount}日）`, day: null, amount: cur.advance, fromPrev: false, account: SIM_ADVANCE_ACCOUNT });
      }
      pushRow({ name: job.name, note: `${pm}月に働いた分${prev.advance ? '（日払いの残り）' : ''}${taxNote(prev.tax)}`, day: job.pay_day, amount: prev.net - prev.advance, fromPrev: true, account: job.settings?.account || SIM_DEFAULT_ACCOUNT });
    }
  }
  // 出勤した日の数（カレンダーで選んだ日は、同じ日に2つ働いても1日として数える）
  const datedDays = new Set();
  let undatedDays = 0;
  for (const job of _simJobs) {
    const jm = jobMonths[job.id];
    if (jm.wdDates) jm.wdDates.forEach(d => datedDays.add(d)); else undatedDays += jm.days;
  }
  workDays = datedDays.size + undatedDays;
  // 臨時収入（短期バイトなど）に日数が入っていれば出勤日に数える
  workDays += plan.items.reduce((s, it) => s + (it.kind === 'income' ? (Number(it.days) || 0) : 0), 0);

  if (goalUsed == null) goalUsed = noGoals || !_simGoals.length ? 0 : (simGoalsPlan()?.alloc[ym]?.used || 0);
  // 必要な額 = この月の収入から払う分（貯金の目標で貯めた分から払う額は引く）
  const need = planned + recurringExp + monthExp + tripExp - goalUsed;
  // 入るお金 − 必要な額 = 余り。余りを「貯金」と「自由に使えるお金」に分ける
  // 貯金の額を決めていない月は、余りを全部貯金に回したことにする
  for (const r of _simRecurring.filter(r => r.kind === 'income')) pushRow({ name: r.name, note: '毎月', day: r.day || null, amount: Number(r.amount) || 0, fromPrev: false, account: r.account || SIM_DEFAULT_ACCOUNT });
  for (const it of arriving) {
    const from = it.fromYm !== ym;
    pushRow({ name: it.name, note: from ? `${simYmToDate(it.fromYm).getMonth() + 1}月の臨時収入` : '臨時収入', day: it.pay_day || null, amount: Number(it.amount) || 0, fromPrev: from, account: it.account || SIM_DEFAULT_ACCOUNT });
  }
  const cashIncome = recurringInc + oneOffCash + paidWage;
  const leftover = cashIncome - need;
  const room = Math.max(0, leftover);
  // 貯金に回す: 目標があれば「目標への積み立て＋目標以外の貯金」、なければ月の計画の額（決めていなければ余りを全部）
  let saving, goalAlloc = null;
  if (_simGoals.length) {
    goalAlloc = noGoals ? null : simGoalsPlan()?.alloc[ym] || null;
    saving = goalAlloc ? goalAlloc.goalsTotal + goalAlloc.extra : Math.min(plan.saving ?? 0, room);
  } else {
    saving = plan.saving == null ? room : Math.min(plan.saving, room);
  }
  const free = room - saving;
  return {
    leftover, room, saving, free, savingSet: plan.saving != null, goalAlloc, tripMonths, tripExp, goalUsed,
    ym, plan, planned, need, jobMonths,
    otherIncome, workDays, workIncome,
    income: otherIncome + workIncome,          // 働いた月で数えた収入（計画用）
    cashIncome,                                // 実際にこの月に入る収入（推移用・源泉徴収を引いた後）
    arriving, cashRows,
    withheld,                                  // この月の支払いから引かれる源泉徴収
    daysInMonth: new Date(y, m + 1, 0).getDate(),
  };
}

async function simSaveMonth(ym, plan) {
  const row = { year_month: ym, items: plan.items, work_days: plan.workDays, saving: plan.saving ?? null, updated_at: new Date().toISOString() };
  _simMonths[ym] = row;
  _simGoalCache = null;
  const { error } = await db.from('sim_months').upsert(row);
  if (error) alert('保存に失敗しました: ' + error.message);
}

async function renderSim() {
  if (!_simInited) { initSim(); _simInited = true; }
  await loadSimData();
  const sub = document.querySelector('.sim-sub-btn.active')?.dataset.sub;
  if (sub === 'trend')        await renderSimTrend();
  else if (sub === 'planned') await renderPlannedTab();
  else                        await renderSimMonth();
}

// 月の切り替え（＜ ○月 ＞）を、上のタブの下に固定する。上に固定されている部品の高さを測って位置を決める
function simUpdateStickyTop() {
  let top = 0;
  for (const el of document.querySelectorAll('.header, .pc-app-nav, .nav')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || !['sticky', 'fixed'].includes(cs.position) || cs.top === 'auto') continue;
    top = Math.max(top, parseFloat(cs.top) + el.offsetHeight);
  }
  document.getElementById('tab-sim').style.setProperty('--sim-sticky-top', top + 'px');
}

async function renderSimMonth() {
  simUpdateStickyTop();
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
    ? `予定支出から自動で計算（${confirmedCount}件は金額確定済み）`
    : '予定支出から自動で計算';

  // 出勤日・休み
  const off = Math.max(0, c.daysInMonth - c.workDays);
  document.getElementById('sim-work-days').textContent = c.workDays;
  document.getElementById('sim-off-days').textContent  = off;
  document.getElementById('sim-days-fill').style.width = Math.min(100, c.workDays / c.daysInMonth * 100) + '%';
  renderSimHint(c, c.income - c.need, off);

  renderSimCalendar(c);
  renderSimJobs(c);
  renderSimItems(c);

  renderSimUse(c);
}

// 余りの使い道（貯金に回す額 → 残りが自由に使えるお金）
function renderSimUse(c) {
  const el = document.getElementById('sim-use');
  if (c.leftover < 0) {
    el.innerHTML = `
      <div class="sim-use-title"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> 余りの使い道</div>
      <div class="sim-use-short">この月は ${yen(c.leftover)} 足りません</div>
      <div class="sim-row-sub">貯金から出すか、上の「収入」を増やす必要があります。自由に使えるお金・貯金はどちらも ¥0 です。</div>`;
    return;
  }
  const perDay = Math.floor(c.free / c.daysInMonth);
  // 目標があるときのスライダーは「目標以外の貯金」（目標への積み立てを引いた残りの範囲）
  const goalsTotal = c.goalAlloc?.goalsTotal || 0;
  const sliderMax = c.room - goalsTotal, sliderVal = c.saving - goalsTotal;
  el.innerHTML = `
    <div class="sim-use-title"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> 余りの使い道</div>
    <div class="sim-use-formula">入るお金 ${yen(c.cashIncome)} − 必要な額 ${yen(c.need)} ＝ <b>余り ${yen(c.leftover)}</b></div>
    ${c.goalUsed ? `<div class="sim-row-sub"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 貯めた分から払う ${yen(c.goalUsed)} は、必要な額から引いています</div>` : ''}
    <div class="sim-use-split">
      <div class="sim-use-box sim-use-free">
        <div class="sim-use-label">自由に使えるお金</div>
        <div class="sim-use-value">${yen(c.free)}</div>
        <div class="sim-row-sub">1日あたり ${yen(perDay)}</div>
      </div>
      <div class="sim-use-box sim-use-save">
        <div class="sim-use-label">貯金に回す</div>
        <div class="sim-use-value">${yen(c.saving)}</div>
        <div class="sim-row-sub">${c.goalAlloc ? `目標 ${yen(c.goalAlloc.goalsTotal)}＋目標以外 ${yen(c.goalAlloc.extra)}` : c.savingSet ? `余りの ${c.leftover ? Math.round(c.saving / c.leftover * 100) : 0}%` : '未設定（余りを全部貯金）'}</div>
      </div>
    </div>
    ${simGoalAllocHtml(c)}
    <div class="sim-use-actions">
      ${c.goalAlloc ? '<span class="sim-row-sub sim-extra-label">目標以外の貯金</span>' : ''}
      <input type="range" class="sim-use-range" id="sim-saving-range" min="0" max="${sliderMax}" step="1000" value="${sliderVal}" title="貯金に回す額">
      <div class="sim-stepper">
        <button data-saving-step="-5000" title="5,000円減らす">−</button>
        <input type="number" id="sim-saving-input" min="0" max="${sliderMax}" step="1000" value="${sliderVal}" inputmode="numeric">
        <button data-saving-step="5000" title="5,000円増やす">＋</button>
      </div>
    </div>`;

  const range = document.getElementById('sim-saving-range');
  // ドラッグ中は数字だけ書き換える（描き直すとつまみが離れてしまうため）。離したら保存
  range.addEventListener('input', () => {
    const extra = Number(range.value), save = goalsTotal + extra, free = c.room - save;
    el.querySelector('.sim-use-save .sim-use-value').textContent = yen(save);
    el.querySelector('.sim-use-free .sim-use-value').textContent = yen(free);
    el.querySelector('.sim-use-free .sim-row-sub').textContent = `1日あたり ${yen(Math.floor(free / c.daysInMonth))}`;
    document.getElementById('sim-saving-input').value = extra;
  });
  range.addEventListener('change', () => simSetSaving(Number(range.value), true));
  document.getElementById('sim-saving-input').addEventListener('change', e => simSetSaving(Number(e.target.value) || 0, true));
  el.querySelectorAll('[data-saving-step]').forEach(btn => {
    btn.addEventListener('click', () => simSetSaving(sliderVal + Number(btn.dataset.savingStep)));
  });
  el.querySelectorAll('[data-goal-edit]').forEach(r => r.addEventListener('click', () => openSimGoalModal(r.dataset.goalEdit)));
}

// 目標の期限に間に合う毎月の額を、余りの使い道に出す
// 余りの使い道に出す、目標ごとのこの月の積み立て
function simGoalAllocHtml(c) {
  if (!c.goalAlloc) return '';
  const rows = _simGoals.filter(g => !(g.deadline_ym && (c.ym > g.deadline_ym || (g.expense_ref && c.ym === g.deadline_ym))) && !(g.start_ym && c.ym < g.start_ym)).map(g => {
    const amt  = c.goalAlloc.per[g.id] || 0;
    const want = c.goalAlloc.wants?.[g.id] || 0;
    const prevSaved = simGoalsPlan().months.find(m => m.ym === simPrevYm(c.ym))?.per[g.id] ?? g.saved_amount ?? 0;
    const note = amt < want
      ? '<span class="sim-neg">（余りが足りない）</span>'
      : prevSaved >= g.target_amount ? '<span class="sim-save">（達成ずみ）</span>' : '';
    // 自動はこの月に割り直した額（前の月までの不足分を上乗せしていれば「上乗せ」と出す）
    const monthly = simGoalIsAuto(g) ? want : simGoalMonthly(g);
    const autoNote = !simGoalIsAuto(g) ? '' : want > (simGoalPace(g) ?? 0) ? '（自動・不足分を上乗せ）' : '（自動）';
    const rank = _simGoals.length > 1 ? ('①②③④⑤⑥⑦⑧⑨⑩'[_simGoals.indexOf(g)] || '') : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';
    return `<div class="sim-goal-alloc-row" data-goal-edit="${g.id}"><span>${rank} ${escapeHtmlF(g.name)}${note}</span><span>${yen(amt)}<span class="sim-row-sub"> / 毎月${yen(monthly)}${autoNote}</span></span></div>`;
  }).join('');
  return `<div class="sim-goal-alloc">${rows}</div>`;
}

function simSetSaving(val, saveNow = false) {
  const ym = ymKey(_simMonth);
  const plan = simMonthPlan(ym);
  const c = simCalc(ym);
  const max = Math.max(0, c.room - (c.goalAlloc?.goalsTotal || 0));
  plan.saving = Math.max(0, Math.min(max, val));
  _simMonths[ym] = { year_month: ym, items: plan.items, work_days: plan.workDays, saving: plan.saving };
  _simGoalCache = null;
  renderSimMonth();
  clearTimeout(_simSaveTimers[ym]);
  _simSaveTimers[ym] = setTimeout(() => simSaveMonth(ym, plan), saveNow ? 0 : 600);
}

// 予定支出（月別）をシミュの上にモーダルで開く。予定支出タブの #sub-monthly をそのまま中へ移して使い、閉じたら戻す
async function openSimPlannedModal() {
  const monthly = document.getElementById('sub-monthly');
  document.getElementById('sim-planned-body').appendChild(monthly);
  monthly.hidden = false;
  _plannedMonth = new Date(_simMonth);
  document.getElementById('sim-planned-modal').hidden = false;
  await renderPlannedTab();
}

async function closeSimPlannedModal() {
  const monthly = document.getElementById('sub-monthly');
  document.getElementById('sub-subscriptions').before(monthly);
  monthly.hidden = (document.querySelector('.sub-nav-btn.active')?.dataset.sub || 'monthly') !== 'monthly';
  document.getElementById('sim-planned-modal').hidden = true;
  // 予定支出で変えた金額をシミュに反映
  await loadSimData();
  await renderSimMonth();
}

// 「この月に入るお金」の明細（日にち順）
function openSimCashModal() {
  const c = simCalc(ymKey(_simMonth));
  simShowBreakdown(`${_simMonth.getMonth() + 1}月に入るお金`, c.cashRows, c.cashIncome, 'この月に入るお金はありません');
}

// 「必要な額」の明細: 予定支出（サブスク・ローンなど）・長期間・この月だけ・旅行
function openSimNeedModal() {
  const ym = ymKey(_simMonth), c = simCalc(ym);
  const y = _simMonth.getFullYear(), m = _simMonth.getMonth();
  const rows = [];
  const { subItems, planItems, loanItems } = buildPlannedItems(_simPlannedSrc.subs, _simPlannedSrc.plans, _simPlannedSrc.loans, {}, _simAmountOverrides[ym] || {});
  const srcLabel = { subscription: 'サブスク', loan: 'ローン', planned: '予定支出' };
  for (const it of [...subItems, ...planItems, ...loanItems]) {
    if (!isActiveInMonth(it, y, m)) continue;
    rows.push({ goal: true, name: it.name, note: `${srcLabel[it.source]}${it.amountConfirmed ? '・金額確定' : it.amountMax ? '・多いほうの額' : ''}${_simPaid.has(`${ym}:${it.source}:${it.id}`) ? '・✓支払い済み' : ''}`, day: it.billingDay || null, amount: it.amountMax || it.amount });
  }
  for (const r of _simRecurring) {
    if (r.kind === 'expense' && simLongActive(r, ym)) rows.push({ goal: true, name: r.name, note: `長期間（${simLongRangeLabel(r)}）${r.day ? '' : '・日割り'}`, day: r.day || null, amount: Number(r.amount) || 0 });
  }
  for (const it of c.plan.items) {
    if (it.kind === 'expense') rows.push({ goal: true, name: it.name, note: `この月だけ${it.day ? '' : '・日割り'}`, day: it.day || null, amount: Number(it.amount) || 0 });
  }
  for (const t of c.tripMonths) for (const e of t.events.filter(e => e.kind === 'prepaid')) {
    rows.push({ trip: t.trip, name: e.label, note: '旅行・事前払い', day: Number(e.date.slice(8, 10)), amount: e.amount });
  }
  for (const t of c.tripMonths) {
    const on = t.events.filter(e => e.kind === 'onsite');
    if (on.length) rows.push({ trip: t.trip, name: `${t.trip.name}・旅行中`, note: `旅行中 ${on.length}日分（${Number(on[0].date.slice(8, 10))}日〜）`, day: Number(on[0].date.slice(8, 10)), amount: on.reduce((x, e) => x + e.amount, 0) });
  }
  // 目標にできる行: 「🎯 目標にする」（もう目標があれば「🎯 目標あり」）
  // 旅行は、同じ月の項目（交通費・食事代・旅行中など）をまとめて1つの目標（ボタンはその月の最初の行にだけ出す）
  const tripShown = new Set();
  for (const r of rows.sort((a, b) => (a.day ?? 99) - (b.day ?? 99))) {
    if (r.trip) {
      if (tripShown.has(r.trip.id)) continue;
      tripShown.add(r.trip.id);
      r.ref = `${ym}|trip:${r.trip.id}`;
      r.tripMonth = c.tripMonths.find(t => t.trip.id === r.trip.id);
    } else if (r.goal) {
      r.ref = `${ym}|${r.name}|${r.day || ''}`;
    } else continue;
    const g = [..._simGoals, ..._simGoalsDone].find(x => x.expense_ref === r.ref);
    r.btn = g
      ? `<button type="button" class="sim-goal-from-btn is-set" data-goal-open="${g.id}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 目標あり</button>`
      : `<button type="button" class="sim-goal-from-btn" data-goal-from="${escapeHtmlF(r.ref)}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> ${r.trip ? `${m + 1}月の${escapeHtmlF(r.trip.name)}の分（${yen(r.tripMonth.amount)}）を目標にする` : '目標にする'}</button>`;
  }
  if (c.goalUsed) {
    const usedPer = simGoalsPlan()?.alloc[ym]?.usedPer || {};
    const names = _simGoals.filter(g => usedPer[g.id]).map(g => g.name).join('・');
    rows.push({ name: '貯めた分から払う', note: names, day: 100, amount: -c.goalUsed });
  }
  simShowBreakdown(`${m + 1}月に必要な額`, rows.filter(r => r.amount), c.need, 'この月に必要な支出はありません');
  const list = document.getElementById('sim-cash-list');
  list.querySelectorAll('[data-goal-from]').forEach(btn => btn.addEventListener('click', () => {
    const r = rows.find(x => x.ref === btn.dataset.goalFrom);
    document.getElementById('sim-cash-modal').hidden = true;
    openSimGoalFromExpense(r, y, m);
  }));
  list.querySelectorAll('[data-goal-open]').forEach(btn => btn.addEventListener('click', () => {
    document.getElementById('sim-cash-modal').hidden = true;
    openSimGoalModal(btn.dataset.goalOpen);
  }));
}

// 支出から貯金の目標を作る: 名前・目標額・期限（払う日。日にちがなければ月末）を入れて目標の画面を開く
//   旅行はその月の分をまとめて: 目標額はこの月の旅行の合計、期限はこの月で最初に払う日
function openSimGoalFromExpense(r, y, m) {
  openSimGoalModal();
  const f = document.getElementById('sim-goal-form');
  f.elements.name.value = r.trip ? `${r.trip.name}（${m + 1}月の分）` : r.name;
  f.elements.target.value = r.trip ? r.tripMonth.amount : r.amount;
  f.elements.deadline.value = dateStr(y, m, Math.min(r.day || 99, new Date(y, m + 1, 0).getDate()));
  f.elements.expenseRef.value = r.ref;
  document.getElementById('sim-goal-title').innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 支出のために貯める';
  simUpdateGoalPaceNote();
}

// 明細のモーダル（日にち順。日にちのないものは最後）
function simShowBreakdown(title, list, total, emptyMsg) {
  const rows = [...list].sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  document.getElementById('sim-cash-title').textContent = title;
  document.getElementById('sim-cash-list').innerHTML = rows.length ? rows.map(r => `
    <div class="sim-row">
      <div>
        <div class="sim-row-name">${escapeHtmlF(r.name)}</div>
        <div class="sim-row-sub">${r.day && r.day <= 31 ? `${r.day}日 ・ ` : ''}${escapeHtmlF(r.note)}</div>
        ${r.btn || ''}
      </div>
      <span class="sim-row-amount">${r.amount < 0 ? '−' : ''}${yen(r.amount)}</span>
    </div>`).join('') : `<p class="sim-empty">${emptyMsg}</p>`;
  document.getElementById('sim-cash-total').textContent = yen(total);
  document.getElementById('sim-cash-modal').hidden = false;
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
    return { job: j, pay: simHourlyDayPay(j, training), unit: '日', label: escapeHtmlF(j.name), key: String(j.id), cur: jm.days, noBtn: !!jm.wdDates };
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
        ${u.noBtn ? '' : `<button class="sim-hint-btn" data-key="${u.key}" data-val="${u.cur + n}">${u.cur + n}${u.unit}にする</button>`}</div>`;
    }).join('');
    hint.innerHTML = `<div class="sim-hint-head sim-short">この働き方を毎月続けると あと ${yen(diff)} 足りません</div>${lines}`;
  } else {
    const lines = units.map(u => {
      const n = Math.min(u.cur, Math.floor(diff / u.pay));
      // 減らせないときも行は残す（0のときは理由を出す）
      if (n <= 0) {
        const why = u.cur === 0 ? `今は0${u.unit}です` : `減らすと足りなくなります`;
        return `<div class="sim-hint-line"><span>${u.label}は <b>0${u.unit}</b>しか減らせません（${why}）</span></div>`;
      }
      const offNote = u.unit === '日' ? `（休みは${off + n}日）` : '';
      return `<div class="sim-hint-line"><span>${u.label}を <b>${n}${u.unit}減らしても</b>足ります${offNote}</span>
        ${u.noBtn ? '' : `<button class="sim-hint-btn" data-key="${u.key}" data-val="${u.cur - n}">${u.cur - n}${u.unit}にする</button>`}</div>`;
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

  wrap.innerHTML = _simJobs.map(j => {
    const jm = c.jobMonths[j.id];
    const s = j.settings || {};
    const payLabel = (j.pay_timing === 'same' ? '当月' : '翌月') + (j.pay_day ? `${j.pay_day}日` : '') + '払い';
    let detail = '', body = '';
    if (j.job_type === 'koma') {
      const rates = simKomaRates(j), lens = simKomaLengths(j);
      detail = `コマ制${j.transport_per_day ? `・交通費 1日${yen(j.transport_per_day)}` : ''}`;
      // 時給をタップ → 生徒ごとのコマ数。生徒が入っているマスは生徒の合計になるので直接は打てない
      const komaTable = (kind, payFn) => `
        <table class="sim-koma-table">
          <thead><tr><th></th>${lens.map(l => `<th>${l}分</th>`).join('')}</tr></thead>
          <tbody>${rates.map(r => `<tr><th><button type="button" class="sim-koma-rate" data-job="${j.id}" data-kind="${kind}" data-rate="${r}">${r.toLocaleString()}円</button></th>${lens.map(l => {
            const key = `${j.id}:${kind}:${r}-${l}`;
            const byStudent = simKomaStudentSum(wd, j.id, kind, r, l) > 0;
            return `<td><input type="number" min="0" value="${Number(wd[key]) || 0}" data-key="${key}" inputmode="numeric" title="1コマ ${yen(payFn(r, l))}"${byStudent ? ` readonly class="sim-koma-by-student" data-job="${j.id}" data-kind="${kind}" data-rate="${r}"` : ''}></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table>`;
      const perStudent = simKomaStudentTotals(j, wd, 'k');
      body = `
        ${komaTable('k', simKomaPay)}
        <div class="sim-row-sub">合計 ${jm.komaCount}コマ${perStudent.length ? `（${perStudent.map(s => `${escapeHtmlF(s.name)} ${s.count}`).join('・')}）` : ''}</div>
        <details class="sim-koma-cancel"${jm.cancelCount ? ' open' : ''}>
          <summary>当日キャンセル（0.6倍）${jm.cancelCount ? ` ${jm.cancelCount}コマ・${yen(jm.cancelPay)}` : ''}</summary>
          ${komaTable('c', simKomaCancelPay)}
        </details>
        ${simJobDaysLine(j, jm, wd)}`;
    } else {
      const phase = jm.phase;
      const wageText = phase === 'training' ? `研修中 時給${yen(s.training_wage)}`
                     : phase === 'both'     ? `研修中 ${yen(s.training_wage)} → ${yen(j.hourly_wage)}`
                     : `時給${yen(j.hourly_wage)}`;
      detail = `${wageText} × ${Number(j.hours_per_day)}時間${j.transport_per_day ? ` ＋ 交通費${yen(j.transport_per_day)}` : ''}`;
      body = simJobDaysLine(j, jm, wd);
      if (jm.advance > 0) {
        body += `<div class="sim-row-sub">日払いで ${yen(jm.advance)} → 残り ${yen(jm.net - jm.advance)} は${payLabel.replace('払い', '')}に受け取り</div>`;
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

  wrap.querySelectorAll('input[data-key]:not([readonly])').forEach(inp => {
    inp.addEventListener('change', () => simSetWork(inp.dataset.key, Number(inp.value) || 0, true));
  });
  wrap.querySelectorAll('.sim-koma-rate, .sim-koma-by-student').forEach(el => {
    el.addEventListener('click', () => openSimKomaStudentModal(Number(el.dataset.job), el.dataset.kind, Number(el.dataset.rate)));
  });
  wrap.querySelectorAll('.sim-job-edit').forEach(btn => {
    btn.addEventListener('click', () => openSimJobModal(btn.dataset.id));
  });
}

// ---------- 塾（コマ制）: 生徒ごとのコマ数 ----------
// 生徒の一覧は sim_jobs.settings.students（[{id, name}]）
// 月ごとの数は work_days の `${id}:ks:${時給}`（キャンセルは `${id}:cs:${時給}`）に { 生徒id: { 分: コマ数 } }
// マスの数（`${id}:k:${時給}-${分}`）は 生徒の合計 ＋ 生徒を選ばない分。給料の計算はマスの数を使う
function simKomaStudents(job) { return job.settings?.students || []; }
function simKomaStudentMap(wd, jobId, kind, rate) { return wd[`${jobId}:${kind}s:${rate}`] || {}; }
function simKomaStudentSum(wd, jobId, kind, rate, len) {
  return Object.values(simKomaStudentMap(wd, jobId, kind, rate)).reduce((s, c) => s + (Number(c[len]) || 0), 0);
}
// その月の生徒ごとの合計コマ数（多い順）
function simKomaStudentTotals(job, wd, kind) {
  const totals = {};
  for (const r of simKomaRates(job)) {
    for (const [sid, c] of Object.entries(simKomaStudentMap(wd, job.id, kind, r))) {
      totals[sid] = (totals[sid] || 0) + Object.values(c).reduce((s, n) => s + (Number(n) || 0), 0);
    }
  }
  return simKomaStudents(job).filter(s => totals[s.id] > 0)
    .map(s => ({ name: s.name, count: totals[s.id] }))
    .sort((a, b) => b.count - a.count);
}

let _simKomaEdit = null;  // 生徒ごとのコマ数モーダルで編集中の内容

function openSimKomaStudentModal(jobId, kind, rate) {
  const job = _simJobs.find(j => String(j.id) === String(jobId));
  if (!job) return;
  const wd = simMonthPlan(ymKey(_simMonth)).workDays;
  const map = simKomaStudentMap(wd, jobId, kind, rate);
  const lens = simKomaLengths(job);
  const rows = simKomaStudents(job).filter(s => map[s.id])
    .map(s => ({ sid: s.id, name: s.name, counts: { ...map[s.id] } }));
  const other = {};
  for (const l of lens) other[l] = Math.max(0, (Number(wd[`${jobId}:${kind}:${rate}-${l}`]) || 0) - simKomaStudentSum(wd, jobId, kind, rate, l));
  _simKomaEdit = { job, kind, rate, lens, rows, other, newStudents: [] };
  document.getElementById('sim-koma-student-title').textContent =
    `${kind === 'c' ? '当日キャンセル ' : ''}${rate.toLocaleString()}円のコマ（生徒ごと）`;
  renderSimKomaStudentModal();
  document.getElementById('sim-koma-student-modal').hidden = false;
}

function renderSimKomaStudentModal() {
  const { job, kind, rate, lens, rows, other, newStudents } = _simKomaEdit;
  const payFn = kind === 'c' ? simKomaCancelPay : simKomaPay;
  const cell = (row, l) => `<td><input type="number" min="0" inputmode="numeric" value="${Number(row === 'other' ? other[l] : row.counts[l]) || 0}" data-row="${row === 'other' ? 'other' : row.sid}" data-len="${l}"></td>`;
  document.getElementById('sim-koma-student-body').innerHTML = `
    <table class="sim-koma-table sim-koma-student-table">
      <thead><tr><th></th>${lens.map(l => `<th>${l}分<br><span>${yen(payFn(rate, l))}</span></th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><th>${escapeHtmlF(r.name)}</th>${lens.map(l => cell(r, l)).join('')}<td><button type="button" class="sim-koma-student-del" data-sid="${r.sid}" aria-label="外す">×</button></td></tr>`).join('')}
        <tr class="sim-koma-other"><th>生徒を<br>選ばない分</th>${lens.map(l => cell('other', l)).join('')}<td></td></tr>
      </tbody>
      <tfoot><tr><th>合計</th>${lens.map(l => `<td id="sim-koma-student-total-${l}"></td>`).join('')}<td></td></tr></tfoot>
    </table>
    <div class="sim-koma-student-sum" id="sim-koma-student-sum"></div>`;
  // 追加の候補: 登録済みでこの表にまだいない生徒
  const inTable = new Set(rows.map(r => r.sid));
  document.getElementById('sim-koma-student-list').innerHTML = [...simKomaStudents(job), ...newStudents]
    .filter(s => !inTable.has(s.id)).map(s => `<option value="${escapeHtmlF(s.name)}">`).join('');
  updateSimKomaStudentTotals();

  const body = document.getElementById('sim-koma-student-body');
  body.querySelectorAll('input[data-row]').forEach(inp => {
    inp.addEventListener('input', () => {
      const n = Math.max(0, Math.min(999, Number(inp.value) || 0));
      if (inp.dataset.row === 'other') other[inp.dataset.len] = n;
      else rows.find(r => r.sid === inp.dataset.row).counts[inp.dataset.len] = n;
      updateSimKomaStudentTotals();
    });
  });
  body.querySelectorAll('.sim-koma-student-del').forEach(btn => {
    btn.addEventListener('click', () => {
      _simKomaEdit.rows = rows.filter(r => r.sid !== btn.dataset.sid);
      renderSimKomaStudentModal();
    });
  });
}

function updateSimKomaStudentTotals() {
  const { kind, rate, lens, rows, other } = _simKomaEdit;
  const payFn = kind === 'c' ? simKomaCancelPay : simKomaPay;
  let count = 0, pay = 0;
  for (const l of lens) {
    const n = rows.reduce((s, r) => s + (Number(r.counts[l]) || 0), 0) + (Number(other[l]) || 0);
    document.getElementById(`sim-koma-student-total-${l}`).textContent = n;
    count += n;
    pay += n * payFn(rate, l);
  }
  document.getElementById('sim-koma-student-sum').textContent = `合計 ${count}コマ・${yen(pay)}`;
}

// 名前を入れて「追加」: 登録済みの生徒ならその生徒、なければ新しい生徒（保存のときに登録）
function addSimKomaStudentRow() {
  const inp = document.getElementById('sim-koma-student-name');
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  const ed = _simKomaEdit;
  let s = [...simKomaStudents(ed.job), ...ed.newStudents].find(x => x.name === name);
  if (!s) {
    s = { id: 's' + Date.now().toString(36), name };
    ed.newStudents.push(s);
  }
  if (!ed.rows.some(r => r.sid === s.id)) ed.rows.push({ sid: s.id, name: s.name, counts: {} });
  inp.value = '';
  renderSimKomaStudentModal();
}

async function saveSimKomaStudents() {
  const { job, kind, rate, lens, rows, other, newStudents } = _simKomaEdit;
  // 新しい生徒は、表に残っているものだけバイトに登録する
  const added = newStudents.filter(s => rows.some(r => r.sid === s.id));
  if (added.length) {
    const settings = { ...(job.settings || {}), students: [...simKomaStudents(job), ...added] };
    const { error } = await db.from('sim_jobs').update({ settings }).eq('id', job.id);
    if (error) { alert('生徒の登録に失敗しました: ' + error.message); return; }
    job.settings = settings;
  }
  const ym = ymKey(_simMonth);
  const plan = simMonthPlan(ym);
  const wd = { ...plan.workDays };
  const map = {};
  for (const r of rows) {
    const c = {};
    for (const l of lens) if (Number(r.counts[l]) > 0) c[l] = Number(r.counts[l]);
    if (Object.keys(c).length) map[r.sid] = c;
  }
  const mapKey = `${job.id}:${kind}s:${rate}`;
  if (Object.keys(map).length) wd[mapKey] = map; else delete wd[mapKey];
  for (const l of lens) {
    wd[`${job.id}:${kind}:${rate}-${l}`] = rows.reduce((s, r) => s + (Number(r.counts[l]) || 0), 0) + (Number(other[l]) || 0);
  }
  plan.workDays = wd;
  _simMonths[ym] = { year_month: ym, items: plan.items, work_days: wd, saving: plan.saving ?? null };
  _simGoalCache = null;
  document.getElementById('sim-koma-student-modal').hidden = true;
  renderSimMonth();
  clearTimeout(_simSaveTimers[ym]);
  await simSaveMonth(ym, plan);
}

// 出勤日のカレンダー。タップで 休み → 出勤 →（日払いがあるバイトは）出勤＋日払い → 休み と切り替わる
// 日本の祝日（振替休日・国民の休日を含む）。{ 'YYYY-MM-DD': '名前' }
const _jpHolidayCache = {};
function jpHolidays(y) {
  if (_jpHolidayCache[y]) return _jpHolidayCache[y];
  const h = {};
  const add = (m, d, name) => { h[dateStr(y, m - 1, d)] = name; };
  const nthMonday = (m, n) => { const f = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - f) % 7) + (n - 1) * 7; };
  const t = y - 1980, leap = Math.floor(t / 4);
  add(1, 1, '元日'); add(1, nthMonday(1, 2), '成人の日'); add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日');
  add(3, Math.floor(20.8431 + 0.242194 * t - leap), '春分の日'); add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日');
  add(7, nthMonday(7, 3), '海の日'); add(8, 11, '山の日'); add(9, nthMonday(9, 3), '敬老の日');
  add(9, Math.floor(23.2488 + 0.242194 * t - leap), '秋分の日'); add(10, nthMonday(10, 2), 'スポーツの日');
  add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
  const base = Object.keys(h).sort();
  // 国民の休日: 祝日にはさまれた平日
  for (const ds of base) {
    const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + 2);
    const after = dateStr(d.getFullYear(), d.getMonth(), d.getDate());
    d.setDate(d.getDate() - 1);
    const mid = dateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if (h[after] && !h[mid] && d.getDay() !== 0) h[mid] = '国民の休日';
  }
  // 振替休日: 日曜の祝日の次の、祝日でない日
  for (const ds of Object.keys(h).sort()) {
    const d = new Date(ds + 'T00:00:00');
    if (d.getDay() !== 0) continue;
    do { d.setDate(d.getDate() + 1); } while (h[dateStr(d.getFullYear(), d.getMonth(), d.getDate())]);
    h[dateStr(d.getFullYear(), d.getMonth(), d.getDate())] = '振替休日';
  }
  return (_jpHolidayCache[y] = h);
}

const SIM_JOB_COLORS = ['#007aff', '#8E44AD', '#34c759', '#C0392B', '#1d1d1f'];
let _simCalJob = null;  // まとめカレンダーで今入れているバイトの id

// バイトのカードに出す「出勤 ○日・日払い ○日」（日にちはまとめカレンダーで選ぶ）
function simJobDaysLine(j, jm, wd) {
  const hasAdv = j.job_type !== 'koma' && !!j.settings?.advance_per_day;
  const legacy = !jm.wdDates && jm.days
    ? `<div class="sim-row-sub">前の月から出勤 ${jm.days}日を引き継いでいます（上のカレンダーで日を選ぶと、選んだ日に切り替わります）</div>` : '';
  const legacyAdv = hasAdv && !jm.advDays && Number(wd[`${j.id}:adv`])
    ? `<div class="sim-row-sub">日にちが未設定の日払い ${Number(wd[`${j.id}:adv`])}日分</div>` : '';
  return `
    <div class="sim-step-row">
      <span class="sim-step-label"><i class="sim-job-dot" style="background:${simJobColor(j)}"></i>出勤日</span>
      <span class="sim-row-sub">${jm.days}日${hasAdv ? `・日払い ${jm.advCount}日` : ''}${jm.wdDates ? '' : '（日にち未設定）'}</span>
    </div>${legacy}${legacyAdv}`;
}

function simJobColor(j) {
  return SIM_JOB_COLORS[Math.max(0, _simJobs.indexOf(j)) % SIM_JOB_COLORS.length];
}

// 出勤カレンダー（全部のバイトをまとめて1つ）。上のボタンで入れるバイトを選んで、日をタップ
function renderSimCalendar(c) {
  const el = document.getElementById('sim-calendar');
  if (_simJobs.length === 0) { el.innerHTML = ''; return; }
  if (!_simJobs.some(j => String(j.id) === String(_simCalJob))) _simCalJob = _simJobs[0].id;
  const sel = _simJobs.find(j => String(j.id) === String(_simCalJob));
  const selJm = c.jobMonths[sel.id];
  const selAdv = sel.job_type !== 'koma' && !!sel.settings?.advance_per_day;
  const endDay = sel.job_type === 'koma' ? 0 : selJm.phase === 'both' ? Number(sel.settings.training_end.slice(8, 10)) : selJm.phase === 'training' ? 99 : 0;
  const first = new Date(_simMonth.getFullYear(), _simMonth.getMonth(), 1).getDay();

  const cells = Array.from({ length: c.daysInMonth }, (_, i) => i + 1).map(dd => {
    // その日に行くバイトの印（日払いは ¥）
    const marks = _simJobs.map(j => {
      const jm = c.jobMonths[j.id];
      if (!jm.wdDates?.includes(dd)) return '';
      const adv = jm.advDays?.includes(dd);
      return `<span class="sim-cal-mark" style="background:${simJobColor(j)}">${escapeHtmlF(j.name.slice(0, 1))}${adv ? '¥' : ''}</span>`;
    }).join('');
    const tr = dd <= endDay ? ' training' : '';
    const on = selJm.wdDates?.includes(dd) ? ' sel-on' : '';
    // 日曜・祝日は赤（どちらのバイトも休み）。土曜は青
    const ds = dateStr(_simMonth.getFullYear(), _simMonth.getMonth(), dd);
    const holiday = jpHolidays(_simMonth.getFullYear())[ds];
    const wday = new Date(_simMonth.getFullYear(), _simMonth.getMonth(), dd).getDay();
    const dayCls = holiday || wday === 0 ? ' holiday' : wday === 6 ? ' saturday' : '';
    return `<button type="button" class="sim-cal-day${tr}${on}${dayCls}" data-day="${dd}"${holiday ? ` title="${holiday}"` : ''}><span class="sim-cal-num">${dd}</span>${holiday ? `<span class="sim-cal-hname">${holiday}</span>` : ''}<span class="sim-cal-marks">${marks}</span></button>`;
  }).join('');

  el.innerHTML = `
    <div class="sim-cal-head">
      <span class="sim-step-label"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg> 出勤カレンダー</span>
      <span class="sim-row-sub">出勤 ${c.workDays}日・休み ${Math.max(0, c.daysInMonth - c.workDays)}日</span>
    </div>
    <div class="sim-cal-jobs">
      ${_simJobs.map(j => `<button type="button" class="sim-cal-job${String(j.id) === String(sel.id) ? ' active' : ''}" data-job="${j.id}" style="--job-color:${simJobColor(j)}">${escapeHtmlF(j.name)}</button>`).join('')}
    </div>
    <div class="sim-row-sub sim-cal-how">「${escapeHtmlF(sel.name)}」を入れる日をタップ${selAdv ? `（1回＝出勤・2回＝出勤＋日払い ${yen(sel.settings.advance_per_day)}・3回＝外す）` : '（もう一度タップで外す）'}${endDay ? `　薄い紫＝研修中（時給${yen(sel.settings.training_wage)}）` : ''}</div>
    <div class="sim-adv-cal sim-cal-grid">
      ${['日', '月', '火', '水', '木', '金', '土'].map((w, i) => `<span class="sim-adv-w${i === 0 ? ' holiday' : i === 6 ? ' saturday' : ''}">${w}</span>`).join('')}
      ${'<span></span>'.repeat(first)}
      ${cells}
    </div>`;

  el.querySelectorAll('.sim-cal-job').forEach(btn => {
    btn.addEventListener('click', () => { _simCalJob = btn.dataset.job; renderSimCalendar(simCalc(ymKey(_simMonth))); });
  });
  el.querySelectorAll('.sim-cal-day').forEach(btn => {
    btn.addEventListener('click', () => simCycleDay(sel.id, Number(btn.dataset.day)));
  });
}

function simCycleDay(jobId, day) {
  const job = _simJobs.find(j => String(j.id) === String(jobId));
  const hasAdv = job && job.job_type !== 'koma' && !!job.settings?.advance_per_day;
  const ym = ymKey(_simMonth);
  const plan = simMonthPlan(ym);
  const wd = { ...plan.workDays };
  const wKey = `${jobId}:wd`, aKey = `${jobId}:advd`;
  const work = new Set(Array.isArray(wd[wKey]) ? wd[wKey] : []);
  const adv  = new Set(Array.isArray(wd[aKey]) ? wd[aKey] : []);
  // 日数だけ（前の作り・引き継ぎ）だった月は、カレンダーの方に切り替える
  delete wd[jobId]; delete wd[`${jobId}:t`]; delete wd[`${jobId}:adv`];
  if (!work.has(day))              { work.add(day); adv.delete(day); }  // 休み → 出勤（日払いなしから始める）
  else if (hasAdv && !adv.has(day)) adv.add(day);
  else { work.delete(day); adv.delete(day); }
  wd[wKey] = [...work].sort((a, b) => a - b);
  // 日払いは出勤した日だけ（前の作りで残った日払いの日も、ここで消える）
  if (hasAdv) wd[aKey] = [...adv].filter(d => work.has(d)).sort((a, b) => a - b);
  else delete wd[aKey];
  plan.workDays = wd;
  _simMonths[ym] = { year_month: ym, items: plan.items, work_days: plan.workDays, saving: plan.saving ?? null };
  _simGoalCache = null;
  renderSimMonth();
  clearTimeout(_simSaveTimers[ym]);
  _simSaveTimers[ym] = setTimeout(() => simSaveMonth(ym, plan), 500);
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
  _simGoalCache = null;
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

  const dayBadge = d => d ? `毎月${d}日` : '';
  // 長期間: この月に払うものを先に、対象外の月のものは薄く
  const ym = c.ym;
  const longs = _simRecurring.filter(r => r.kind === 'expense')
    .sort((a, b) => Number(simLongActive(b, ym)) - Number(simLongActive(a, ym)));
  fill('sim-recurring-expense', longs.map(r => {
    const html = row(r.name, r.amount, 'recurring-expense', r.id, null, [simLongRangeLabel(r), r.day ? `${r.day}日` : ''].filter(Boolean).join('・'));
    return simLongActive(r, ym) ? html : html.replace('class="sim-row sim-row-tap"', 'class="sim-row sim-row-tap sim-row-inactive"');
  }).join(''));
  renderSimTrips(c);
  fill('sim-recurring-income',  _simRecurring.filter(r => r.kind === 'income').map(r => row(r.name, r.amount, 'recurring-income', r.id, null, dayBadge(r.day))).join(''));
  fill('sim-month-expense', c.plan.items.map((it, i) => it.kind === 'expense' ? row(it.name, it.amount, 'month-expense', i, null, it.day ? `${it.day}日` : '') : '').join(''));
  // この月の臨時収入（受け取りが先の月なら、その時期を表示）＋ 前の月の分でこの月に受け取るもの
  fill('sim-month-income', c.plan.items.map((it, i) => it.kind === 'income' ? row(it.name, it.amount, 'month-income', i, it.days, simPayWhenLabel(c.ym, it)) : '').join(''));
  // 前の月に働いた・決まった分で、この月に受け取るお金（給料・臨時収入）
  const fromPrev = c.cashRows.filter(r => r.fromPrev);
  document.getElementById('sim-from-prev-wrap').hidden = fromPrev.length === 0;
  document.getElementById('sim-from-prev').innerHTML = fromPrev.map(r => `
    <div class="sim-row">
      <div>
        <div class="sim-row-name">${escapeHtmlF(r.name)}${r.day ? `<span class="sim-badge sim-badge-when">${r.day}日</span>` : ''}</div>
        <div class="sim-row-sub">${escapeHtmlF(r.note)}</div>
      </div>
      <span class="sim-row-amount">${yen(r.amount)}</span>
    </div>`).join('');

  document.querySelectorAll('#tab-sim .sim-row-tap[data-target]').forEach(el => {
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
    f.elements.account.value         = s.account || SIM_DEFAULT_ACCOUNT;
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
  const oldSettings = _simJobs.find(j => String(j.id) === f.elements.id.value)?.settings || {};
  const settings = type === 'koma'
    ? { students: oldSettings.students || [] }  // コマの時給・長さは simKomaRates / simKomaLengths の決まった3種類。生徒の一覧は残す
    : { training_wage: num('trainingWage') || null, training_end: f.elements.trainingEnd.value || null,
        advance_per_day: num('advancePerDay') || null };
  settings.withholding = f.elements.withholding.value;
  settings.account = f.elements.account.value;
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
// 旅行: この月に払う分がある旅行を出す（事前払い・旅行中の内訳つき）
function renderSimTrips(c) {
  const el = document.getElementById('sim-trips');
  const md = ds => `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
  el.innerHTML = c.tripMonths.length ? c.tripMonths.map(t => {
    const pre = t.events.filter(e => e.kind === 'prepaid'), on = t.events.filter(e => e.kind === 'onsite');
    const parts = [
      ...pre.map(e => `${md(e.date)} ${escapeHtmlF(e.label.split('・').slice(1).join('・'))} ${yen(e.amount)}`),
      on.length ? `旅行中 ${on.length}日分 ${yen(on.reduce((x, e) => x + e.amount, 0))}` : '',
    ].filter(Boolean);
    return `
      <div class="sim-row sim-row-tap sim-trip-row" data-trip="${t.trip.id}">
        <div>
          <div class="sim-row-name"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg> ${escapeHtmlF(t.trip.name)}<span class="sim-badge sim-badge-when">${md(t.trip.start_date)}〜${md(t.trip.end_date)}</span></div>
          <div class="sim-row-sub">${parts.join(' ／ ')}</div>
        </div>
        <span class="sim-row-amount">${yen(t.amount)}</span>
      </div>`;
  }).join('') : '<p class="sim-empty">この月に払う旅行はありません</p>';
  el.querySelectorAll('.sim-trip-row').forEach(r => r.addEventListener('click', () => openSimTripModal(r.dataset.trip)));
}

function simTripLineHtml(kind, it = {}) {
  return `
    <div class="sim-trip-line" data-kind="${kind}">
      <input type="text" class="tl-name" placeholder="${kind === 'prepaid' ? '飛行機・ホテルなど' : '食事・おみやげなど'}" value="${escapeHtmlF(it.name || '')}">
      <input type="number" class="tl-amount" min="0" placeholder="金額" inputmode="numeric" value="${it.amount ?? ''}">
      <button type="button" class="tl-del" title="この行を消す">×</button>
      ${kind === 'prepaid' ? `<label class="tl-date-wrap"><span>払う日</span><input type="date" class="tl-date" value="${it.date || ''}"></label>` : ''}
    </div>`;
}

function openSimTripModal(id = null) {
  const trip = id ? _simTrips.find(t => String(t.id) === String(id)) : null;
  const f = document.getElementById('sim-trip-form');
  f.reset();
  f.elements.id.value = trip ? trip.id : '';
  f.elements.name.value = trip?.name || '';
  f.elements.startDate.value = trip?.start_date || '';
  f.elements.endDate.value = trip?.end_date || '';
  const pre = trip?.prepaid?.length ? trip.prepaid : [{}];
  const on = trip?.onsite?.length ? trip.onsite : [{}];
  document.getElementById('sim-trip-prepaid').innerHTML = pre.map(it => simTripLineHtml('prepaid', it)).join('');
  document.getElementById('sim-trip-onsite').innerHTML = on.map(it => simTripLineHtml('onsite', it)).join('');
  document.getElementById('sim-trip-title').textContent = trip ? '旅行を編集' : '旅行を追加';
  document.getElementById('btn-sim-del-trip').hidden = !trip;
  document.getElementById('sim-trip-modal').hidden = false;
}

async function saveSimTrip(e) {
  e.preventDefault();
  const f = e.target;
  const name = f.elements.name.value.trim();
  const start_date = f.elements.startDate.value, end_date = f.elements.endDate.value || f.elements.startDate.value;
  if (!name) { f.elements.name.focus(); return; }
  if (!start_date) { f.elements.startDate.focus(); return; }
  if (end_date < start_date) { alert('帰る日が行く日より前になっています'); return; }
  const lines = kind => [...document.querySelectorAll(`#sim-trip-${kind} .sim-trip-line`)].map(l => ({
    name: l.querySelector('.tl-name').value.trim(),
    amount: Number(l.querySelector('.tl-amount').value) || 0,
    ...(kind === 'prepaid' ? { date: l.querySelector('.tl-date').value || start_date } : {}),
  })).filter(it => it.amount);
  const row = { name, start_date, end_date, prepaid: lines('prepaid'), onsite: lines('onsite') };
  const id = f.elements.id.value;
  const { error } = id ? await db.from('sim_trips').update(row).eq('id', id) : await db.from('sim_trips').insert(row);
  if (error) { alert('保存に失敗しました: ' + error.message); return; }
  document.getElementById('sim-trip-modal').hidden = true;
  await renderSim();
}

async function deleteSimTrip() {
  const id = document.getElementById('sim-trip-form').elements.id.value;
  if (!id || !(await showConfirm('この旅行を削除しますか？'))) return;
  await db.from('sim_trips').delete().eq('id', id);
  document.getElementById('sim-trip-modal').hidden = true;
  await renderSim();
}

const SIM_ITEM_TITLES = {
  'recurring-expense': ['長期間の支出', '教習所・分割払い・定期的に払うものなど'],
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
    f.elements.day.value = item.day || '';
    f.elements.startYm.value = item.start_ym || ''; f.elements.endYm.value = item.end_ym || '';
  }
  document.getElementById('sim-item-range-wrap').hidden = target !== 'recurring-expense';
  if (target === 'recurring-expense' && !item) f.elements.startYm.value = ymKey(_simMonth);
  // 日にち（臨時収入は「受け取る時期」の方で入れる）
  const dayWrap = document.getElementById('sim-item-day-wrap');
  dayWrap.hidden = target === 'month-income';
  dayWrap.querySelector('label').textContent = target.endsWith('income')
    ? '入る日（任意）'
    : '使う日（任意・空なら毎日少しずつ使う計算）';
  document.getElementById('sim-item-days-wrap').hidden = target !== 'month-income';
  document.getElementById('sim-item-when-wrap').hidden = target !== 'month-income';
  document.getElementById('sim-item-account-wrap').hidden = !target.endsWith('income');
  f.elements.account.value = item?.account || SIM_DEFAULT_ACCOUNT;
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
    const account = kind === 'income' ? f.elements.account.value : null;
    const day = Number(f.elements.day.value) || null;
    const range = kind === 'expense'
      ? { start_ym: f.elements.startYm.value || null, end_ym: f.elements.endYm.value || null }
      : {};
    if (range.start_ym && range.end_ym && range.start_ym > range.end_ym) { alert('終わりの月が始まりの月より前になっています'); return; }
    const { error } = key
      ? await db.from('sim_recurring').update({ name, amount, account, day, ...range }).eq('id', key)
      : await db.from('sim_recurring').insert({ kind, name, amount, account, day, ...range, sort_order: _simRecurring.length + 1 });
    if (error) { alert('保存に失敗しました: ' + error.message); return; }
  } else {
    const ym = ymKey(_simMonth);
    const plan = simMonthPlan(ym);
    const items = [...plan.items];
    const it = { kind, name, amount };
    if (target === 'month-income') {
      if (f.elements.account.value !== SIM_DEFAULT_ACCOUNT) it.account = f.elements.account.value;
      if (Number(f.elements.days.value) > 0)      it.days = Number(f.elements.days.value);
      if (Number(f.elements.payOffset.value) > 0) it.pay_offset = Number(f.elements.payOffset.value);
      if (Number(f.elements.payDay.value) > 0)    it.pay_day = Number(f.elements.payDay.value);
    }
    if (target === 'month-expense' && Number(f.elements.day.value) > 0) it.day = Number(f.elements.day.value);
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
// シミュの推移のこれから分: 入金・予定支出は日付どおり、それ以外の支出（毎月の支出・この月だけの支出・自由に使うお金）は毎日少しずつ
function simTrendEvents(today, months) {
  const events = [], monthEnds = [];
  const d = new Date(); d.setDate(1);
  for (let k = 0; k < months; k++) {
    const y = d.getFullYear(), m = d.getMonth(), ym = ymKey(d);
    const last = new Date(y, m + 1, 0).getDate();
    const dayStr = day => dateStr(y, m, Math.min(Math.max(Number(day) || 1, 1), last));
    const c = simCalc(ym);
    for (const r of c.cashRows) events.push({ date: dayStr(r.day), label: `${r.name}（${r.note}）`, delta: r.amount, projected: true });
    const { subItems, planItems, loanItems } = buildPlannedItems(_simPlannedSrc.subs, _simPlannedSrc.plans, _simPlannedSrc.loans, {}, _simAmountOverrides[ym] || {});
    for (const it of [...subItems, ...planItems, ...loanItems]) {
      if (isActiveInMonth(it, y, m) && !_simPaid.has(`${ym}:${it.source}:${it.id}`)) events.push({ date: dayStr(it.billingDay), label: `${it.name}（予定支出）`, delta: -(it.amountMax || it.amount), projected: true });
    }
    // 日にちを決めた支出（毎月の支出・この月だけの支出）はその日に
    let dated = 0;
    for (const r of _simRecurring) if (r.kind === 'expense' && r.day && simLongActive(r, ym)) { dated += Number(r.amount) || 0; events.push({ date: dayStr(r.day), label: `${r.name}（長期間）`, delta: -(Number(r.amount) || 0), projected: true }); }
    for (const t of c.tripMonths) for (const e of t.events) { dated += e.amount; events.push({ date: e.date, label: e.label, delta: -e.amount, projected: true }); }
    for (const it of c.plan.items) if (it.kind === 'expense' && it.day) { dated += Number(it.amount) || 0; events.push({ date: dayStr(it.day), label: `${it.name}（この月だけ）`, delta: -(Number(it.amount) || 0), projected: true }); }
    // 残り（日にちのない支出＋自由に使えるお金）は毎日少しずつ。今月は残りの日数の分だけ
    const daily = c.need + c.goalUsed - c.planned - dated + c.free;
    // 日割りの中身（何を日割りしているか）: 日付のない長期間・この月だけの支出、自由に使えるお金
    const parts = [
      ..._simRecurring.filter(r => r.kind === 'expense' && !r.day && simLongActive(r, ym)).map(r => ({ name: `${r.name}（長期間）`, amount: Number(r.amount) || 0 })),
      ...c.plan.items.filter(it => it.kind === 'expense' && !it.day).map(it => ({ name: `${it.name}（この月だけ）`, amount: Number(it.amount) || 0 })),
      ...(c.free ? [{
        name: `${m + 1}月の自由に使えるお金`, amount: c.free,
        // どこから来たお金か: その月に入るお金 − 必要な支出 − 貯金
        how: `${m + 1}月に入るお金 ${yen(c.cashIncome)} − 必要な支出 ${yen(c.need)} − 貯金 ${yen(c.saving)} ＝ ${yen(c.free)}（使い切る前提で毎日少しずつ減らしています）`,
      }] : []),
    ].filter(x => x.amount).map(x => ({ ...x, perDay: Math.round(x.amount / last), days: last }));
    const days = [];
    for (let dd = 1; dd <= last; dd++) { const ds = dateStr(y, m, dd); if (ds > today) days.push(ds); }
    const total = k === 0 ? Math.round(daily * days.length / last) : daily;
    const base = days.length ? Math.floor(total / days.length) : 0;
    days.forEach((ds, i) => events.push({ date: ds, label: SIM_DAILY_LABEL, delta: -(i === days.length - 1 ? total - base * (days.length - 1) : base), projected: true, noDedupe: true, parts }));
    monthEnds.push({ ym, end: dateStr(y, m, last), c, label: `${m + 1}月`, isNow: k === 0 });
    d.setMonth(d.getMonth() + 1);
  }
  return { events: events.filter(e => e.date > today), monthEnds };
}

// 貯金の目標のカード
function renderSimGoal(plan, todayBalance) {
  const el = document.getElementById('sim-goal');
  if (!_simGoals.length) {
    el.innerHTML = `<div class="sim-goal-empty"><span><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 貯金の目標がまだありません</span><button class="btn-primary-sm" data-goal-add>＋ 目標を作る</button></div>`;
  } else {
    const savedNow = plan.startTotal;
    const usable = todayBalance - savedNow;
    el.innerHTML = `
      <div class="sim-goal-head">
        <button type="button" class="sim-goal-toggle" title="開く／閉じる">
          <span class="sim-goal-caret">▼</span><b><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 貯金の目標</b>
          <span class="sim-goal-summary"><span>${_simGoals.length}件</span>・<span>貯金 ${yen(savedNow)}</span>・<span>使っていいお金 ${usable < 0 ? '−' : ''}${yen(usable)}</span></span>
        </button>
        <button class="btn-primary-sm" data-goal-add>＋ 追加</button>
      </div>
      ${_simGoals.length > 1 ? '<div class="sim-row-sub">⠿ をつまんで動かすと優先順位を変えられます。余りが足りない月は、優先順位の高い目標から積み立てます</div>' : ''}
      <div id="sim-goal-list">
      ${_simGoals.map((g, gi) => {
        const st = plan.stats[g.id], saved = g.saved_amount || 0;
        const pct = Math.min(100, Math.round(saved / g.target_amount * 100));
        const reach = st.reachYm === 'now' ? 'もう達成しています <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg>' : st.reachYm ? `予想では <b>${simYmLabel(st.reachYm)}末</b> に達成` : (simGoalMonthly(g) ? '今の計画では3年以内に届きません' : '毎月の額か期限を入れると、たまっていきます');
        let deadline = '';
        if (g.deadline_ym && st.needPerMonth != null) {
          deadline = st.deadlineOk
            ? `<span class="sim-save">期限（${simGoalDeadlineLabel(g)}）に間に合います</span>`
            : simGoalIsAuto(g)
            ? `<span class="sim-neg">不足分を上乗せしても、余りが足りず期限（${simGoalDeadlineLabel(g)}）に間に合いません</span>`
            : `<span class="sim-neg">期限（${simGoalDeadlineLabel(g)}）に間に合うには毎月 <b>${yen(st.needPerMonth)}</b></span>
               ${!simGoalIsAuto(g) && st.needPerMonth !== g.monthly_amount ? `<button class="sim-hint-btn" data-goal-need="${g.id}" data-amount="${st.needPerMonth}">毎月${yen(st.needPerMonth)}にする</button>` : ''}`;
        }
        return `
          <div class="sim-goal-item" data-id="${g.id}">
            <div class="sim-goal-row">
              <span>${_simGoals.length > 1 ? `<span class="sim-goal-handle" title="つまんで動かす">⠿</span><span class="sim-goal-rank">${'①②③④⑤⑥⑦⑧⑨⑩'[gi] || gi + 1}</span>` : ''}<b>${escapeHtmlF(g.name)}</b> ${yen(g.target_amount)}${g.start_ym && g.start_ym > ymKey(new Date()) ? `<span class="sim-badge">${simYmLabel(g.start_ym)}から</span>` : ''}${g.deadline_ym ? `<span class="sim-badge">${simGoalDeadlineLabel(g)}${g.expense_ref ? 'に払う' : 'まで'}</span>` : ''}<span class="sim-badge sim-badge-when">毎月${yen(simGoalMonthly(g))}${simGoalIsAuto(g) ? '（自動）' : ''}</span></span>
              <span class="sim-goal-btns">
                <button class="sim-goal-done-btn" data-goal-done="${g.id}" title="達成した（今日の日付で一覧から外す）">✓ 達成</button>
                <button class="planned-edit-btn" data-goal-edit="${g.id}">編集</button>
              </span>
            </div>
            <div class="sim-bar sim-goal-bar"><div class="sim-bar-fill sim-bar-save" style="width:${pct}%"></div></div>
            <div class="sim-goal-row"><span>今 <b>${yen(saved)}</b>（${pct}%）</span><span>あと ${yen(Math.max(0, g.target_amount - saved))}</span></div>
            <div class="sim-goal-row"><span>${reach}</span></div>
            ${deadline ? `<div class="sim-goal-row sim-goal-deadline">${deadline}</div>` : ''}
          </div>`;
      }).join('')}
      </div>
      <div class="sim-goal-split">今日の残高 ${yen(todayBalance)} ＝ 貯金 <b class="sim-save">${yen(savedNow)}</b> ＋ 使っていいお金 <b class="${usable < 0 ? 'sim-neg' : ''}">${usable < 0 ? '−' : ''}${yen(usable)}</b></div>
      ${usable < 0 ? '<div class="sim-row-sub sim-neg">残高が貯金より少なくなっています（貯金に手をつけている状態）</div>' : ''}`;
  }
  // 達成した目標（開くと見える。戻すと一覧に戻る）
  if (_simGoalsDone.length) {
    el.insertAdjacentHTML('beforeend', `
      <details class="sim-goal-done-list">
        <summary><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5"/><path d="m9 11 3 3L22 4"/></svg> 達成した目標（${_simGoalsDone.length}）</summary>
        ${_simGoalsDone.map(g => `
          <div class="sim-goal-row sim-goal-done-row">
            <span><b>${escapeHtmlF(g.name)}</b> ${yen(g.target_amount)}<span class="sim-badge">${g.achieved_at.replaceAll('-', '/')} 達成</span></span>
            <span class="sim-goal-btns">
              <button class="sim-hint-btn" data-goal-undo="${g.id}">戻す</button>
              <button class="planned-edit-btn" data-goal-edit="${g.id}">編集</button>
            </span>
          </div>`).join('')}
      </details>`);
  }
  // 折りたたみ: 見出しより下を .sim-goal-body にまとめ、見出しのタップで開閉（状態は覚えておく）
  const head = el.querySelector('.sim-goal-head');
  if (head) {
    const body = document.createElement('div');
    body.className = 'sim-goal-body';
    while (head.nextSibling) body.appendChild(head.nextSibling);
    el.appendChild(body);
    el.classList.toggle('collapsed', !!loadViewState().goalsCollapsed);
    head.querySelector('.sim-goal-toggle').addEventListener('click', () => {
      const collapsed = !el.classList.contains('collapsed');
      el.classList.toggle('collapsed', collapsed);
      saveViewState('goalsCollapsed', collapsed);
    });
  } else el.classList.remove('collapsed');
  el.querySelectorAll('[data-goal-add]').forEach(b => b.addEventListener('click', () => openSimGoalModal()));
  el.querySelectorAll('[data-goal-edit]').forEach(b => b.addEventListener('click', () => openSimGoalModal(b.dataset.goalEdit)));
  el.querySelectorAll('[data-goal-done]').forEach(b => b.addEventListener('click', async () => {
    const g = _simGoals.find(x => String(x.id) === b.dataset.goalDone);
    if (!(await showConfirm(`「${g.name}」を達成にしますか？（今日の日付で一覧から外れます）`))) return;
    await db.from('sim_goals').update({ achieved_at: todayJST() }).eq('id', g.id);
    await renderSim();
  }));
  el.querySelectorAll('[data-goal-undo]').forEach(b => b.addEventListener('click', async () => {
    await db.from('sim_goals').update({ achieved_at: null }).eq('id', b.dataset.goalUndo);
    await renderSim();
  }));
  // 優先順位をドラッグで変える（SortableJS。Wish List と同じもの）
  const list = document.getElementById('sim-goal-list');
  if (list && _simGoals.length > 1) {
    Sortable.create(list, {
      handle: '.sim-goal-handle',
      animation: 150,
      onEnd: async () => {
        const ids = [...list.querySelectorAll('.sim-goal-item')].map(x => x.dataset.id);
        await Promise.all(ids.map((id, i) => db.from('sim_goals').update({ sort_order: i + 1 }).eq('id', id)));
        await renderSim();
      },
    });
  }
  el.querySelectorAll('[data-goal-need]').forEach(b => b.addEventListener('click', async () => {
    await db.from('sim_goals').update({ monthly_amount: Number(b.dataset.amount) }).eq('id', b.dataset.goalNeed);
    await renderSim();
  }));
}

function openSimGoalModal(id = null) {
  const f = document.getElementById('sim-goal-form');
  const g = id ? [..._simGoals, ..._simGoalsDone].find(x => String(x.id) === String(id)) : null;
  f.reset();
  f.elements.id.value = g ? g.id : '';
  f.elements.name.value = g?.name || '';
  f.elements.target.value = g?.target_amount || '';
  // 日にちのない前の目標は、その月の末日を入れておく
  f.elements.deadline.value = g?.deadline_date || (g?.deadline_ym ? dateStr(Number(g.deadline_ym.slice(0, 4)), Number(g.deadline_ym.slice(5, 7)) - 1, new Date(Number(g.deadline_ym.slice(0, 4)), Number(g.deadline_ym.slice(5, 7)), 0).getDate()) : '');
  f.elements.start.value = g?.start_ym || '';
  f.elements.saved.value = g?.saved_amount ?? '';
  f.elements.monthly.value = g?.monthly_amount ?? '';
  f.elements.achieved.value = g?.achieved_at || '';
  f.elements.expenseRef.value = g?.expense_ref || '';
  document.getElementById('sim-goal-title').innerHTML = g ? '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 目標を編集' : '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> 目標を追加';
  simUpdateGoalPaceNote();
  // Wish List（未購入）から選べる。選ぶと名前と目標額（価格の上限）が入る
  const sel = document.getElementById('sim-goal-wl');
  sel.innerHTML = '<option value="">選ばない</option>';
  db.from('wish_list').select('id, name, price_min, price_max, purchased_at').is('purchased_at', null).order('sort_order', { nullsFirst: false })
    .then(({ data }) => {
      sel.innerHTML = '<option value="">選ばない</option>' + (data || []).map(w => {
        const r = wlPriceRange(w);
        return `<option value="${r ? r[1] : ''}" data-name="${escapeHtmlF(w.name)}">${escapeHtmlF(w.name)}${r ? `（${yen(r[1])}）` : ''}</option>`;
      }).join('');
    });
  document.getElementById('btn-sim-del-goal').hidden = !g;
  document.getElementById('sim-goal-modal').hidden = false;
}

// 毎月の額が空のときの「自動ならいくらか」を表示
function simUpdateGoalPaceNote() {
  const f = document.getElementById('sim-goal-form');
  const g = { target_amount: Number(f.elements.target.value) || 0, saved_amount: Number(f.elements.saved.value) || 0, deadline_date: f.elements.deadline.value || null, deadline_ym: f.elements.deadline.value.slice(0, 7) || null, start_ym: f.elements.start.value || null, expense_ref: f.elements.expenseRef.value || null };
  const pace = g.target_amount ? simGoalPace(g) : null;
  f.elements.monthly.placeholder = pace != null ? `空なら自動 ${pace.toLocaleString()}` : '期限があれば空でOK';
  document.getElementById('sim-goal-pace').textContent = f.elements.monthly.value === ''
    ? (pace != null ? `空欄なので、期限までの割り算で毎月 ${yen(pace)}（${g.start_ym && g.start_ym > ymKey(new Date()) ? simYmLabel(g.start_ym) + 'から' : ''}${simGoalMonthsLeftLabel(g)}）` : '空欄で期限もないので、毎月 ¥0 です')
    : '';
  // 支出のための目標の説明
  const exp = document.getElementById('sim-goal-expense-note');
  exp.hidden = !g.expense_ref || !g.deadline_ym;
  // 支出がまだあれば、目標額は支出の額に合わせる（ここでは直せない）
  const linked = simExpenseRefAmount(g.expense_ref) != null;
  f.elements.target.readOnly = linked;
  if (!exp.hidden) {
    const pm = simYmToDate(simPrevYm(g.deadline_ym)).getMonth() + 1;
    exp.textContent = `支出のための目標: ${simYmLabel(g.deadline_ym)}は積み立てず、${pm}月末までに貯めた分でこの支出を払います（その分、${simYmLabel(g.deadline_ym)}の必要な額から引きます）${linked ? '。目標額は支出の金額に自動で合わせています' : ''}`;
  }
}

async function saveSimGoal(e) {
  e.preventDefault();
  const f = e.target;
  const target = Number(f.elements.target.value) || 0;
  if (!target) { f.elements.target.focus(); return; }
  if (f.elements.start.value && f.elements.deadline.value && f.elements.start.value > f.elements.deadline.value.slice(0, 7)) {
    alert('開始月が期限より後になっています'); f.elements.start.focus(); return;
  }
  const row = {
    name: f.elements.name.value.trim() || '貯金',
    target_amount: target,
    deadline_date: f.elements.deadline.value || null,
    deadline_ym: f.elements.deadline.value.slice(0, 7) || null,  // 月の判定（期限を過ぎた月など）はこちらを使う
    start_ym: f.elements.start.value || null,  // 空なら今月から
    saved_amount: Number(f.elements.saved.value) || 0,
    // 空欄なら null（期限までの割り算で自動）
    monthly_amount: f.elements.monthly.value === '' ? null : Number(f.elements.monthly.value) || 0,
    achieved_at: f.elements.achieved.value || null,  // 入れると達成した目標として一覧から外れる
    expense_ref: f.elements.expenseRef.value || null,  // 必要な額の明細から作った目標（支払いの月は貯めた分で払う）
  };
  const id = f.elements.id.value;
  const { error } = id
    ? await db.from('sim_goals').update(row).eq('id', id)
    : await db.from('sim_goals').insert({ ...row, sort_order: _simGoals.length + 1 });
  if (error) { alert('保存に失敗しました: ' + error.message); return; }
  document.getElementById('sim-goal-modal').hidden = true;
  await renderSim();
}

async function deleteSimGoal() {
  const id = document.getElementById('sim-goal-form').elements.id.value;
  if (!id || !(await showConfirm('この目標を削除しますか？'))) return;
  await db.from('sim_goals').delete().eq('id', id);
  document.getElementById('sim-goal-modal').hidden = true;
  await renderSim();
}

async function renderSimTrend() {
  const months = Number(document.getElementById('sim-trend-months').value) || 6;
  const today = todayJST();
  // これまでは1ヶ月前から表示
  const startD = new Date(); startD.setMonth(startD.getMonth() - 1);
  const start = dateStr(startD.getFullYear(), startD.getMonth(), startD.getDate());
  const [{ data: accounts }, { data: txns }] = await Promise.all([
    db.from('accounts').select('account_name, balance').in('account_name', SIM_MONEY_ACCOUNTS),
    db.from('transactions').select('date, type, amount, category, memo, payment_method, created_at')
      .in('payment_method', SIM_MONEY_ACCOUNTS).gte('date', start).order('date').order('created_at'),
  ]);
  const endBalance = (accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  const { list, past, startBalance, todayBalance } = acctReconstruct(endBalance, txns, today);

  // 今日の残高（口座ごと＝未来の日付の取引を除いた額）
  const signed = v => (v < 0 ? '−' : '') + yen(v);
  const futureDelta = {};
  for (const t of (txns || [])) if (t.date > today) futureDelta[t.payment_method] = (futureDelta[t.payment_method] || 0) + (t.type === 'income' ? t.amount : -t.amount);
  document.getElementById('sim-start-balance').textContent = signed(todayBalance);
  const short = { 'deposit（銀行）': '銀行', 'PayPay': 'PayPay', 'cash（現金）': '現金' };
  document.getElementById('sim-start-breakdown').textContent = SIM_MONEY_ACCOUNTS
    .map(n => `${short[n]} ${signed((accounts?.find(a => a.account_name === n)?.balance || 0) - (futureDelta[n] || 0))}`).join(' ＋ ');

  // これから: 記録済みの未来の取引 ＋ 予想（同じ月・同じ金額の記録があれば予想は出さない）
  const { events, monthEnds } = simTrendEvents(today, months);
  const future = [...list.filter(e => e.future), ...acctDedupe(events, list)].sort((a, b) => a.date.localeCompare(b.date));
  let fr = todayBalance;
  for (const e of future) { fr += e.delta; e.after = fr; }

  // 月末の残高 = その月の最後の日までの残高
  const balanceAt = ds => { let b = todayBalance; for (const e of future) { if (e.date > ds) break; b = e.after; } return b; };
  const rows = monthEnds.map(me => ({
    ym: me.ym, label: me.label, isNow: me.isNow,
    free: me.c.free, saving: (me.c.leftover < 0 ? me.c.leftover : me.c.saving) - me.c.goalUsed,
    balance: balanceAt(me.end), workDays: me.c.workDays, withheld: me.c.withheld,
  }));

  const goalPlan = simGoalsPlan();
  const withheldTotal = rows.reduce((s, r) => s + r.withheld, 0);
  const taxEl = document.getElementById('sim-trend-tax');
  taxEl.hidden = !withheldTotal;
  taxEl.innerHTML = `この期間に引かれる源泉徴収 <b>${yen(withheldTotal)}</b><br><span class="sim-row-sub">1年の給料が少なければ、確定申告で戻ってくる見込みです（この推移には入れていません）</span>`;

  document.getElementById('sim-trend-tbody').innerHTML = rows.map(r => `
    <tr class="sim-trend-row" data-ym="${r.ym}">
      <td>${r.label}${r.isNow ? '<span class="sim-badge">これから</span>' : ''}<div class="sim-row-sub">出勤${r.workDays}日</div></td>
      <td class="sim-free">${yen(r.free)}</td>
      <td class="${r.saving < 0 ? 'sim-neg' : 'sim-save'}">${r.saving < 0 ? '−' : ''}${yen(r.saving)}${goalPlan ? `<div class="sim-row-sub">合計 ${yen(goalPlan.months.find(m => m.ym === r.ym)?.total ?? 0)}</div>` : ''}</td>
      <td class="${r.balance < 0 ? 'sim-neg' : ''}"><b>${signed(r.balance)}</b></td>
    </tr>`).join('');
  document.querySelectorAll('#sim-trend-tbody .sim-trend-row').forEach(tr => {
    tr.addEventListener('click', () => {
      _simMonth = simYmToDate(tr.dataset.ym);
      document.querySelector('.sim-sub-btn[data-sub="month"]').click();
    });
  });

  renderSimGoal(goalPlan, todayBalance);
  _simChart = drawBalanceChart(document.getElementById('sim-trend-chart'), _simChart, startD, monthEnds[monthEnds.length - 1].end, today, startBalance, past, future, document.getElementById('sim-day-detail'),
    goalPlan ? ds => simGoalSavedAt(goalPlan, ds) : null);
  document.getElementById('sim-day-detail').innerHTML = '<div class="sim-row-sub">グラフの日をタップすると、その日に何で増えて何で減るかが出ます</div>';
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
      else if (btn.dataset.sub === 'planned') { _plannedMonth = new Date(_simMonth); renderPlannedTab(); }  // 月の計画で見ていた月を開く
      else                             renderSimMonth();
    });
  });
  document.getElementById('sim-prev').addEventListener('click', () => { _simMonth.setMonth(_simMonth.getMonth() - 1); renderSimMonth(); });
  document.getElementById('sim-next').addEventListener('click', () => { _simMonth.setMonth(_simMonth.getMonth() + 1); renderSimMonth(); });
  document.getElementById('sim-trend-months').addEventListener('change', renderSimTrend);
  window.addEventListener('resize', simUpdateStickyTop);

  document.getElementById('btn-sim-add-job').addEventListener('click', () => openSimJobModal());
  document.getElementById('sim-income-card').addEventListener('click', openSimCashModal);
  document.getElementById('sim-need-card').addEventListener('click', openSimNeedModal);
  document.getElementById('sim-planned-row').addEventListener('click', openSimPlannedModal);
  document.getElementById('btn-sim-planned-close').addEventListener('click', closeSimPlannedModal);
  document.getElementById('sim-planned-modal').addEventListener('click', e => { if (e.target.id === 'sim-planned-modal') closeSimPlannedModal(); });
  document.getElementById('sim-job-form').addEventListener('submit', saveSimJob);
  document.getElementById('sim-job-type').addEventListener('change', e => simToggleJobType(e.target.value));
  document.getElementById('btn-sim-del-job').addEventListener('click', deleteSimJob);
  document.getElementById('btn-sim-koma-student-add').addEventListener('click', addSimKomaStudentRow);
  document.getElementById('sim-koma-student-name').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSimKomaStudentRow(); }
  });
  document.getElementById('btn-sim-koma-student-save').addEventListener('click', saveSimKomaStudents);

  document.querySelectorAll('#tab-sim .sim-add-link[data-add]').forEach(btn => {
    btn.addEventListener('click', () => openSimItemModal(btn.dataset.add));
  });
  document.getElementById('sim-item-form').addEventListener('submit', saveSimItem);
  document.getElementById('btn-sim-add-trip').addEventListener('click', () => openSimTripModal());
  document.getElementById('sim-goal-form').addEventListener('submit', saveSimGoal);
  ['target', 'saved', 'deadline', 'start', 'monthly'].forEach(n => document.getElementById('sim-goal-form').elements[n].addEventListener('input', simUpdateGoalPaceNote));
  document.getElementById('sim-goal-wl').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    const f = document.getElementById('sim-goal-form');
    if (opt.dataset.name) f.elements.name.value = opt.dataset.name;
    if (opt.value) f.elements.target.value = opt.value;
    simUpdateGoalPaceNote();
  });
  document.getElementById('btn-sim-del-goal').addEventListener('click', deleteSimGoal);
  document.getElementById('sim-trip-form').addEventListener('submit', saveSimTrip);
  document.getElementById('btn-sim-del-trip').addEventListener('click', deleteSimTrip);
  document.querySelectorAll('#sim-trip-form [data-add-line]').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById(`sim-trip-${btn.dataset.addLine}`).insertAdjacentHTML('beforeend', simTripLineHtml(btn.dataset.addLine)));
  });
  document.getElementById('sim-trip-form').addEventListener('click', e => { if (e.target.classList.contains('tl-del')) e.target.closest('.sim-trip-line').remove(); });
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
  document.querySelectorAll('#tab-sim .sim-modal:not(#sim-planned-modal)').forEach(m => {
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

// ============================================================
// 口座の残高の推移（過去: 記録した取引から逆算 / これから: 給料・仕送りと予定支出から予想）
// ============================================================
let _acctChart = null;
let _acctInited = false;
const ACCT_PAST_ROWS = 15; // 表に最初から出す過去の取引の数

// 記録した取引から残高をさかのぼる。endBalance は未来の日付の取引も入った後の残高（accounts.balance）
//   → { list: 各取引（after=その取引の後の残高, future=今日より後）, startBalance, todayBalance }
function acctReconstruct(endBalance, txns, today) {
  const list = (txns || []).map(t => ({
    date: t.date,
    label: [t.category, t.memo].filter(Boolean).join(' '),
    delta: t.type === 'income' ? t.amount : -t.amount,
    projected: false,
    future: t.date > today,
  }));
  let running = endBalance;
  for (let i = list.length - 1; i >= 0; i--) { list[i].after = running; running -= list[i].delta; }
  const past = list.filter(e => !e.future);
  return { list, past, startBalance: running, todayBalance: past.length ? past[past.length - 1].after : running };
}

// 予想のうち、同じ月に同じ金額の記録がもうあるものを除く（1つの記録で消すのは1つの予想だけ）
function acctDedupe(projected, recorded) {
  const used = new Set();
  return projected.filter(p => {
    if (p.noDedupe) return true;
    const i = recorded.findIndex((r, idx) => !used.has(idx) && r.date.slice(0, 7) === p.date.slice(0, 7) && r.delta === p.delta);
    if (i === -1) return true;
    used.add(i);
    return false;
  });
}

// 日ごとの残高グラフ（これまで＝実線・これから＝点線）。past / future は after（その後の残高）つきの日付順の配列
// detailEl: グラフの日をタップしたときに、その日の増えた・減った内訳を出す場所
// savingsAt(ds): その日の貯金（使っちゃいけないお金）。渡すと緑の線を重ねる
function drawBalanceChart(canvas, oldChart, startD, end, today, startBalance, past, future, detailEl, savingsAt = null) {
  const labels = [], pastData = [], futData = [], dates = [], savData = [];
  const byDate = {};
  for (const e of [...past, ...future]) (byDate[e.date] ||= []).push(e);
  const toMap = events => { const map = {}; for (const e of events) map[e.date] = e.after; return map; };
  const pastMap = toMap(past), futMap = toMap(future);
  let bal = startBalance;
  for (let d = new Date(startD); ; d.setDate(d.getDate() + 1)) {
    const ds = dateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if (ds > end) break;
    labels.push(acctShortDate(ds));
    dates.push(ds);
    savData.push(savingsAt && ds >= today ? savingsAt(ds) : null);
    if (ds <= today) {
      if (pastMap[ds] != null) bal = pastMap[ds];
      pastData.push(bal);
      futData.push(ds === today ? bal : null);
    } else {
      if (futMap[ds] != null) bal = futMap[ds];
      pastData.push(null);
      futData.push(bal);
    }
  }
  if (oldChart) oldChart.destroy();
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '残高', data: pastData, borderColor: '#007aff', backgroundColor: 'rgba(74,144,217,0.10)', fill: true, stepped: true, pointRadius: 0, borderWidth: 2 },
        { label: '予想', data: futData, borderColor: '#007aff', borderDash: [6, 4], stepped: true, pointRadius: 0, borderWidth: 2, fill: false },
        ...(savingsAt ? [{ label: '貯金（使わないお金）', data: savData, borderColor: '#34c759', backgroundColor: 'rgba(39,174,96,0.14)', fill: 'origin', stepped: true, pointRadius: 0, borderWidth: 1.5 }] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: i => i.parsed.y != null,
          callbacks: {
            label: c => `${c.dataset.label} ¥${c.parsed.y.toLocaleString()}`,
            // その日の動きを短く（多いときは4件まで）
            footer: items => {
              const evs = byDate[dates[items[0]?.dataIndex]] || [];
              const lines = evs.slice(0, 4).map(e => `${e.delta >= 0 ? '+' : '−'}¥${Math.abs(e.delta).toLocaleString()} ${e.label}${e.parts?.length ? '（' + e.parts.map(x => x.name.replace(/（.*）/, '')).join('・') + '）' : ''}`);
              if (evs.length > 4) lines.push(`ほか${evs.length - 4}件（タップで全部）`);
              return lines;
            },
          },
        },
      },
      onClick: (evt, _els, chart) => {
        const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
        if (pts.length && detailEl) renderBalanceDayDetail(detailEl, dates[pts[0].index], byDate, pastData[pts[0].index] ?? futData[pts[0].index], today, savData[pts[0].index]);
      },
      scales: {
        // 目盛りは毎月の1日・15日・25日。期間が長くて混むとき（13個以上）は線だけ残して、文字は1日だけ
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            callback: (v, i, ticks) => ticks.length > 12 && Number(dates[v]?.slice(8, 10)) !== 1 ? '' : labels[v],
          },
          afterBuildTicks: axis => {
            axis.ticks = axis.ticks.filter(t => [1, 15, 25].includes(Number(dates[t.value]?.slice(8, 10))));
          },
        },
        y: { min: 0, ticks: { callback: v => '¥' + (v / 10000).toLocaleString() + '万' } },  // 下限は常に0（マイナスは出さない）
      },
    },
  });
}

// その日の内訳（増えた・減った）
function renderBalanceDayDetail(el, ds, byDate, balance, today, saved = null) {
  const evs = byDate[ds] || [];
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(ds + 'T00:00:00').getDay()];
  const plus = evs.filter(e => e.delta > 0), minus = evs.filter(e => e.delta < 0);
  const sum = arr => arr.reduce((t, e) => t + e.delta, 0);
  const list = arr => arr.map(e => `
    <div class="bal-day-row"><span>${escapeHtmlF(e.label || '—')}${e.projected ? '<span class="sim-badge">予想</span>' : ''}</span><span class="${e.delta >= 0 ? 'sim-inc' : 'sim-exp'}">${e.delta >= 0 ? '+' : '−'}${yen(e.delta)}</span></div>
    ${e.parts?.length ? `<div class="bal-day-parts">${e.parts.map(x => `<div><span>${escapeHtmlF(x.name)} ${yen(x.amount)} ÷ ${x.days}日</span><span>−${yen(x.perDay)}</span></div>${x.how ? `<div class="bal-day-how">${x.how}</div>` : ''}`).join('')}</div>` : ''}`).join('');
  el.innerHTML = `
    <div class="bal-day-head">
      <b>${acctShortDate(ds)}（${w}）${ds === today ? ' 今日' : ds > today ? ' の予想' : ''}</b>
      <span>この日の終わり <b class="${balance < 0 ? 'sim-neg' : ''}">${balance < 0 ? '−' : ''}${yen(balance ?? 0)}</b></span>
    </div>
    ${saved != null ? `<div class="bal-day-split">うち貯金 <b class="sim-save">${yen(saved)}</b> ・ 使っていいお金 <b class="${balance - saved < 0 ? 'sim-neg' : ''}">${balance - saved < 0 ? '−' : ''}${yen(balance - saved)}</b></div>` : ''}
    ${evs.length === 0 ? '<div class="sim-row-sub">この日はお金の動きがありません</div>' : `
      ${plus.length ? `<div class="bal-day-title">増える ${yen(sum(plus))}</div>${list(plus)}` : ''}
      ${minus.length ? `<div class="bal-day-title">減る −${yen(sum(minus))}</div>${list(minus)}` : ''}`}`;
}

function acctShortDate(ds) {
  return `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
}

// これから（今日の翌日〜来月末）の入出金の予想。sim のデータ（loadSimData）を使う
function acctProjectedEvents(account, today, end) {
  const events = [];
  const cur = new Date(); cur.setDate(1);
  for (let k = 0; k <= 1; k++) {
    const d = new Date(cur); d.setMonth(d.getMonth() + k);
    const y = d.getFullYear(), m = d.getMonth(), ym = ymKey(d);
    const last = new Date(y, m + 1, 0).getDate();
    const dayStr = day => dateStr(y, m, Math.min(Math.max(Number(day) || 1, 1), last));
    // 入金（シミュの「この月に入るお金」の明細のうち、この口座に入るもの）
    for (const r of simCalc(ym).cashRows) {
      if (r.account !== account) continue;
      events.push({ date: dayStr(r.day), label: `${r.name}（${r.note}）`, delta: r.amount, projected: true, undated: !r.day });
    }
    // 引き落とし（予定支出。サブスクは登録した支払方法、それ以外は銀行から）
    const { subItems, planItems, loanItems } = buildPlannedItems(_simPlannedSrc.subs, _simPlannedSrc.plans, _simPlannedSrc.loans, {}, _simAmountOverrides[ym] || {});
    for (const it of [...subItems, ...planItems, ...loanItems]) {
      if (!isActiveInMonth(it, y, m) || _simPaid.has(`${ym}:${it.source}:${it.id}`)) continue;
      const acc = it.source === 'subscription' && it.paymentMethod ? it.paymentMethod : SIM_DEFAULT_ACCOUNT;
      if (acc !== account) continue;
      events.push({ date: dayStr(it.billingDay), label: `${it.name}（予定支出）`, delta: -(it.amountMax || it.amount), projected: true, undated: !it.billingDay });
    }
  }
  // 今日より後・来月末まで。日にちが決まっていないものは今月なら入ったものとして除く
  return events.filter(e => e.date > today && e.date <= end);
}

// 残高の推移で選んでいる口座（複数選ぶと足し算）。選び方は localStorage（finance-view の acctPick）に覚えておく
function acctPickedAccounts() {
  return [...document.querySelectorAll('#acct-history-accounts input:checked')].map(i => i.value);
}

async function renderAccountHistory() {
  const pickEl = document.getElementById('acct-history-accounts');
  const rangeSel = document.getElementById('acct-history-range');
  if (!_acctInited) {
    _acctInited = true;
    const saved = (loadViewState().acctPick || []).filter(a => PAYMENT_METHODS.includes(a));
    const picked = saved.length ? saved : [SIM_DEFAULT_ACCOUNT];
    pickEl.innerHTML = PAYMENT_METHODS.map(a => `
      <label class="acct-pick-chip"><input type="checkbox" value="${escapeHtmlF(a)}" ${picked.includes(a) ? 'checked' : ''}><span>${escapeHtmlF(a)}</span></label>`).join('');
    pickEl.addEventListener('change', e => {
      // 0個にはしない（最後の1つは外せない）
      if (!acctPickedAccounts().length) { e.target.checked = true; return; }
      saveViewState('acctPick', acctPickedAccounts());
      renderAccountHistory();
    });
    rangeSel.addEventListener('change', renderAccountHistory);
  }
  const accounts = acctPickedAccounts();
  const multi = accounts.length > 1;
  const today = todayJST();
  const startD = new Date(); startD.setMonth(startD.getMonth() - Number(rangeSel.value));
  const start = dateStr(startD.getFullYear(), startD.getMonth(), startD.getDate());
  const endD = new Date(); endD.setDate(1); endD.setMonth(endD.getMonth() + 2); endD.setDate(0);
  const end = dateStr(endD.getFullYear(), endD.getMonth(), endD.getDate());

  const [{ data: accs }, { data: rawTxns }] = await Promise.all([
    db.from('accounts').select('account_name, balance').in('account_name', accounts),
    db.from('transactions').select('id, date, type, amount, category, memo, payment_method, created_at')
      .in('payment_method', accounts).gte('date', start).order('date').order('created_at'),
    loadSimData(),
  ]);
  // 複数のときは、どの口座の動きか分かるようにメモの後ろに口座名をつける
  const txns = (rawTxns || []).map(t => multi ? { ...t, memo: [t.memo, `［${t.payment_method}］`].filter(Boolean).join(' ') } : t);
  const balanceOf = a => (accs || []).find(x => x.account_name === a)?.balance ?? 0;

  // 残高は足し算なので、合計の残高と全部の取引でまとめてさかのぼれる
  const { list, past, startBalance, todayBalance } = acctReconstruct(accounts.reduce((t, a) => t + balanceOf(a), 0), txns, today);

  // これから: 記録済みの未来の取引 ＋ 予想
  // 同じ月に同じ金額の記録がもうあれば、その予想は出さない（給料が予定より早く振り込まれた・✓で登録済み など）
  // 予想の重複チェックは口座ごとに行う（ほかの口座の同じ金額で消さないように）
  const recordedFuture = list.filter(e => e.future).map(e => ({ ...e, label: e.label + '（記録済み）' }));
  const projected = accounts.flatMap(a => {
    const own = acctReconstruct(balanceOf(a), txns.filter(t => t.payment_method === a), today).list;
    return acctDedupe(acctProjectedEvents(a, today, end), own)
      .map(e => multi ? { ...e, label: `${e.label}［${a}］` } : e);
  });
  const future = [...recordedFuture, ...projected].sort((a, b) => a.date.localeCompare(b.date));
  let fr = todayBalance;
  for (const e of future) { fr += e.delta; e.after = fr; }

  // 今の残高と、これからの一番少ない残高
  const minFuture = future.reduce((mn, e) => e.after < mn.after ? e : mn, { after: todayBalance, date: today });
  document.getElementById('acct-history-now').innerHTML = `
    <div><span class="sim-row-sub">今日の残高</span><b class="${todayBalance < 0 ? 'sim-neg' : ''}">${todayBalance < 0 ? '−' : ''}${yen(todayBalance)}</b></div>
    <div><span class="sim-row-sub">来月末の予想</span><b class="${fr < 0 ? 'sim-neg' : ''}">${fr < 0 ? '−' : ''}${yen(fr)}</b></div>
    <div><span class="sim-row-sub">これから一番少ない日</span><b class="${minFuture.after < 0 ? 'sim-neg' : ''}">${acctShortDate(minFuture.date)} ${minFuture.after < 0 ? '−' : ''}${yen(minFuture.after)}</b></div>`;

  _acctChart = drawBalanceChart(document.getElementById('acct-history-chart'), _acctChart, startD, end, today, startBalance, past, future, document.getElementById('acct-day-detail'));
  document.getElementById('acct-day-detail').innerHTML = '<div class="sim-row-sub">グラフの日をタップすると、その日に何で増えて何で減るかが出ます</div>';

  // 表: これから（近い順）→ 今日 → 過去（新しい順）
  const row = (e, cls) => `
    <tr class="${cls}">
      <td>${acctShortDate(e.date)}</td>
      <td class="acct-label">${escapeHtmlF(e.label || '—')}${e.projected ? '<span class="sim-badge">予想</span>' : ''}</td>
      <td class="${e.delta >= 0 ? 'sim-inc' : 'sim-exp'}">${e.delta >= 0 ? '+' : '−'}${yen(e.delta)}</td>
      <td class="${e.after < 0 ? 'sim-neg' : ''}">${e.after < 0 ? '−' : ''}${yen(e.after)}</td>
    </tr>`;
  document.getElementById('acct-history-tbody').innerHTML =
    (future.length ? `<tr class="acct-row-section"><td colspan="4">これから（近い順）</td></tr>` : '') +
    future.map(e => row(e, 'acct-row-future')).join('') +
    `<tr class="acct-row-today"><td>${acctShortDate(today)}</td><td>今日</td><td></td><td><b>${todayBalance < 0 ? '−' : ''}${yen(todayBalance)}</b></td></tr>` +
    (past.length ? `<tr class="acct-row-section"><td colspan="4">これまで（新しい順）</td></tr>` : '') +
    [...past].reverse().map((e, i) => row(e, i >= ACCT_PAST_ROWS ? 'acct-row-more' : '')).join('') +
    (past.length > ACCT_PAST_ROWS ? `<tr class="acct-row-toggle"><td colspan="4"><button id="btn-acct-more">過去の取引をもっと見る（あと${past.length - ACCT_PAST_ROWS}件）</button></td></tr>` : '');
  const tbody = document.getElementById('acct-history-tbody');
  tbody.classList.remove('show-all');
  document.getElementById('btn-acct-more')?.addEventListener('click', e => {
    tbody.classList.add('show-all');
    e.currentTarget.closest('tr').remove();
  });
}

// 予定支出タブの中にある編集用モーダルを body 直下へ移す（ほかのタブ＝シミュからも開けるように）
['pr-flash', 'planned-register-modal', 'day-override-modal', 'amount-override-modal', 'planned-modal', 'sub-modal-f', 'loan-modal']
  .forEach(id => { const el = document.getElementById(id); if (el) document.body.appendChild(el); });

(function restoreView() {
  const st = loadViewState();
  // 予定支出はナビのタブ → シミュのサブタブに移した（2026-10-24）。前の保存は読み替える
  if (st.tab === 'planned') { st.tab = 'sim'; st.simSub = 'planned'; }
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
  if (st.tab === 'sim' && st.simSub === 'planned' && st.plannedSub) document.querySelector(`.sub-nav-btn[data-sub="${st.plannedSub}"]`)?.click();
})();
