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
const INCOME_CATEGORIES = ['仕送り', 'バイト', 'Sports Betting'];

const EXPENSE_CATEGORIES = [
  '食費', '交通費', '衣類・アクセサリー', '娯楽費', '旅費',
  'サブスクリプション', '美容', 'ガジェット', '必需品', '科目変換',
];

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

    if (tab === 'dashboard') renderDashboard();
    if (tab === 'list')      renderList();
    if (tab === 'accounts')  renderAccounts();
    if (tab === 'planned')   renderPlannedTab();
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

// カテゴリ初期化
updateCategoryOptions();

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
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  const container = document.getElementById('transaction-list');

  if (!txns || txns.length === 0) {
    container.innerHTML = '<div class="empty-msg">この月のデータはありません</div>';
    return;
  }

  container.innerHTML = txns.map(t => {
    const sign     = t.type === 'income' ? '+' : '−';
    const memo     = t.memo     ? ` · ${t.memo}`     : '';
    const location = t.location ? ` · 📍${t.location}` : '';
    return `
      <div class="txn-item">
        <div class="txn-dot ${t.type}"></div>
        <div class="txn-info">
          <div class="txn-category">${t.category}</div>
          <div class="txn-meta">${t.date} · ${t.payment_method}${location}${memo}</div>
        </div>
        <div class="txn-amount ${t.type}">${sign}${yen(t.amount)}</div>
        <button class="txn-delete" data-id="${t.id}" title="削除">×</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.txn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('この記録を削除しますか？')) return;

      // 削除前に取引内容を取得して残高を元に戻す
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
        // 削除した取引の逆方向に残高を更新
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

  // サブスク（Life）+ 予定支出 + ローン を並行取得
  const [subRes, planRes, loanRes] = await Promise.all([
    db.from('subscriptions').select('*').eq('status', 'active'),
    db.from('planned_expenses').select('*').order('billing_day'),
    db.from('loans').select('*'),
  ]);

  const usdRate = 150; // 簡易レート（Life と共有不可なため固定）

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
    billingDay:   (() => { const d = r.start_date ? new Date(r.start_date) : null; return r.billing_day || (d ? d.getDate() : null); })(),
    billingMonth: r.start_date ? new Date(r.start_date).getMonth() : null,
    startDate:   r.start_date  || null,
    endDate:     null,
    note:        r.note        || null,
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
  }));

  // ローンを統一フォーマットに変換
  const loanItems = (loanRes.data || []).map(r => ({
    id:          r.id,
    source:      'loan',
    name:        r.name,
    amount:      r.monthly_payment,
    category:    'loan',
    frequency:   'monthly',
    billingDay:  r.start_date ? new Date(r.start_date).getDate() : null,
    billingMonth: null,
    startDate:   r.start_date || null,
    endDate:     r.end_date   || null,
    note:        r.note       || null,
  }));

  const all = [...subItems, ...planItems, ...loanItems].filter(it => isActiveInMonth(it, year, month));
  all.sort((a, b) => (a.billingDay || 99) - (b.billingDay || 99));

  const total = all.reduce((s, it) => s + it.amount, 0);
  document.getElementById('planned-total').textContent = '¥' + total.toLocaleString();

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
      const typeBadge = it.source === 'subscription'
        ? `<span class="badge-sub">サブスク</span><span class="badge-freq">${it.frequency === 'yearly' ? '年' : '月'}</span>`
        : it.source === 'loan'
        ? `<span class="badge-sub" style="background:#e8f4e8;color:#27ae60">ローン</span>`
        : '';
      return `
        <div class="planned-item">
          <div class="planned-item-left">
            <span class="planned-day">${dayLabel}</span>
            <div>
              <div class="planned-name">${escapeHtmlF(it.name)} ${typeBadge}</div>
              ${it.note ? `<div class="planned-note">${escapeHtmlF(it.note)}</div>` : ''}
            </div>
          </div>
          <div class="planned-item-right">
            <span class="planned-amount">¥${it.amount.toLocaleString()}</span>
            ${it.source === 'planned' ? `<button class="planned-edit-btn" data-id="${it.id}">編集</button>` : ''}
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
    btn.addEventListener('click', () => openPlannedEditForm(btn.dataset.id, planRes.data));
  });
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
  form.elements.paymentMethod.value = s.paymentMethod;
  form.elements.status.value        = s.status;
  form.elements.note.value          = s.note;
  document.getElementById('sub-form-title-f').textContent = '編集';
  updateSubCostFieldsF(s.contractForm);
  document.getElementById('sub-modal-f').hidden = false;
}

async function deleteSubF(id) {
  const s = _subsF.find(x => x.id === id);
  if (!s || !confirm(`「${s.name}」を削除しますか？`)) return;
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
          <span class="loan-monthly">月¥${(l.monthlyPayment || 0).toLocaleString()}</span>
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
  form.elements.remainingAmount.value = l.remainingAmount != null ? l.remainingAmount : '';
  form.elements.startDate.value       = l.startDate;
  form.elements.endDate.value         = l.endDate;
  form.elements.note.value            = l.note;
  document.getElementById('loan-form-title').textContent = '編集';
  document.getElementById('loan-modal').hidden = false;
}

async function deleteLoan(id) {
  const l = _loans.find(x => x.id === id);
  if (!l || !confirm(`「${l.name}」を削除しますか？`)) return;
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
fetchUsdRateF();
renderDashboard();
initPlannedTab();
initPlannedSubTabs();
initSubsF();
initLoans();
renderPlannedTab();
