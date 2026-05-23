// ============================================================
// Supabase設定（app.jsと同じ値）
// ============================================================
const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// Google Calendar 連携
// ============================================================
const GC_CLIENT_ID            = '1053779234925-qc97npjce6q3avsssjkfl3jvldjv4sj1.apps.googleusercontent.com';
const GC_SCOPE                = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const GCAL_TOKEN_KEY_HOME     = 'gcal_home_token';
const GCAL_AUTOLOGIN_KEY_HOME = 'gcal_home_autologin';

let gcTokenClient = null;
let gcalToken     = null;

function gcalTokenSaveHome(token) {
  gcalToken = token;
  sessionStorage.setItem(GCAL_TOKEN_KEY_HOME, JSON.stringify({ token, exp: Date.now() + 3500 * 1000 }));
}
function gcalTokenRestoreHome() {
  try {
    const s = JSON.parse(sessionStorage.getItem(GCAL_TOKEN_KEY_HOME));
    if (s && s.exp > Date.now()) { gcalToken = s.token; return true; }
  } catch {}
  return false;
}
function gcalTokenClearHome() {
  gcalToken = null;
  sessionStorage.removeItem(GCAL_TOKEN_KEY_HOME);
}

function initGcalHome() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGcalHome, 300);
    return;
  }

  // セッション内にトークンが残っていれば即復元
  if (gcalTokenRestoreHome()) {
    gcalFetchCalendars().then(cals => { gcCalendars = cals; populateCalendarSelect(cals); loadTodaySchedule(); });
    // バックグラウンドで token client も初期化（期限切れ対応）
  }

  gcTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GC_CLIENT_ID,
    scope:     GC_SCOPE,
    callback:  (resp) => {
      if (resp.error) { if (!gcalToken) loadTodaySchedule(); return; }
      gcalTokenSaveHome(resp.access_token);
      localStorage.setItem(GCAL_AUTOLOGIN_KEY_HOME, '1');
      gcalFetchCalendars().then(cals => { gcCalendars = cals; populateCalendarSelect(cals); loadTodaySchedule(); });
    },
    error_callback: () => { if (!gcalToken) loadTodaySchedule(); },
  });

  if (!gcalToken && localStorage.getItem(GCAL_AUTOLOGIN_KEY_HOME)) {
    gcTokenClient.requestAccessToken({ prompt: '' });
  } else if (!gcalToken) {
    loadTodaySchedule();
  }
}

window.onGoogleLibraryLoad = initGcalHome;

async function gcalCreate(summary, date, colorId) {
  if (!gcalToken) return null;
  const nextDay = new Date(date + 'T00:00:00');
  nextDay.setDate(nextDay.getDate() + 1);
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method:  'POST',
    headers: { Authorization: `Bearer ${gcalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      start:   { date },
      end:     { date: nextDay.toISOString().split('T')[0] },
      colorId: String(colorId),
    }),
  });
  if (res.status === 401) { gcalTokenClearHome(); return null; }
  if (!res.ok) return null;
  return (await res.json()).id;
}

async function gcalDelete(eventId) {
  if (!gcalToken || !eventId) return;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${gcalToken}` } }
  );
  if (res.status === 401) { gcalTokenClearHome(); }
}

async function gcalFetchToday(calendarId = 'primary') {
  if (!gcalToken) return [];
  const now  = new Date();
  const tMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const tMax = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const url  = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    + `?timeMin=${encodeURIComponent(tMin)}&timeMax=${encodeURIComponent(tMax)}`
    + `&singleEvents=true&orderBy=startTime&maxResults=20`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${gcalToken}` } });
  if (res.status === 401) { gcalTokenClearHome(); return []; }
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

async function loadTodaySchedule() {
  const el = document.getElementById('schedule-list');
  if (!el) return;

  if (!gcalToken) {
    el.innerHTML = `<div class="schedule-empty">
      <button class="gcal-login-btn" id="gcal-schedule-login">Googleでログイン</button>
    </div>`;
    document.getElementById('gcal-schedule-login')?.addEventListener('click', () => {
      gcTokenClient.requestAccessToken({ prompt: 'consent' });
    });
    return;
  }

  el.innerHTML = '<div class="schedule-loading">読み込み中...</div>';
  try {
    // 全カレンダーを並行取得して結合
    const targets = gcCalendars.length > 0 ? gcCalendars : [{ id: 'primary', backgroundColor: '#4285f4' }];
    const results = await Promise.all(
      targets.map(cal =>
        gcalFetchToday(cal.id).then(evs => evs.map(ev => ({ ...ev, _color: cal.backgroundColor })))
      )
    );
    const allEvents = results.flat().sort((a, b) => {
      const ta = a.start?.dateTime || a.start?.date || '';
      const tb = b.start?.dateTime || b.start?.date || '';
      return ta.localeCompare(tb);
    });

    if (allEvents.length === 0) {
      el.innerHTML = '<div class="schedule-empty">今日の予定はありません</div>';
      return;
    }
    el.innerHTML = allEvents.map(ev => {
      let timeStr = '終日';
      if (ev.start?.dateTime) {
        const s   = new Date(ev.start.dateTime);
        const e   = new Date(ev.end.dateTime);
        const fmt = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        timeStr = `${fmt(s)} – ${fmt(e)}`;
      }
      const dot = `<span class="schedule-dot" style="background:${ev._color || '#4285f4'}"></span>`;
      return `<div class="schedule-item">
        <div class="schedule-time">${timeStr}</div>
        ${dot}
        <div class="schedule-title">${ev.summary || '（タイトルなし）'}</div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="schedule-empty">読み込みに失敗しました</div>';
  }
}

let gcCalendars = [];

async function gcalFetchCalendars() {
  if (!gcalToken) return [];
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer',
    { headers: { Authorization: `Bearer ${gcalToken}` } }
  );
  if (res.status === 401) { gcalTokenClearHome(); return []; }
  const data = await res.json();
  return data.items || [];
}

function populateCalendarSelect(cals) {
  const select = document.getElementById('sch-calendar');
  if (!select) return;
  select.innerHTML = cals.map(cal =>
    `<option value="${cal.id}" style="background:${cal.backgroundColor || ''}">${cal.summary}</option>`
  ).join('');
}

async function gcalAddEvent(summary, startISO, endISO, calendarId = 'primary') {
  if (!gcalToken) return null;
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${gcalToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      summary,
      start: { dateTime: startISO, timeZone: tz },
      end:   { dateTime: endISO,   timeZone: tz },
    }),
  });
  if (res.status === 401) { gcalTokenClearHome(); return null; }
  return await res.json();
}

function initScheduleAddForm() {
  const toggleBtn = document.getElementById('schedule-add-toggle');
  const form      = document.getElementById('schedule-add-form');
  const cancelBtn = document.getElementById('sch-cancel');
  const submitBtn = document.getElementById('sch-submit');
  if (!toggleBtn || !form) return;

  // デフォルト日時：今日 + 次の30分刻み
  function setDefaultTimes() {
    const now      = new Date();
    const startMin = Math.ceil((now.getMinutes() + 1) / 30) * 30;
    const start    = new Date(now);
    start.setMinutes(startMin, 0, 0);
    if (startMin >= 60) { start.setHours(start.getHours() + 1); start.setMinutes(0); }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    document.getElementById('sch-date').value  = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    document.getElementById('sch-start').value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    document.getElementById('sch-end').value   = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }

  toggleBtn.addEventListener('click', async () => {
    form.classList.remove('hidden');
    toggleBtn.style.display = 'none';
    setDefaultTimes();
    // フォームを開くたびにカレンダー一覧を取得（未取得または空の場合）
    if (gcalToken) {
      const select = document.getElementById('sch-calendar');
      if (gcCalendars.length === 0) {
        if (select) select.innerHTML = '<option value="primary">読み込み中...</option>';
        gcCalendars = await gcalFetchCalendars();
      }
      populateCalendarSelect(gcCalendars);
    }
    document.getElementById('sch-title').focus();
  });

  cancelBtn.addEventListener('click', () => {
    form.classList.add('hidden');
    toggleBtn.style.display = '';
    form.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('sch-title').value.trim();
    const sTime = document.getElementById('sch-start').value;
    const eTime = document.getElementById('sch-end').value;
    if (!title || !sTime || !eTime) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '追加中...';

    const date       = document.getElementById('sch-date').value || new Date().toISOString().split('T')[0];
    const startISO   = `${date}T${sTime}:00`;
    const endISO     = `${date}T${eTime}:00`;
    const calendarId = document.getElementById('sch-calendar')?.value || 'primary';

    const result = await gcalAddEvent(title, startISO, endISO, calendarId);
    submitBtn.disabled = false;
    submitBtn.textContent = '追加';

    if (result) {
      form.classList.add('hidden');
      toggleBtn.style.display = '';
      form.reset();
      await loadTodaySchedule();
    } else {
      submitBtn.textContent = '失敗・再試行';
      setTimeout(() => { submitBtn.textContent = '追加'; }, 2000);
    }
  });
}

// ============================================================
// 定数
// ============================================================
const INCOME_CATEGORIES  = ['仕送り', 'バイト', 'Sports Betting'];
const EXPENSE_CATEGORIES = ['食費', '交通費', '衣類・アクセサリー', '娯楽費', '旅費', 'サブスクリプション', '美容', 'ガジェット', '必需品', '科目変換'];
const PAYMENT_METHODS    = ['deposit（銀行）', 'cash（現金）', 'PayPay', 'Rakuten Pay', 'non-trade payables', 'credit trade payable'];

// ============================================================
// ユーティリティ
// ============================================================
function yen(n) {
  return '¥' + Math.abs(n).toLocaleString('ja-JP');
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function monthRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    start: new Date(y, m, 1).toISOString().split('T')[0],
    end:   new Date(y, m + 1, 0).toISOString().split('T')[0],
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

// ============================================================
// 時計
// ============================================================
function drawAnalogClock() {
  const canvas = document.getElementById('analog-clock');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const now = new Date();
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) / 2 - 10;

  ctx.clearRect(0, 0, W, H);

  // 文字盤
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#FDFCFA';
  ctx.fill();
  ctx.strokeStyle = '#DDD8D0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 内側の薄いリング
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, 2 * Math.PI);
  ctx.strokeStyle = '#EDE9E3';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // 60分目盛り
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const isQuarter = i % 15 === 0;
    const isHour    = i % 5  === 0;
    ctx.beginPath();
    ctx.lineCap = 'round';
    if (isQuarter) {
      ctx.moveTo(cx + Math.cos(angle) * (r - 8),  cy + Math.sin(angle) * (r - 8));
      ctx.lineTo(cx + Math.cos(angle) * (r - 19), cy + Math.sin(angle) * (r - 19));
      ctx.strokeStyle = '#1C2340';
      ctx.lineWidth = 2;
    } else if (isHour) {
      ctx.moveTo(cx + Math.cos(angle) * (r - 9),  cy + Math.sin(angle) * (r - 9));
      ctx.lineTo(cx + Math.cos(angle) * (r - 15), cy + Math.sin(angle) * (r - 15));
      ctx.strokeStyle = '#8C8880';
      ctx.lineWidth = 1.2;
    } else {
      ctx.moveTo(cx + Math.cos(angle) * (r - 10), cy + Math.sin(angle) * (r - 10));
      ctx.lineTo(cx + Math.cos(angle) * (r - 13), cy + Math.sin(angle) * (r - 13));
      ctx.strokeStyle = '#C8C4BC';
      ctx.lineWidth = 0.8;
    }
    ctx.stroke();
  }

  const h = now.getHours() % 12, mi = now.getMinutes(), s = now.getSeconds();

  // 時針
  hand(ctx, cx, cy, (h / 12 + mi / 720) * 2 * Math.PI - Math.PI / 2, r * 0.50, 3.5, '#1C2340');
  // 分針
  hand(ctx, cx, cy, (mi / 60 + s / 3600) * 2 * Math.PI - Math.PI / 2, r * 0.70, 2, '#1C2340');
  // 秒針（尾付き）
  const secAngle = (s / 60) * 2 * Math.PI - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(secAngle + Math.PI) * r * 0.20, cy + Math.sin(secAngle + Math.PI) * r * 0.20);
  ctx.lineTo(cx + Math.cos(secAngle) * r * 0.82,           cy + Math.sin(secAngle) * r * 0.82);
  ctx.strokeStyle = '#C0392B';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 中心キャップ
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#1C2340';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#C0392B';
  ctx.fill();
}

function hand(ctx, cx, cy, angle, len, width, color) {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function updateDigitalTime() {
  const now = new Date();
  const el = document.getElementById('digital-time');
  if (el) el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const subEl = document.getElementById('clock-date-sub');
  if (subEl) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    subEl.textContent = `${days[now.getDay()]}. ${now.getFullYear()} / ${now.getMonth() + 1} / ${now.getDate()}`;
  }

  const dateEl = document.getElementById('pc-date');
  if (dateEl) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${days[now.getDay()]}）`;
  }
}

function startClock() {
  function tick() {
    drawAnalogClock();
    updateDigitalTime();
    // 次の「秒の変わり目」に合わせて発火（ズレを自己補正）
    setTimeout(tick, 1000 - new Date().getMilliseconds());
  }
  tick();
}

// ============================================================
// 今月の収支サマリー
// ============================================================
async function loadFinanceSummary() {
  const { start, end } = monthRange();
  const { data: txns } = await db.from('transactions').select('type, amount').gte('date', start).lte('date', end);
  const rows = txns || [];

  const income  = rows.filter(t => t.type === 'income' ).reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const profit  = income - expense;

  document.getElementById('home-income').textContent  = yen(income);
  document.getElementById('home-expense').textContent = yen(expense);

  const profitEl = document.getElementById('home-profit');
  profitEl.textContent = (profit >= 0 ? '+' : '−') + yen(profit);
  profitEl.className   = 'fin-value ' + (profit >= 0 ? 'pos' : 'neg');
}

// ============================================================
// ToDo（PC版）
// ============================================================
const HOME_CAT_COLORS = {
  '神大':   '#2980B9',
  'バイト': '#F39C12',
  'Betting':'#E74C3C',
  '資格':   '#27AE60',
  'その他': '#95A5A6',
};

let pendingHomeSchedules = [];

function renderHomeScheduleChips() {
  const el = document.getElementById('pc-todo-schedule-chips');
  if (!el) return;
  el.innerHTML = pendingHomeSchedules.map(d =>
    `<span class="s-chip">${formatHomeDate(d)}<button type="button" class="s-chip-del" data-date="${d}">×</button></span>`
  ).join('');
  el.querySelectorAll('.s-chip-del').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingHomeSchedules = pendingHomeSchedules.filter(d => d !== btn.dataset.date);
      renderHomeScheduleChips();
    });
  });
}

function formatHomeDate(dateStr) {
  const d    = new Date(dateStr + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
}

document.getElementById('pc-todo-schedule-add')?.addEventListener('click', () => {
  const val = document.getElementById('pc-todo-scheduled-input').value;
  if (!val || pendingHomeSchedules.includes(val)) return;
  pendingHomeSchedules.push(val);
  pendingHomeSchedules.sort();
  document.getElementById('pc-todo-scheduled-input').value = '';
  renderHomeScheduleChips();
});

async function loadPcTodos() {
  const { data: todos } = await db.from('todos')
    .select('*, task_schedules(schedule_date)')
    .order('created_at');
  const list = document.getElementById('pc-todo-list');
  if (!list) return;

  const today = todayStr();
  list.innerHTML = (todos || []).map(t => {
    const overdue    = t.due_date && t.due_date < today && t.status !== 'done';
    const catBadge   = t.category ? `<span class="cat-badge cat-${t.category}">${t.category}</span>` : '';
    const schedules  = (t.task_schedules || []).sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
    const schedBadges = schedules.length > 0
      ? `<div class="todo-schedules">${schedules.map(s => `<span class="s-badge">🗓 ${formatHomeDate(s.schedule_date)}</span>`).join('')}</div>`
      : '';
    return `
      <div class="todo-item status-${t.status || 'will'}" data-id="${t.id}">
        <div class="todo-main">
          <select class="status-select" data-id="${t.id}">
            <option value="will"  ${t.status === 'will'  ? 'selected' : ''}>Will</option>
            <option value="doing" ${t.status === 'doing' ? 'selected' : ''}>Doing</option>
            <option value="done"  ${t.status === 'done'  ? 'selected' : ''}>Done</option>
          </select>
          <div class="todo-info">
            <div class="todo-text ${t.status === 'done' ? 'done' : ''}">${t.text}</div>
            <div class="todo-meta">
              ${catBadge}
              ${t.due_date ? `<span class="todo-due ${overdue ? 'overdue' : ''}">📅 ${formatHomeDate(t.due_date)}</span>` : ''}
            </div>
            ${schedBadges}
          </div>
        </div>
        <div class="todo-actions">
          <button class="todo-del" data-id="${t.id}">×</button>
        </div>
      </div>`;
  }).join('') || '<div style="font-size:13px;color:var(--muted);padding:8px 0">タスクがありません</div>';

  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const newStatus = sel.value;
      const updates   = { status: newStatus };
      if (newStatus === 'done') updates.done_at = todayStr();
      else updates.done_at = null;
      await db.from('todos').update(updates).eq('id', sel.dataset.id);
      loadPcTodos();
    });
  });

  list.querySelectorAll('.todo-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('削除しますか？\nGoogleカレンダーのイベントも削除されます。')) return;
      const id = btn.dataset.id;
      const { data: todoData } = await db.from('todos')
        .select('gcal_due_event_id, task_schedules(gcal_event_id)')
        .eq('id', id).single();
      if (todoData) {
        await gcalDelete(todoData.gcal_due_event_id);
        for (const s of (todoData.task_schedules || [])) await gcalDelete(s.gcal_event_id);
      }
      await db.from('todos').delete().eq('id', id);
      loadPcTodos();
    });
  });

  buildGanttTimeline(todos);
}

document.getElementById('pc-todo-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text     = document.getElementById('pc-todo-input').value.trim();
  const status   = document.getElementById('pc-todo-status').value;
  const category = document.getElementById('pc-todo-category').value || null;
  const startDate = document.getElementById('pc-todo-start').value || null;
  const dueDate   = document.getElementById('pc-todo-due').value   || null;
  if (!text) return;

  const payload = {
    text,
    status,
    category,
    start_date: startDate,
    due_date:   dueDate,
    done_at:    status === 'done' ? todayStr() : null,
  };

  const { data: newTodo } = await db.from('todos').insert([payload]).select().single();

  if (newTodo) {
    if (dueDate) {
      const eventId = await gcalCreate(`【締切】${text}`, dueDate, 11);
      if (eventId) await db.from('todos').update({ gcal_due_event_id: eventId }).eq('id', newTodo.id);
    }
    for (const date of pendingHomeSchedules) {
      const eventId = await gcalCreate(`【予定】${text}`, date, 9);
      await db.from('task_schedules').insert([{ todo_id: newTodo.id, schedule_date: date, gcal_event_id: eventId }]);
    }
  }

  pendingHomeSchedules = [];
  renderHomeScheduleChips();
  e.target.reset();
  loadPcTodos();
});

// ============================================================
// ガントタイムライン（PC版）
// ============================================================
const HOME_CELL_W = 28;
let homeTlMonth   = new Date();
let ganttEditTodo = null;

function buildGanttTimeline(todos) {
  const year     = homeTlMonth.getFullYear();
  const month    = homeTlMonth.getMonth();
  const first    = new Date(year, month, 1);
  const last     = new Date(year, month + 1, 0);
  const days     = last.getDate();
  const firstStr = first.toISOString().split('T')[0];
  const lastStr  = last.toISOString().split('T')[0];
  const today    = todayStr();
  const WEEK     = ['日', '月', '火', '水', '木', '金', '土'];
  const totalW   = days * HOME_CELL_W;

  const monthEl = document.getElementById('home-tl-month');
  if (monthEl) monthEl.textContent = `${year}年${month + 1}月`;

  const dated = (todos || []).filter(t => t.start_date || t.due_date);

  // ラベル列
  const labelsEl = document.getElementById('home-tl-labels');
  if (!labelsEl) return;
  labelsEl.innerHTML =
    `<div class="home-tl-label-header"></div>` +
    dated.map(t => `<div class="home-tl-label-row"><span class="home-tl-label-name ${t.status === 'done' ? 'done' : ''}" title="${t.text}">${t.text}</span></div>`).join('') +
    (dated.length === 0 ? '<div class="home-tl-empty">日付のあるタスクがありません</div>' : '');

  // ヘッダー（日付）
  const headerEl = document.getElementById('home-tl-header');
  headerEl.style.width = totalW + 'px';
  headerEl.innerHTML = Array.from({ length: days }, (_, i) => {
    const d   = new Date(year, month, i + 1);
    const dow = d.getDay();
    return `<div class="home-tl-day-header ${dow === 0 || dow === 6 ? 'we' : ''}" style="left:${i * HOME_CELL_W}px;width:${HOME_CELL_W}px">
      <div class="home-tl-day-num">${i + 1}</div>
      <div class="home-tl-day-name">${WEEK[dow]}</div>
    </div>`;
  }).join('');

  // タスク行
  const rowsEl = document.getElementById('home-tl-rows');
  rowsEl.innerHTML = '';

  dated.forEach(task => {
    const row = document.createElement('div');
    row.className  = 'home-tl-row';
    row.style.width = totalW + 'px';

    Array.from({ length: days }, (_, i) => {
      const d    = new Date(year, month, i + 1);
      const dStr = d.toISOString().split('T')[0];
      const dow  = d.getDay();
      const cell = document.createElement('div');
      cell.className = `home-tl-cell ${dow === 0 || dow === 6 ? 'we' : ''} ${dStr === today ? 'today' : ''}`;
      cell.style.cssText = `left:${i * HOME_CELL_W}px;width:${HOME_CELL_W}px`;
      row.appendChild(cell);
    });

    if (today >= firstStr && today <= lastStr) {
      const marker = document.createElement('div');
      marker.className = 'home-tl-today-line';
      marker.style.left = `${(parseInt(today.split('-')[2]) - 0.5) * HOME_CELL_W}px`;
      row.appendChild(marker);
    }

    let startStr = task.start_date || task.due_date;
    let endStr   = task.due_date || task.start_date;
    if (startStr > endStr) [startStr, endStr] = [endStr, startStr];

    const cs = startStr < firstStr ? firstStr : startStr;
    const ce = endStr   > lastStr  ? lastStr  : endStr;

    if (cs <= lastStr && ce >= firstStr) {
      const s       = parseInt(cs.split('-')[2]) - 1;
      const e       = parseInt(ce.split('-')[2]) - 1;
      const bar     = document.createElement('div');
      bar.className = 'home-tl-bar';
      const barColor = HOME_CAT_COLORS[task.category] || '#4A90D9';
      bar.style.cssText = `left:${s * HOME_CELL_W + 2}px;width:${(e - s + 1) * HOME_CELL_W - 4}px;opacity:${task.status === 'done' ? 0.4 : 1};background:${barColor}`;
      const span = document.createElement('span');
      span.className   = 'home-tl-bar-text';
      span.textContent = task.text;
      bar.appendChild(span);
      bar.addEventListener('click', (ev) => { ev.stopPropagation(); openGanttModal(task); });
      row.appendChild(bar);
    }

    rowsEl.appendChild(row);
  });

  if (today >= firstStr && today <= lastStr) {
    const scrollEl = document.getElementById('home-tl-scroll');
    if (scrollEl) scrollEl.scrollLeft = Math.max(0, (parseInt(today.split('-')[2]) - 4) * HOME_CELL_W);
  }
}

function openGanttModal(todo) {
  ganttEditTodo = todo;
  document.getElementById('home-tl-edit-text').value      = todo.text;
  document.getElementById('home-tl-edit-scheduled').value = todo.start_date || '';
  document.getElementById('home-tl-edit-due').value       = todo.due_date   || '';
  document.getElementById('home-tl-overlay').classList.add('active');
}

function closeGanttModal() {
  document.getElementById('home-tl-overlay').classList.remove('active');
  ganttEditTodo = null;
}

document.getElementById('home-tl-edit-cancel')?.addEventListener('click', closeGanttModal);
document.getElementById('home-tl-overlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('home-tl-overlay')) closeGanttModal();
});

document.getElementById('home-tl-edit-save')?.addEventListener('click', async () => {
  if (!ganttEditTodo) return;
  const todo       = ganttEditTodo;
  const newText    = document.getElementById('home-tl-edit-text').value.trim();
  const newStart   = document.getElementById('home-tl-edit-scheduled').value || null;
  const newDue     = document.getElementById('home-tl-edit-due').value       || null;
  if (!newText) return;

  await db.from('todos').update({ text: newText, start_date: newStart, due_date: newDue }).eq('id', todo.id);

  // 締切日が変わった場合はGCal更新
  if (newDue !== todo.due_date) {
    if (todo.gcal_due_event_id) await gcalDelete(todo.gcal_due_event_id);
    if (newDue) {
      const newId = await gcalCreate(`【締切】${newText}`, newDue, 11);
      if (newId) await db.from('todos').update({ gcal_due_event_id: newId }).eq('id', todo.id);
    } else {
      await db.from('todos').update({ gcal_due_event_id: null }).eq('id', todo.id);
    }
  }

  closeGanttModal();
  loadPcTodos();
});

document.getElementById('home-tl-prev')?.addEventListener('click', () => {
  homeTlMonth = new Date(homeTlMonth.getFullYear(), homeTlMonth.getMonth() - 1, 1);
  loadPcTodos();
});
document.getElementById('home-tl-next')?.addEventListener('click', () => {
  homeTlMonth = new Date(homeTlMonth.getFullYear(), homeTlMonth.getMonth() + 1, 1);
  loadPcTodos();
});

// ============================================================
// ToDo（モバイル版）
// ============================================================
async function loadMobileTodos() {
  const { data: todos } = await db.from('todos').select('*').order('created_at');
  const list = document.getElementById('mobile-todo-list');
  if (!list) return;

  list.innerHTML = (todos || []).map(t => `
    <div class="todo-item">
      <input class="todo-checkbox" type="checkbox" data-id="${t.id}" ${t.completed ? 'checked' : ''}>
      <span class="todo-text ${t.completed ? 'done' : ''}">${t.text}</span>
      <button class="todo-del" data-id="${t.id}">×</button>
    </div>
  `).join('') || '<div style="font-size:13px;color:var(--muted);padding:4px 0">タスクがありません</div>';

  list.querySelectorAll('.todo-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      await db.from('todos').update({ completed: cb.checked }).eq('id', cb.dataset.id);
      loadMobileTodos();
    });
  });
  list.querySelectorAll('.todo-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await db.from('todos').delete().eq('id', btn.dataset.id);
      loadMobileTodos();
    });
  });
}

document.getElementById('mobile-todo-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('mobile-todo-input').value.trim();
  if (!text) return;
  await db.from('todos').insert([{ text }]);
  document.getElementById('mobile-todo-input').value = '';
  loadMobileTodos();
});

// ============================================================
// ルーティン（PC版）
// ============================================================
const ROUTINE_KEYS = ['ielts', 'reading', 'training'];

async function loadRoutine() {
  const today = todayStr();
  const days  = ['日', '月', '火', '水', '木', '金', '土'];
  const now   = new Date();
  const labelEl = document.getElementById('routine-today-label');
  if (labelEl) labelEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日（${days[now.getDay()]}）`;

  const { data } = await db.from('routine_logs').select('*').eq('date', today).single();

  document.querySelectorAll('.routine-item input[type="checkbox"]').forEach(cb => {
    const key = cb.dataset.key;
    cb.checked = data ? !!data[key] : false;
    cb.addEventListener('change', () => saveRoutine());
  });

  updateRoutineProgress();
}

function updateRoutineProgress() {
  const checks = document.querySelectorAll('.routine-item input[type="checkbox"]');
  const done   = [...checks].filter(cb => cb.checked).length;
  const pct    = (done / ROUTINE_KEYS.length) * 100;

  const fill = document.getElementById('routine-progress-fill');
  const count = document.getElementById('routine-count');
  if (fill)  fill.style.width = pct + '%';
  if (count) count.textContent = `${done} / ${ROUTINE_KEYS.length}`;
}

async function saveRoutine() {
  updateRoutineProgress();
  const today   = todayStr();
  const payload = { date: today };
  document.querySelectorAll('.routine-item input[type="checkbox"]').forEach(cb => {
    payload[cb.dataset.key] = cb.checked;
  });
  await db.from('routine_logs').upsert([payload], { onConflict: 'date' });
}

// ============================================================
// Habit Chart
// ============================================================
let habitChart = null;

async function loadHabitChart() {
  const end   = todayStr();
  const start = new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];

  const { data: logs } = await db.from('routine_logs').select('*').gte('date', start).lte('date', end);
  const logMap = {};
  (logs || []).forEach(l => { logMap[l.date] = l; });

  const labels = [], counts = [], colors = [];

  for (let i = 29; i >= 0; i--) {
    const d   = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    const log = logMap[d];
    const cnt = log ? (log.ielts ? 1 : 0) + (log.reading ? 1 : 0) + (log.training ? 1 : 0) : 0;

    labels.push(d.slice(5));  // MM-DD
    counts.push(cnt);
    colors.push(cnt === 3 ? '#27AE60' : cnt >= 1 ? '#F5A623' : '#E4E9F0');
  }

  if (habitChart) habitChart.destroy();

  habitChart = new Chart(document.getElementById('habit-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y} / 3 完了`,
          },
        },
      },
      scales: {
        y: {
          min: 0, max: 3,
          ticks: { stepSize: 1 },
          grid: { color: '#F2F4F7' },
        },
        x: {
          ticks: {
            maxRotation: 0,
            callback: (val, i) => i % 5 === 0 ? labels[i] : '',
          },
          grid: { display: false },
        },
      },
    },
  });
}

// ============================================================
// モバイル収支入力
// ============================================================
let mobileType = 'expense';

function buildOptions(selectEl, items) {
  if (!selectEl) return;
  selectEl.innerHTML = items.map(v => `<option value="${v}">${v}</option>`).join('');
}

function updateMobileCategories() {
  const cats = mobileType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  buildOptions(document.getElementById('m-category'), cats);
}

buildOptions(document.getElementById('m-payment'), PAYMENT_METHODS);
updateMobileCategories();

document.querySelectorAll('#mobile-home .type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    mobileType = btn.dataset.type;
    document.querySelectorAll('#mobile-home .type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateMobileCategories();
    const sub = document.getElementById('m-submit');
    if (sub) sub.style.background = mobileType === 'income' ? 'var(--income)' : 'var(--expense)';
  });
});

document.getElementById('mobile-finance-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('m-message');
  const sub   = document.getElementById('m-submit');
  sub.disabled = true;
  sub.textContent = '登録中...';

  const payload = {
    date:           todayStr(),
    type:           mobileType,
    amount:         parseInt(document.getElementById('m-amount').value, 10),
    category:       document.getElementById('m-category').value,
    payment_method: document.getElementById('m-payment').value,
    memo:           '',
  };

  const { error } = await db.from('transactions').insert([payload]);

  if (!error) {
    // 口座残高を自動更新
    const { data: acc } = await db.from('accounts').select('balance').eq('account_name', payload.payment_method).single();
    if (acc) {
      const delta = mobileType === 'income' ? payload.amount : -payload.amount;
      await db.from('accounts').update({ balance: acc.balance + delta }).eq('account_name', payload.payment_method);
    }
    msgEl.style.color = 'var(--profit-pos)';
    msgEl.textContent = '✓ 登録しました';
    document.getElementById('m-amount').value = '';
    setTimeout(() => { msgEl.textContent = ''; }, 2500);
  } else {
    msgEl.style.color = 'var(--profit-neg)';
    msgEl.textContent = 'エラー: ' + error.message;
  }

  sub.disabled = false;
  sub.textContent = '登録する';
});

// ============================================================
// 初期化
// ============================================================
startClock();
loadFinanceSummary();
loadPcTodos();
loadMobileTodos();
loadRoutine();
loadHabitChart();
initScheduleAddForm();
