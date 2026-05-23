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
// 初期表示
// ============================================================
renderDashboard();
