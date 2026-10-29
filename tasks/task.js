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
function ymdStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function localDateStr(date) {
  return ymdStr(date.getFullYear(), date.getMonth(), date.getDate());
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

// ============================================================
// 定数
// ============================================================
const ROUTINE_KEYS = ['ielts', 'reading', 'training'];
const CELL_W       = 36;

const CAT_COLORS = {
  '神大':   '#2980B9',
  'バイト': '#F39C12',
  'Betting':'#ff3b30',
  '資格':   '#34c759',
  'その他': '#95A5A6',
};

// ============================================================
// Google Calendar 連携
// ============================================================
let gcalToken = null;

// 鍵はサーバーからもらう（../shared/gcal.js）。まだ接続していなければヘッダーに接続ボタン
function initGcal() {
  gcalAutoToken(token => {
    gcalToken = token;
    if (token) hideGcalAuthBtn(); else showGcalAuthBtn();
  });
}

function showGcalAuthBtn() {
  if (document.getElementById('gcal-auth-btn')) return;
  const btn = document.createElement('button');
  btn.id        = 'gcal-auth-btn';
  btn.className = 'gcal-auth-btn';
  btn.innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg> GCal 認証';
  btn.addEventListener('click', gcalConnect);
  document.querySelector('.header').appendChild(btn);
}

function hideGcalAuthBtn() {
  document.getElementById('gcal-auth-btn')?.remove();
}

// GCal: イベント作成（日付はYYYY-MM-DD、colorId: 11=赤/締切、9=青/予定）
async function gcalCreate(summary, date, colorId) {
  if (!gcalToken) return null;
  const nextDay = new Date(date + 'T00:00:00');
  nextDay.setDate(nextDay.getDate() + 1);
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${gcalToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      start:   { date },
      end:     { date: localDateStr(nextDay) },
      colorId: String(colorId),
    }),
  });
  if (res.status === 401) { gcalToken = null; showGcalAuthBtn(); return null; }
  if (!res.ok) return null;
  return (await res.json()).id;
}

// GCal: イベント削除
async function gcalDelete(eventId) {
  if (!gcalToken || !eventId) return;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${gcalToken}` } }
  );
  if (res.status === 401) { gcalToken = null; showGcalAuthBtn(); }
}

// ============================================================
// ユーティリティ
// ============================================================
function todayStr() {
  return localDateStr(new Date());
}

function formatDate(dateStr) {
  const d    = new Date(dateStr + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
}

function getRoutineDate() {
  const now = new Date();
  if (now.getHours() < 3) {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return localDateStr(y);
  }
  return localDateStr(now);
}

// ============================================================
// タブ切り替え
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'routine') initRoutine();
    if (tab === 'plan')    loadPlan();
  });
});

// ============================================================
// ビュー切り替え（リスト / タイムライン）
// ============================================================
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-list').style.display     = view === 'list'     ? '' : 'none';
    document.getElementById('view-timeline').style.display = view === 'timeline' ? '' : 'none';
    if (view === 'timeline') renderTimeline();
  });
});

// ============================================================
// 実行予定日（フォーム用一時ステート）
// ============================================================
let pendingSchedules = [];

function renderScheduleChips() {
  const el = document.getElementById('todo-schedule-chips');
  if (!el) return;
  el.innerHTML = pendingSchedules.map(d =>
    `<span class="s-chip">${formatDate(d)}<button type="button" class="s-chip-del" data-date="${d}">×</button></span>`
  ).join('');
  el.querySelectorAll('.s-chip-del').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingSchedules = pendingSchedules.filter(d => d !== btn.dataset.date);
      renderScheduleChips();
    });
  });
}

document.getElementById('todo-schedule-add').addEventListener('click', () => {
  const val = document.getElementById('todo-schedule-input').value;
  if (!val || pendingSchedules.includes(val)) return;
  pendingSchedules.push(val);
  pendingSchedules.sort();
  document.getElementById('todo-schedule-input').value = '';
  renderScheduleChips();
});

// ============================================================
// ToDo
// ============================================================
let currentStatus = 'all';
let currentCat    = 'all';

document.querySelectorAll('.status-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentStatus = btn.dataset.status;
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadTodos();
  });
});

document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentCat = btn.dataset.cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadTodos();
  });
});

document.getElementById('todo-allday').addEventListener('change', (e) => {
  const timeInput = document.getElementById('todo-time');
  timeInput.disabled = e.target.checked;
  if (e.target.checked) timeInput.value = '';
});

async function loadTodos() {
  let query = db.from('todos')
    .select('*, task_schedules(schedule_date)')
    .order('created_at');
  if (currentStatus !== 'all') query = query.eq('status', currentStatus);
  if (currentCat    !== 'all') query = query.eq('category', currentCat);

  const { data: todos } = await query;
  const list  = document.getElementById('todo-list');
  const today = todayStr();

  const order  = { will: 0, doing: 1, done: 2 };
  const sorted = (todos || []).sort((a, b) => order[a.status] - order[b.status]);

  list.innerHTML = sorted.map(t => {
    const overdue  = t.due_date && t.due_date < today && t.status !== 'done';
    const dueLabel = t.due_date
      ? (t.is_all_day || !t.due_time
          ? `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg> ${formatDate(t.due_date)}`
          : `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg> ${formatDate(t.due_date)} ${t.due_time}`)
      : '';
    const catBadge  = t.category ? `<span class="cat-badge cat-${t.category}">${t.category}</span>` : '';
    const doneDate  = t.done_at  ? `<span class="done-date">✓ ${t.done_at}</span>` : '';
    const goal      = t.goal_id  ? planGoals.find(g => g.id === t.goal_id) : null;
    const goalBadge = goal ? `<span class="goal-badge" style="color:${goal.color}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> ${escapeHtmlT(goal.title)}</span>` : '';

    // 実行予定日チップ
    const schedules = (t.task_schedules || [])
      .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
    const scheduleBadges = schedules.length > 0
      ? `<div class="todo-schedules">${schedules.map(s =>
          `<span class="s-badge"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg> ${formatDate(s.schedule_date)}</span>`
        ).join('')}</div>`
      : '';

    return `
      <div class="todo-item status-${t.status}">
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
              ${goalBadge}
              ${t.due_date ? `<span class="todo-due ${overdue ? 'overdue' : ''}">${dueLabel}</span>` : ''}
              ${doneDate}
            </div>
            ${scheduleBadges}
          </div>
        </div>
        <div class="todo-actions">
          <button class="todo-edit-btn" data-id="${t.id}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></button>
          <button class="todo-del" data-id="${t.id}">×</button>
        </div>
      </div>`;
  }).join('') || '<div class="empty-msg">タスクがありません</div>';

  renderNotionList();

  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const newStatus = sel.value;
      const updates   = { status: newStatus };
      if (newStatus === 'done') updates.done_at = todayStr();
      if (newStatus !== 'done') updates.done_at = null;
      await db.from('todos').update(updates).eq('id', sel.dataset.id);
      loadTodos();
    });
  });

  list.querySelectorAll('.todo-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const todo = sorted.find(t => String(t.id) === btn.dataset.id);
      if (todo) openTlEditModal(todo);
    });
  });

  list.querySelectorAll('.todo-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('削除しますか？\nGoogleカレンダーのイベントも削除されます。')) return;
      const id = btn.dataset.id;

      // GCalイベントを先に取得して削除
      const { data: todoData } = await db.from('todos')
        .select('gcal_due_event_id, task_schedules(gcal_event_id)')
        .eq('id', id).single();
      if (todoData) {
        await gcalDelete(todoData.gcal_due_event_id);
        for (const s of (todoData.task_schedules || [])) {
          await gcalDelete(s.gcal_event_id);
        }
      }

      await db.from('todos').delete().eq('id', id);
      loadTodos();
      renderTimeline();
    });
  });
}

// ============================================================
// 神大の課題（Notion から読み取り専用で表示）
// ============================================================
let notionItems = null;   // null = 未取得 / 'error' = 取得失敗
const NOTION_STATUS_LABEL = { will: 'Will', doing: 'Doing', done: 'Done' };

function escapeHtmlT(str) {
  return String(str).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Live Server（127.0.0.1 / localhost）には Netlify Functions がないので、本番の Function を呼ぶ
const FUNCTIONS_BASE = ['127.0.0.1', 'localhost'].includes(location.hostname)
  ? 'https://irr-home.netlify.app'
  : '';

async function loadNotionAssignments() {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/notion-assignments`);
    if (!res.ok) throw new Error(await res.text());
    notionItems = await res.json();
  } catch (err) {
    console.error('Notion 課題の取得に失敗:', err);
    notionItems = 'error';
  }
  renderNotionList();
  renderTimeline();   // タイムラインに締切を出すため
}

// 締切: 'YYYY-MM-DD'（終日）または ISO日時 → 表示用の文字列と期限切れ判定
function notionDueInfo(due) {
  if (!due) return { label: '', overdue: false };
  if (!due.includes('T')) {
    return { label: `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg> ${formatDate(due)}`, overdue: due < todayStr() };
  }
  const d    = new Date(due);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { label: `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg> ${formatDate(localDateStr(d))} ${time}`, overdue: d < new Date() };
}

function renderNotionList() {
  const box = document.getElementById('notion-list');
  if (currentCat !== 'all' && currentCat !== '神大') { box.innerHTML = ''; return; }

  if (notionItems === null) {
    box.innerHTML = '<div class="notion-head"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg> 神大（Notion）<span class="notion-sub">読み込み中…</span></div>';
    return;
  }
  if (notionItems === 'error') {
    box.innerHTML = '<div class="notion-head"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg> 神大（Notion）<span class="notion-sub">取得できませんでした</span></div>';
    return;
  }

  const order = { will: 0, doing: 1, done: 2 };
  const items = notionItems
    .filter(n => currentStatus === 'all' || n.status === currentStatus)
    .sort((a, b) => order[a.status] - order[b.status]);

  const rows = items.map(n => {
    const { label, overdue } = notionDueInfo(n.due);
    const subject = n.subjects.length ? `<span class="cat-badge cat-神大">${escapeHtmlT(n.subjects.join('・'))}</span>` : '';
    const kind    = n.kind ? `<span class="notion-kind">${escapeHtmlT(n.kind)}</span>` : '';
    return `
      <div class="todo-item notion-item status-${n.status}">
        <div class="todo-main">
          <span class="notion-status notion-status-${n.status}">${NOTION_STATUS_LABEL[n.status]}</span>
          <div class="todo-info">
            <div class="todo-text ${n.status === 'done' ? 'done' : ''}">${escapeHtmlT(n.title)}</div>
            <div class="todo-meta">
              ${subject}
              ${kind}
              ${label ? `<span class="todo-due ${overdue && n.status !== 'done' ? 'overdue' : ''}">${label}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="todo-actions">
          <button class="todo-edit-btn notion-edit-btn" data-id="${n.id}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></button>
          <a class="notion-open" href="${escapeHtmlT(n.url)}" target="_blank" rel="noopener" title="Notion で開く">↗</a>
        </div>
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="notion-head"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg> 神大（Notion）<span class="notion-sub">${items.length}件 ・ <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>で編集 ／ ↗で Notion を開く</span></div>
    ${rows || '<div class="empty-msg">該当する課題はありません</div>'}`;

  box.querySelectorAll('.notion-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = notionItems.find(n => n.id === btn.dataset.id);
      if (item) openNotionEdit(item);
    });
  });
}

// ---- Notion の課題を編集（notion-assignment-update に送る） ----
let notionEditing = null;

function openNotionEdit(n) {
  notionEditing = n;
  let date = '', time = '';
  if (n.due) {
    if (n.due.includes('T')) {
      const d = new Date(n.due);
      date = localDateStr(d);
      time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      date = n.due;
    }
  }
  document.getElementById('ne-title').value    = n.title;
  document.getElementById('ne-status').value   = n.statusName;
  document.getElementById('ne-kind').value     = n.kind || '';
  document.getElementById('ne-due-date').value = date;
  document.getElementById('ne-prep').value     = n.prep || '';
  document.getElementById('ne-due-time').value = time;
  document.getElementById('ne-method').value   = n.method || '';
  document.getElementById('ne-points').value   = n.points || '';
  document.getElementById('ne-memo').value     = n.memo || '';
  document.getElementById('ne-error').hidden   = true;
  document.getElementById('notion-edit-overlay').classList.add('active');
}

function closeNotionEdit() {
  document.getElementById('notion-edit-overlay').classList.remove('active');
  notionEditing = null;
}

// 'YYYY-MM-DD' + 'HH:mm' → この端末のタイムゾーンつきの日時（例: 2026-10-26T10:30:00+09:00）
function withTzOffset(date, time) {
  const off = -new Date(`${date}T${time}:00`).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

document.getElementById('ne-cancel').addEventListener('click', closeNotionEdit);
document.getElementById('notion-edit-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeNotionEdit();
});

document.getElementById('notion-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!notionEditing) return;
  const title = document.getElementById('ne-title').value.trim();
  if (!title) return;
  const date = document.getElementById('ne-due-date').value;
  const time = document.getElementById('ne-due-time').value;
  const prep = document.getElementById('ne-prep').value;
  const submitBtn = document.getElementById('ne-submit');
  const errEl     = document.getElementById('ne-error');
  if (prep && date && prep > date) {
    errEl.textContent = '準備開始は締切より前の日にしてください';
    errEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '保存中…';
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/notion-assignment-update`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id:     notionEditing.id,
        title,
        status: document.getElementById('ne-status').value,
        kind:   document.getElementById('ne-kind').value,
        due:    date ? (time ? withTzOffset(date, time) : date) : null,
        prep:   prep || null,
        method: document.getElementById('ne-method').value.trim(),
        points: document.getElementById('ne-points').value.trim(),
        memo:   document.getElementById('ne-memo').value.trim(),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    closeNotionEdit();
    await loadNotionAssignments();
  } catch (err) {
    console.error('Notion 課題の保存に失敗:', err);
    errEl.textContent = `保存できませんでした: ${String(err.message).slice(0, 120)}`;
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '保存';
  }
});

document.getElementById('todo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // 入力中の日付が残っていたら自動追加
  const schedVal = document.getElementById('todo-schedule-input').value;
  if (schedVal && !pendingSchedules.includes(schedVal)) {
    pendingSchedules.push(schedVal);
    document.getElementById('todo-schedule-input').value = '';
  }
  const isAllDay = document.getElementById('todo-allday').checked;
  const status   = document.getElementById('todo-status').value;

  const payload = {
    text:       document.getElementById('todo-text').value.trim(),
    category:   document.getElementById('todo-category').value || null,
    status,
    start_date: document.getElementById('todo-start').value || null,
    due_date:   document.getElementById('todo-due').value   || null,
    due_time:   (!isAllDay && document.getElementById('todo-time').value) || null,
    is_all_day: isAllDay,
    done_at:    status === 'done' ? todayStr() : null,
    goal_id:    document.getElementById('todo-goal').value || null,
  };
  if (!payload.text) return;

  const { data: newTodo } = await db.from('todos').insert([payload]).select().single();

  if (newTodo) {
    // 締切日 → Googleカレンダーに赤いイベントを追加
    if (payload.due_date) {
      const eventId = await gcalCreate(`【締切】${payload.text}`, payload.due_date, 11);
      if (eventId) await db.from('todos').update({ gcal_due_event_id: eventId }).eq('id', newTodo.id);
    }

    // 実行予定日 → Googleカレンダーに青いイベントを追加
    for (const date of pendingSchedules) {
      const eventId = await gcalCreate(`【予定】${payload.text}`, date, 9);
      const { data: insData, error: insErr } = await db.from('task_schedules').insert([{
        todo_id:       newTodo.id,
        schedule_date: date,
        gcal_event_id: eventId,
      }]).select();
      if (insErr) console.error('task_schedules insert error:', insErr);
    }
  }

  pendingSchedules = [];
  renderScheduleChips();
  e.target.reset();
  document.getElementById('todo-time').disabled = true;
  loadTodos();
});

// ============================================================
// Timeline
// ============================================================
let tlMonth    = new Date();
let tlDays     = 0;
let dragState  = null;
let createDrag = null;
let dotDragState = null;  // { sched, task, dotEl, currentDate }
let barDragState = null;  // { group, groupSchedules, task, barEl, handle, currentStartIdx, currentEndIdx }

// 連続する日付をグループ化するヘルパー
function groupConsecutiveDates(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const groups = [];
  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00');
    prev.setDate(prev.getDate() + 1);
    const nextStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    if (sorted[i] === nextStr) {
      group.push(sorted[i]);
    } else {
      groups.push(group);
      group = [sorted[i]];
    }
  }
  groups.push(group);
  return groups;
}

document.getElementById('tl-prev').addEventListener('click', () => {
  tlMonth = new Date(tlMonth.getFullYear(), tlMonth.getMonth() - 1, 1);
  renderTimeline();
});
document.getElementById('tl-next').addEventListener('click', () => {
  tlMonth = new Date(tlMonth.getFullYear(), tlMonth.getMonth() + 1, 1);
  renderTimeline();
});

async function renderTimeline() {
  const year     = tlMonth.getFullYear();
  const month    = tlMonth.getMonth();
  const days     = new Date(year, month + 1, 0).getDate();
  // toISOString()はUTC変換でズレるため文字列で直接構築
  const firstStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastStr  = `${year}-${String(month + 1).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
  const today    = todayStr();

  document.getElementById('tl-month-label').textContent = `${year}年${month + 1}月`;

  const { data: todosRaw } = await db.from('todos')
    .select('*')
    .not('due_date', 'is', null)
    .order('created_at');

  const tasks = (todosRaw || []).filter(t =>
    t.due_date >= firstStr && t.due_date <= lastStr
  );

  // task_schedulesを別クエリで取得（embedded selectはFK制約が必要なため分離）
  const taskIds = tasks.map(t => t.id);
  const schedulesMap = {};
  if (taskIds.length > 0) {
    const { data: allScheds, error: schedsErr } = await db.from('task_schedules')
      .select('*')
      .in('todo_id', taskIds);
    if (schedsErr) console.error('task_schedules select error:', schedsErr);
    (allScheds || []).forEach(s => {
      if (!schedulesMap[s.todo_id]) schedulesMap[s.todo_id] = [];
      schedulesMap[s.todo_id].push(s);
    });
  }
  const totalW = days * CELL_W;
  const WEEK   = ['日', '月', '火', '水', '木', '金', '土'];
  tlDays = days;

  // Notion の課題のうち、準備開始〜締切がこの月にかかるもの（締切の日に目印、準備開始からはバー）
  const notionDues = (Array.isArray(notionItems) ? notionItems : [])
    .filter(n => n.due)
    .map(n => {
      const date = n.due.includes('T') ? localDateStr(new Date(n.due)) : n.due;
      return { n, date, start: n.prep && n.prep < date ? n.prep : date };
    })
    .filter(x => x.start <= lastStr && x.date >= firstStr)
    .sort((a, b) => a.n.due.localeCompare(b.n.due));

  // ---- ラベル列（タスク名） ----
  const labelsEl = document.getElementById('tl-labels');
  labelsEl.innerHTML =
    `<div class="tl-label-header"></div>` +
    notionDues.map(({ n }) =>
      `<div class="tl-label-row tl-label-notion ${n.status === 'done' ? 'done' : ''}" data-notion="${n.id}" title="${escapeHtmlT(n.title)}"><span class="tl-label-name"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg> ${escapeHtmlT(n.title)}</span></div>`
    ).join('') +
    tasks.map(t =>
      `<div class="tl-label-row" title="${t.text}"><span class="tl-label-name">${t.text}</span></div>`
    ).join('') +
    `<div class="tl-label-row tl-add-label">＋ 新規追加</div>`;

  labelsEl.querySelector('.tl-add-label')?.addEventListener('click', () => {
    openTlModal(todayStr(), todayStr());
  });
  labelsEl.querySelectorAll('.tl-label-notion').forEach(el => {
    el.addEventListener('click', () => {
      const item = notionItems.find(n => n.id === el.dataset.notion);
      if (item) openNotionEdit(item);
    });
  });

  // ---- ヘッダー（日付） ----
  const headerEl = document.getElementById('tl-dates-header');
  headerEl.style.width = totalW + 'px';
  headerEl.innerHTML = Array.from({ length: days }, (_, i) => {
    const d    = new Date(year, month, i + 1);
    const dow  = d.getDay();
    const isWE = dow === 0 || dow === 6;
    return `<div class="tl-day-header ${isWE ? 'weekend' : ''}" style="left:${i * CELL_W}px;width:${CELL_W}px">
      <div class="tl-day-num">${i + 1}</div>
      <div class="tl-day-name">${WEEK[dow]}</div>
    </div>`;
  }).join('');

  // ---- 行を生成する共通関数 ----
  function buildRow(task, taskSchedules = []) {
    const row = document.createElement('div');
    row.className  = 'tl-row';
    row.style.width = totalW + 'px';

    // 背景セル
    Array.from({ length: days }, (_, i) => {
      const d       = new Date(year, month, i + 1);
      const dStr    = `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      const isWE    = d.getDay() === 0 || d.getDay() === 6;
      const isToday = dStr === today;
      const cell    = document.createElement('div');
      cell.className = `tl-cell ${isWE ? 'weekend' : ''} ${isToday ? 'today' : ''}`;
      cell.style.cssText = `left:${i * CELL_W}px;width:${CELL_W}px`;
      cell.addEventListener('mousedown', (ev) => {
        if (dragState) return;
        ev.preventDefault();
        const preview = document.createElement('div');
        preview.className = 'tl-create-preview';
        preview.style.cssText = `left:${i * CELL_W + 2}px;width:${CELL_W - 4}px;top:5px;height:26px;`;
        row.appendChild(preview);
        createDrag = { startDate: dStr, currentDate: dStr, previewEl: preview };
      });
      row.appendChild(cell);
    });

    // 今日ライン
    if (today >= firstStr && today <= lastStr) {
      const todayDay = parseInt(today.split('-')[2]);
      const marker   = document.createElement('div');
      marker.className = 'tl-today-line';
      marker.style.left = `${(todayDay - 0.5) * CELL_W}px`;
      row.appendChild(marker);
    }

    // タスクバー
    if (task && task.due_date) {
      const startStr     = task.start_date || task.due_date;
      const clampedStart = startStr      < firstStr ? firstStr : startStr;
      const clampedEnd   = task.due_date > lastStr  ? lastStr  : task.due_date;

      if (clampedStart <= lastStr && clampedEnd >= firstStr) {
        const s        = parseInt(clampedStart.split('-')[2]) - 1;
        const e        = parseInt(clampedEnd.split('-')[2])   - 1;
        const barLeft  = s * CELL_W + 2;
        const barWidth = (e - s + 1) * CELL_W - 4;
        const color    = CAT_COLORS[task.category] || '#95A5A6';

        const bar = document.createElement('div');
        bar.className = 'tl-task-bar';
        bar.style.cssText = `left:${barLeft}px;width:${barWidth}px;background:${color};opacity:${task.status === 'done' ? 0.45 : 1}`;
        bar.title = `${task.text}（${task.status}）`;

        const textSpan = document.createElement('span');
        textSpan.className   = 'tl-bar-text';
        textSpan.textContent = task.text;
        bar.appendChild(textSpan);

        // 左ハンドル（start_date変更）
        const lh = document.createElement('div');
        lh.className = 'tl-bar-handle left';
        lh.addEventListener('mousedown', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          dragState = { task, handle: 'left', barEl: bar, startX: ev.clientX,
            origDate: task.start_date || task.due_date, origLeft: barLeft, origWidth: barWidth };
        });
        bar.appendChild(lh);

        // 右ハンドル（due_date変更）
        const rh = document.createElement('div');
        rh.className = 'tl-bar-handle right';
        rh.addEventListener('mousedown', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          dragState = { task, handle: 'right', barEl: bar, startX: ev.clientX,
            origDate: task.due_date, origLeft: barLeft, origWidth: barWidth };
        });
        bar.appendChild(rh);

        bar.addEventListener('click', (ev) => { ev.stopPropagation(); openTlEditModal(task); });
        row.appendChild(bar);
      }
    }

    // 実行予定日ドット / 連続バー
    const validScheds = taskSchedules.filter(s => s.schedule_date >= firstStr && s.schedule_date <= lastStr);
    const groups      = groupConsecutiveDates(validScheds.map(s => s.schedule_date));

    for (const group of groups) {
      if (group.length === 1) {
        // 単一日 → 丸ドット（ドラッグで日付変更可）
        const sd     = group[0];
        const sched  = validScheds.find(s => s.schedule_date === sd);
        const dayIdx = parseInt(sd.split('-')[2]) - 1;
        const dot    = document.createElement('div');
        dot.className = 'tl-schedule-dot';
        dot.style.left = `${dayIdx * CELL_W + Math.floor(CELL_W / 2) - 6}px`;
        dot.title = formatDate(sd);
        dot.addEventListener('mousedown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          dotDragState = { sched, task, dotEl: dot, currentDate: sd };
        });
        row.appendChild(dot);
      } else {
        // 連続日 → 棒バー（左右ハンドルでリサイズ可）
        const firstSd  = group[0];
        const lastSd   = group[group.length - 1];
        const startIdx = parseInt(firstSd.split('-')[2]) - 1;
        const endIdx   = parseInt(lastSd.split('-')[2]) - 1;
        const left     = startIdx * CELL_W + Math.floor(CELL_W / 2) - 6;
        const right    = endIdx   * CELL_W + Math.floor(CELL_W / 2) + 6;
        const bar      = document.createElement('div');
        bar.className = 'tl-sched-bar';
        bar.style.left  = `${left}px`;
        bar.style.width = `${right - left}px`;
        bar.title = `${formatDate(firstSd)} 〜 ${formatDate(lastSd)}`;

        const groupSchedules = validScheds.filter(s => group.includes(s.schedule_date));

        const lh = document.createElement('div');
        lh.className = 'tl-bar-handle left';
        lh.addEventListener('mousedown', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          barDragState = { group: [...group], groupSchedules, task, barEl: bar, handle: 'left',
            currentStartIdx: startIdx, currentEndIdx: endIdx };
        });
        bar.appendChild(lh);

        const rh = document.createElement('div');
        rh.className = 'tl-bar-handle right';
        rh.addEventListener('mousedown', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          barDragState = { group: [...group], groupSchedules, task, barEl: bar, handle: 'right',
            currentStartIdx: startIdx, currentEndIdx: endIdx };
        });
        bar.appendChild(rh);

        row.appendChild(bar);
      }
    }

    return row;
  }

  // ---- 描画 ----
  const rowsEl = document.getElementById('tl-task-rows');
  rowsEl.innerHTML = '';

  // Notion の課題の行: 準備開始〜締切のバー ＋ 締切の日のマスに目印（時刻つきなら時刻、終日なら「締」）
  // バーの左端（準備開始がなければ目印の左端）をドラッグすると準備開始を変えられる
  const dayIdxOf = ds => parseInt(ds.split('-')[2]) - 1;
  notionDues.forEach(({ n, date, start }) => {
    const row     = buildRow(null, []);
    const dueIn   = date <= lastStr;
    const endIdx  = dueIn ? dayIdxOf(date) : days - 1;
    const startIdx = start < firstStr ? 0 : dayIdxOf(start);
    const { label } = notionDueInfo(n.due);

    const range = document.createElement('div');
    range.className = `tl-notion-prep ${n.status === 'done' ? 'done' : ''} ${start === date ? 'empty' : ''}`;
    range.style.left  = `${startIdx * CELL_W + 2}px`;
    range.style.width = `${(endIdx - startIdx + 1) * CELL_W - 4}px`;
    range.title = n.prep ? `準備 ${formatDate(n.prep)} 〜 締切 ${formatDate(date)}` : '左端をドラッグして準備開始を決める';
    range.addEventListener('mousedown', ev => ev.stopPropagation());
    range.addEventListener('click', ev => { ev.stopPropagation(); openNotionEdit(n); });
    // 左ハンドル（締切が今月にあるときだけ。準備開始がほかの月なら動かさない）
    if (dueIn && start >= firstStr) {
      const lh = document.createElement('div');
      lh.className = 'tl-bar-handle left';
      lh.addEventListener('mousedown', ev => {
        ev.stopPropagation(); ev.preventDefault();
        notionPrepDrag = { n, row, range, endIdx, idx: startIdx, ym: firstStr.slice(0, 8) };
      });
      range.appendChild(lh);
    }
    row.appendChild(range);

    if (dueIn) {
      const mark = document.createElement('div');
      mark.className = `tl-notion-due ${n.status === 'done' ? 'done' : ''}`;
      mark.style.left  = `${endIdx * CELL_W + 2}px`;
      mark.style.width = `${CELL_W - 4}px`;
      mark.textContent = n.due.includes('T') ? label.split(' ').pop() : '締';
      mark.title = `${n.title}（${label.replace(/<svg[\s\S]*?<\/svg>\s*/, '')}・${n.statusName}）`;
      mark.addEventListener('mousedown', ev => ev.stopPropagation());  // 空きマスのドラッグ作成を起こさない
      mark.addEventListener('click', ev => { ev.stopPropagation(); openNotionEdit(n); });
      row.appendChild(mark);
    }
    rowsEl.appendChild(row);
  });

  tasks.forEach(task => rowsEl.appendChild(buildRow(task, schedulesMap[task.id] || [])));

  // 常に空行を最下段に追加
  const emptyRow = buildRow(null, []);
  emptyRow.classList.add('tl-empty-row');
  rowsEl.appendChild(emptyRow);

  if (today >= firstStr && today <= lastStr) {
    const todayDay = parseInt(today.split('-')[2]);
    document.getElementById('tl-scroll').scrollLeft = Math.max(0, (todayDay - 4) * CELL_W);
  }
}

// ---- Notion の課題: 準備開始のドラッグ ----
let notionPrepDrag = null;  // { n, row, range, endIdx, idx, ym: 'YYYY-MM-' }

document.addEventListener('mousemove', (e) => {
  if (!notionPrepDrag) return;
  const d   = notionPrepDrag;
  const x   = e.clientX - d.row.getBoundingClientRect().left;
  d.idx     = Math.max(0, Math.min(d.endIdx, Math.floor(x / CELL_W)));
  d.range.style.left  = `${d.idx * CELL_W + 2}px`;
  d.range.style.width = `${(d.endIdx - d.idx + 1) * CELL_W - 4}px`;
  d.range.classList.toggle('empty', d.idx === d.endIdx);
});

document.addEventListener('mouseup', async () => {
  if (!notionPrepDrag) return;
  const { n, endIdx, idx, ym } = notionPrepDrag;
  notionPrepDrag = null;
  const prep = idx === endIdx ? null : `${ym}${String(idx + 1).padStart(2, '0')}`;  // 締切の日まで戻したら準備開始なし
  if (prep === (n.prep || null)) return;
  n.prep = prep;  // 先に画面へ反映
  renderTimeline();
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/notion-assignment-update`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: n.id, prep }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    console.error('準備開始の保存に失敗:', err);
    alert('準備開始を Notion に保存できませんでした');
    loadNotionAssignments();
  }
});

// ---- ドラッグリサイズ＋新規作成ドラッグ ----
document.addEventListener('mousemove', (e) => {
  if (barDragState) {
    const scrollEl = document.getElementById('tl-scroll');
    if (!scrollEl) return;
    const rect   = scrollEl.getBoundingClientRect();
    const x      = e.clientX - rect.left + scrollEl.scrollLeft;
    const dayIdx = Math.max(0, Math.min(tlDays - 1, Math.floor(x / CELL_W)));
    if (barDragState.handle === 'left') {
      barDragState.currentStartIdx = Math.min(dayIdx, barDragState.currentEndIdx);
    } else {
      barDragState.currentEndIdx = Math.max(dayIdx, barDragState.currentStartIdx);
    }
    const newLeft  = barDragState.currentStartIdx * CELL_W + Math.floor(CELL_W / 2) - 6;
    const newRight = barDragState.currentEndIdx   * CELL_W + Math.floor(CELL_W / 2) + 6;
    barDragState.barEl.style.left  = `${newLeft}px`;
    barDragState.barEl.style.width = `${newRight - newLeft}px`;
    document.body.style.userSelect = 'none';
    return;
  }
  if (dotDragState) {
    const scrollEl = document.getElementById('tl-scroll');
    if (!scrollEl) return;
    const rect    = scrollEl.getBoundingClientRect();
    const x       = e.clientX - rect.left + scrollEl.scrollLeft;
    const dayIdx  = Math.max(0, Math.min(tlDays - 1, Math.floor(x / CELL_W)));
    const newDate = `${tlMonth.getFullYear()}-${String(tlMonth.getMonth() + 1).padStart(2, '0')}-${String(dayIdx + 1).padStart(2, '0')}`;
    dotDragState.currentDate = newDate;
    dotDragState.dotEl.style.left = `${dayIdx * CELL_W + Math.floor(CELL_W / 2) - 6}px`;
    document.body.style.userSelect = 'none';
    return;
  }
  if (createDrag) {
    const scrollEl = document.getElementById('tl-scroll');
    if (!scrollEl) return;
    const rect   = scrollEl.getBoundingClientRect();
    const x      = e.clientX - rect.left + scrollEl.scrollLeft;
    const dayIdx = Math.max(0, Math.min(tlDays - 1, Math.floor(x / CELL_W)));
    const d      = new Date(tlMonth.getFullYear(), tlMonth.getMonth(), dayIdx + 1);
    const newDate = localDateStr(d);
    createDrag.currentDate = newDate;
    // プレビューバーの位置・幅を更新
    const { startDate, previewEl } = createDrag;
    const s  = startDate <= newDate ? startDate : newDate;
    const en = startDate <= newDate ? newDate   : startDate;
    const si = parseInt(s.split('-')[2])  - 1;
    const ei = parseInt(en.split('-')[2]) - 1;
    previewEl.style.left  = `${si * CELL_W + 2}px`;
    previewEl.style.width = `${(ei - si + 1) * CELL_W - 4}px`;
    document.body.style.userSelect = 'none';
    return;
  }
  if (!dragState) return;
  document.body.style.cursor     = 'ew-resize';
  document.body.style.userSelect = 'none';
  const deltaDays = Math.round((e.clientX - dragState.startX) / CELL_W);
  if (dragState.handle === 'right') {
    const newWidth = dragState.origWidth + deltaDays * CELL_W;
    if (newWidth >= CELL_W) dragState.barEl.style.width = newWidth + 'px';
  } else {
    const newLeft  = dragState.origLeft  + deltaDays * CELL_W;
    const newWidth = dragState.origWidth - deltaDays * CELL_W;
    if (newWidth >= CELL_W) {
      dragState.barEl.style.left  = newLeft  + 'px';
      dragState.barEl.style.width = newWidth + 'px';
    }
  }
});

document.addEventListener('mouseup', async (e) => {
  if (barDragState) {
    document.body.style.userSelect = '';
    const { group, groupSchedules, task, currentStartIdx, currentEndIdx } = barDragState;
    barDragState = null;

    const year  = tlMonth.getFullYear();
    const month = tlMonth.getMonth();

    const oldDates = new Set(group);
    const newDates = new Set();
    for (let i = currentStartIdx; i <= currentEndIdx; i++) {
      newDates.add(`${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
    }

    const toDelete = [...oldDates].filter(d => !newDates.has(d));
    const toAdd    = [...newDates].filter(d => !oldDates.has(d));
    if (toDelete.length === 0 && toAdd.length === 0) return;

    for (const date of toDelete) {
      const sched = groupSchedules.find(s => s.schedule_date === date);
      if (sched) {
        await gcalDelete(sched.gcal_event_id);
        await db.from('task_schedules').delete().eq('id', sched.id);
      }
    }
    for (const date of toAdd) {
      const eventId = gcalToken ? await gcalCreate(`【予定】${task.text}`, date, 9) : null;
      await db.from('task_schedules').insert([{ todo_id: task.id, schedule_date: date, gcal_event_id: eventId }]);
    }

    renderTimeline();
    loadTodos();
    return;
  }
  if (dotDragState) {
    document.body.style.userSelect = '';
    const { sched, task, currentDate } = dotDragState;
    dotDragState = null;
    if (currentDate && currentDate !== sched.schedule_date) {
      if (sched.gcal_event_id) await gcalDelete(sched.gcal_event_id);
      const newEventId = gcalToken ? await gcalCreate(`【予定】${task.text}`, currentDate, 9) : null;
      await db.from('task_schedules').update({
        schedule_date: currentDate,
        gcal_event_id: newEventId || null,
      }).eq('id', sched.id);
      renderTimeline();
      loadTodos();
    }
    return;
  }
  if (createDrag) {
    document.body.style.userSelect = '';
    const { startDate, currentDate, previewEl } = createDrag;
    previewEl.remove();
    createDrag = null;
    const s  = startDate <= currentDate ? startDate : currentDate;
    const en = startDate <= currentDate ? currentDate : startDate;
    openTlModal(s, en);
    return;
  }
  if (!dragState) return;
  document.body.style.cursor = document.body.style.userSelect = '';
  const deltaDays = Math.round((e.clientX - dragState.startX) / CELL_W);
  if (deltaDays !== 0) {
    const base = new Date(dragState.origDate + 'T00:00:00');
    base.setDate(base.getDate() + deltaDays);
    const newDateStr = localDateStr(base);
    if (dragState.handle === 'right') {
      const startStr = dragState.task.start_date || dragState.task.due_date;
      if (newDateStr >= startStr) {
        await db.from('todos').update({ due_date: newDateStr }).eq('id', dragState.task.id);
        // GCalの締切イベントも更新
        if (dragState.task.gcal_due_event_id) {
          await gcalDelete(dragState.task.gcal_due_event_id);
          const newId = await gcalCreate(`【締切】${dragState.task.text}`, newDateStr, 11);
          if (newId) await db.from('todos').update({ gcal_due_event_id: newId }).eq('id', dragState.task.id);
        }
      }
    } else {
      if (newDateStr <= dragState.task.due_date) {
        await db.from('todos').update({ start_date: newDateStr }).eq('id', dragState.task.id);
      }
    }
    renderTimeline();
  }
  dragState = null;
});

// ---- タイムライン編集モーダル ----
let tlEditTodo      = null;
let tlEditSchedules = [];  // { id, schedule_date, gcal_event_id, _new, _deleted }

function renderTlEditScheduleChips() {
  const el = document.getElementById('tl-edit-schedule-chips');
  if (!el) return;
  el.innerHTML = tlEditSchedules.filter(s => !s._deleted).map(s =>
    `<span class="s-chip">${formatDate(s.schedule_date)}<button type="button" class="s-chip-del" data-date="${s.schedule_date}">×</button></span>`
  ).join('');
  el.querySelectorAll('.s-chip-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = tlEditSchedules.find(s => s.schedule_date === btn.dataset.date && !s._deleted);
      if (target) target._deleted = true;
      renderTlEditScheduleChips();
    });
  });
}

document.getElementById('tl-edit-allday').addEventListener('change', (e) => {
  const timeInput = document.getElementById('tl-edit-time');
  timeInput.disabled = e.target.checked;
  if (e.target.checked) timeInput.value = '';
});

document.getElementById('tl-edit-schedule-add').addEventListener('click', () => {
  const val = document.getElementById('tl-edit-schedule-input').value;
  if (!val || tlEditSchedules.some(s => s.schedule_date === val && !s._deleted)) return;
  tlEditSchedules.push({ id: null, schedule_date: val, gcal_event_id: null, _new: true });
  tlEditSchedules.sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
  document.getElementById('tl-edit-schedule-input').value = '';
  renderTlEditScheduleChips();
});

async function openTlEditModal(task) {
  tlEditTodo = task;
  const isAllDay = task.is_all_day !== false;
  document.getElementById('tl-edit-text').value     = task.text;
  document.getElementById('tl-edit-category').value = task.category   || '';
  document.getElementById('tl-edit-status').value   = task.status     || 'will';
  document.getElementById('tl-edit-start').value    = task.start_date || '';
  document.getElementById('tl-edit-end').value      = task.due_date   || '';
  document.getElementById('tl-edit-allday').checked = isAllDay;
  document.getElementById('tl-edit-time').value     = task.due_time   || '';
  document.getElementById('tl-edit-time').disabled  = isAllDay;
  document.getElementById('tl-edit-goal').value     = task.goal_id    || '';

  const { data: scheds } = await db.from('task_schedules').select('*').eq('todo_id', task.id);
  tlEditSchedules = (scheds || []).map(s => ({ ...s, _new: false, _deleted: false }));
  renderTlEditScheduleChips();

  document.getElementById('tl-edit-overlay').classList.add('active');
}

function closeTlEditModal() {
  document.getElementById('tl-edit-overlay').classList.remove('active');
  tlEditTodo = null;
  tlEditSchedules = [];
}

document.getElementById('tl-edit-cancel').addEventListener('click', closeTlEditModal);
document.getElementById('tl-edit-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeTlEditModal();
});

document.getElementById('tl-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // 入力中の日付が残っていたら自動追加
  const schedVal = document.getElementById('tl-edit-schedule-input').value;
  if (schedVal && !tlEditSchedules.some(s => s.schedule_date === schedVal && !s._deleted)) {
    tlEditSchedules.push({ id: null, schedule_date: schedVal, gcal_event_id: null, _new: true });
    document.getElementById('tl-edit-schedule-input').value = '';
  }
  if (!tlEditTodo) return;
  const id       = tlEditTodo.id;
  const text     = document.getElementById('tl-edit-text').value.trim();
  const isAllDay = document.getElementById('tl-edit-allday').checked;
  const status   = document.getElementById('tl-edit-status').value;
  const due_date = document.getElementById('tl-edit-end').value   || null;
  if (!text) return;

  await db.from('todos').update({
    text,
    category:   document.getElementById('tl-edit-category').value || null,
    status,
    start_date: document.getElementById('tl-edit-start').value    || null,
    due_date,
    due_time:   (!isAllDay && document.getElementById('tl-edit-time').value) || null,
    is_all_day: isAllDay,
    done_at:    status === 'done' ? (tlEditTodo.done_at || todayStr()) : null,
    goal_id:    document.getElementById('tl-edit-goal').value || null,
  }).eq('id', id);

  // 締切日が変わった場合はGCal更新
  if (due_date !== tlEditTodo.due_date) {
    if (tlEditTodo.gcal_due_event_id) await gcalDelete(tlEditTodo.gcal_due_event_id);
    if (due_date && gcalToken) {
      const newId = await gcalCreate(`【締切】${text}`, due_date, 11);
      if (newId) await db.from('todos').update({ gcal_due_event_id: newId }).eq('id', id);
    } else {
      await db.from('todos').update({ gcal_due_event_id: null }).eq('id', id);
    }
  }

  // 実行予定日: 削除
  for (const s of tlEditSchedules.filter(s => s._deleted && !s._new)) {
    await gcalDelete(s.gcal_event_id);
    await db.from('task_schedules').delete().eq('id', s.id);
  }
  // 実行予定日: 追加
  for (const s of tlEditSchedules.filter(s => s._new && !s._deleted)) {
    const eventId = await gcalCreate(`【予定】${text}`, s.schedule_date, 9);
    const { data: insData, error: insErr } = await db.from('task_schedules').insert([{ todo_id: id, schedule_date: s.schedule_date, gcal_event_id: eventId }]).select();
    if (insErr) console.error('task_schedules insert error:', insErr);
  }

  closeTlEditModal();
  renderTimeline();
  loadTodos();
});

// ---- タイムライン追加モーダル ----
let pendingTlSchedules = [];

function renderTlScheduleChips() {
  const el = document.getElementById('tl-schedule-chips');
  if (!el) return;
  el.innerHTML = pendingTlSchedules.map(d =>
    `<span class="s-chip">${formatDate(d)}<button type="button" class="s-chip-del" data-date="${d}">×</button></span>`
  ).join('');
  el.querySelectorAll('.s-chip-del').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingTlSchedules = pendingTlSchedules.filter(d => d !== btn.dataset.date);
      renderTlScheduleChips();
    });
  });
}

document.getElementById('tl-allday').addEventListener('change', (e) => {
  const timeInput = document.getElementById('tl-time');
  timeInput.disabled = e.target.checked;
  if (e.target.checked) timeInput.value = '';
});

document.getElementById('tl-schedule-add').addEventListener('click', () => {
  const val = document.getElementById('tl-schedule-input').value;
  if (!val || pendingTlSchedules.includes(val)) return;
  pendingTlSchedules.push(val);
  pendingTlSchedules.sort();
  document.getElementById('tl-schedule-input').value = '';
  renderTlScheduleChips();
});

function openTlModal(startDate, endDate = startDate) {
  document.getElementById('tl-start').value    = startDate;
  document.getElementById('tl-end').value      = endDate;
  document.getElementById('tl-category').value = '';
  document.getElementById('tl-text').value     = '';
  document.getElementById('tl-status').value   = 'will';
  document.getElementById('tl-allday').checked = true;
  document.getElementById('tl-time').value     = '';
  document.getElementById('tl-time').disabled  = true;
  pendingTlSchedules = [];
  renderTlScheduleChips();
  document.getElementById('tl-overlay').classList.add('active');
  document.getElementById('tl-text').focus();
}

function closeTlModal() {
  document.getElementById('tl-overlay').classList.remove('active');
}

document.getElementById('tl-cancel').addEventListener('click', closeTlModal);
document.getElementById('tl-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeTlModal();
});

document.getElementById('tl-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // 入力中の日付が残っていたら自動追加
  const schedVal = document.getElementById('tl-schedule-input').value;
  if (schedVal && !pendingTlSchedules.includes(schedVal)) {
    pendingTlSchedules.push(schedVal);
    document.getElementById('tl-schedule-input').value = '';
  }
  const text    = document.getElementById('tl-text').value.trim();
  if (!text) return;
  const isAllDay = document.getElementById('tl-allday').checked;
  const status   = document.getElementById('tl-status').value;
  const dueDate  = document.getElementById('tl-end').value || null;

  const payload = {
    text,
    category:   document.getElementById('tl-category').value || null,
    status,
    start_date: document.getElementById('tl-start').value || null,
    due_date:   dueDate,
    due_time:   (!isAllDay && document.getElementById('tl-time').value) || null,
    is_all_day: isAllDay,
    done_at:    status === 'done' ? todayStr() : null,
  };

  const { data: newTodo } = await db.from('todos').insert([payload]).select().single();

  if (newTodo) {
    if (dueDate) {
      const eventId = await gcalCreate(`【締切】${text}`, dueDate, 11);
      if (eventId) await db.from('todos').update({ gcal_due_event_id: eventId }).eq('id', newTodo.id);
    }
    for (const date of pendingTlSchedules) {
      const eventId = await gcalCreate(`【予定】${text}`, date, 9);
      await db.from('task_schedules').insert([{ todo_id: newTodo.id, schedule_date: date, gcal_event_id: eventId }]);
    }
  }

  pendingTlSchedules = [];
  renderTlScheduleChips();
  closeTlModal();
  renderTimeline();
  loadTodos();
});

// ============================================================
// Routine
// ============================================================
let habitChart = null;

async function initRoutine() {
  const recordDate = getRoutineDate();

  document.getElementById('routine-record-date').textContent = formatDate(recordDate);

  const { data } = await db.from('routine_logs').select('*').eq('date', recordDate).single();

  document.querySelectorAll('.routine-item input[type="checkbox"]').forEach(cb => {
    cb.checked = data ? !!data[cb.dataset.key] : false;
    cb.addEventListener('change', () => saveRoutine(recordDate, cb.dataset.key, cb.checked));
  });

  updateRoutineProgress();
  await loadHabitChart();
}

function updateRoutineProgress() {
  const checks = document.querySelectorAll('.routine-item input[type="checkbox"]');
  const done   = [...checks].filter(cb => cb.checked).length;
  const fill   = document.getElementById('routine-fill');
  const count  = document.getElementById('routine-count');
  if (fill)  fill.style.width  = `${done / ROUTINE_KEYS.length * 100}%`;
  if (count) count.textContent = `${done} / ${ROUTINE_KEYS.length}`;
}

async function saveRoutine(recordDate, changedKey, changedValue) {
  updateRoutineProgress();
  const { data: existing } = await db.from('routine_logs').select('*').eq('date', recordDate).single();
  const payload = { date: recordDate, ...existing };
  document.querySelectorAll('.routine-item input[type="checkbox"]').forEach(cb => {
    payload[cb.dataset.key] = cb.checked;
  });
  if (changedKey) {
    payload[`${changedKey}_at`] = changedValue ? new Date().toISOString() : null;
  }
  await db.from('routine_logs').upsert([payload], { onConflict: 'date' });
}

async function loadHabitChart() {
  const end   = todayStr();
  const start = daysAgoStr(29);
  const { data: logs } = await db.from('routine_logs').select('*').gte('date', start).lte('date', end);
  const logMap = {};
  (logs || []).forEach(l => { logMap[l.date] = l; });

  const labels = [], counts = [], colors = [];
  for (let i = 29; i >= 0; i--) {
    const d   = daysAgoStr(i);
    const log = logMap[d];
    const cnt = log ? ROUTINE_KEYS.reduce((s, k) => s + (log[k] ? 1 : 0), 0) : 0;
    labels.push(d.slice(5));
    counts.push(cnt);
    colors.push(cnt === 3 ? '#34c759' : cnt >= 1 ? '#ff9500' : '#e5e5ea');
  }

  if (habitChart) habitChart.destroy();
  habitChart = new Chart(document.getElementById('habit-chart').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} / 3 完了` } } },
      scales: {
        y: { min: 0, max: 3, ticks: { stepSize: 1 }, grid: { color: '#f5f5f7' } },
        x: { ticks: { maxRotation: 0, callback: (v, i) => i % 5 === 0 ? labels[i] : '' }, grid: { display: false } },
      },
    },
  });
}

// ============================================================
// Plan（中長期の目標・マイルストーン）
// ============================================================
const PLAN_MONTHS = 12;
let planGoals      = [];   // plan_goals（plan_milestones を含む）
let planStart      = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
let editingGoalId  = null;

// 目標の一覧を取得して、ToDo の「目標」セレクトも更新する
async function loadGoals() {
  const { data, error } = await db.from('plan_goals')
    .select('*, plan_milestones(*)')
    .order('start_date');
  if (error) console.error('plan_goals load error:', error);
  planGoals = data || [];

  ['todo-goal', 'tl-edit-goal'].forEach(id => {
    const sel  = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = '<option value="">目標なし</option>' + planGoals.map(g =>
      `<option value="${g.id}">${escapeHtmlT(g.title)}</option>`
    ).join('');
    sel.value = prev;
  });
}

async function loadPlan() {
  await loadGoals();
  const { data: todos } = await db.from('todos')
    .select('id, text, status, due_date, goal_id')
    .not('goal_id', 'is', null);
  renderRoadmap();
  renderGoalCards(todos || []);
}

// 日付 → ロードマップ上の位置（%）
function planPct(dateStr) {
  const start = planStart.getTime();
  const end   = new Date(planStart.getFullYear(), planStart.getMonth() + PLAN_MONTHS, 1).getTime();
  const t     = new Date(dateStr + 'T00:00:00').getTime();
  return (t - start) / (end - start) * 100;
}

function renderRoadmap() {
  const last = new Date(planStart.getFullYear(), planStart.getMonth() + PLAN_MONTHS - 1, 1);
  document.getElementById('plan-range-label').textContent =
    `${planStart.getFullYear()}/${planStart.getMonth() + 1} 〜 ${last.getFullYear()}/${last.getMonth() + 1}`;

  const months = Array.from({ length: PLAN_MONTHS }, (_, i) => {
    const d = new Date(planStart.getFullYear(), planStart.getMonth() + i, 1);
    return `<div class="rm-month">${d.getMonth() === 0 ? `<b>${d.getFullYear() % 100}/</b>` : ''}${d.getMonth() + 1}</div>`;
  }).join('');

  const todayPct = planPct(todayStr());
  const todayLine = (todayPct >= 0 && todayPct <= 100)
    ? `<div class="rm-today" style="left:${todayPct}%"></div>` : '';

  const rows = planGoals.map(g => {
    const left  = Math.max(0, planPct(g.start_date));
    const right = Math.min(100, planPct(g.end_date));
    if (right <= 0 || left >= 100) return '';
    const marks = (g.plan_milestones || [])
      .filter(m => m.due_date)
      .map(m => {
        const p = planPct(m.due_date);
        if (p < 0 || p > 100) return '';
        return `<span class="rm-mile ${m.done ? 'done' : ''}" style="left:${p}%;color:${g.color}" title="${escapeHtmlT(m.title)}（${formatDate(m.due_date)}）">◆</span>`;
      }).join('');
    return `
      <div class="rm-row">
        <div class="rm-label">${escapeHtmlT(g.title)}</div>
        <div class="rm-track">
          <div class="rm-bar" style="left:${left}%;width:${Math.max(right - left, 1)}%;background:${g.color}"></div>
          ${marks}
        </div>
      </div>`;
  }).join('');

  document.getElementById('plan-roadmap').innerHTML = `
    <div class="rm-months">${months}</div>
    <div class="rm-body">
      ${todayLine}
      ${rows || '<div class="empty-msg">この期間の目標はありません</div>'}
    </div>`;
}

function renderGoalCards(todos) {
  const box   = document.getElementById('plan-goals');
  const today = todayStr();
  const statusLabel = { will: 'Will', doing: 'Doing', done: 'Done' };

  box.innerHTML = planGoals.map(g => {
    const miles = (g.plan_milestones || [])
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const linked = todos.filter(t => t.goal_id === g.id);
    const total  = miles.length + linked.length;
    const done   = miles.filter(m => m.done).length + linked.filter(t => t.status === 'done').length;
    const pct    = total ? Math.round(done / total * 100) : 0;
    const daysLeft = Math.ceil((new Date(g.end_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    const leftLabel = daysLeft >= 0 ? `あと${daysLeft}日` : '期間終了';

    const mileRows = miles.map(m => `
      <div class="goal-mile ${m.done ? 'done' : ''}">
        <input type="checkbox" class="mile-check" data-id="${m.id}" ${m.done ? 'checked' : ''}>
        <span class="mile-diamond" style="color:${g.color}">◆</span>
        <span class="mile-title">${escapeHtmlT(m.title)}</span>
        <span class="mile-date ${!m.done && m.due_date && m.due_date < today ? 'overdue' : ''}">${m.due_date ? formatDate(m.due_date) : ''}</span>
        <button class="mile-del" data-id="${m.id}">×</button>
      </div>`).join('');

    const todoRows = linked.map(t => `
      <div class="goal-todo ${t.status === 'done' ? 'done' : ''}">
        <span class="goal-todo-status status-${t.status}">${statusLabel[t.status] || t.status}</span>
        <span class="goal-todo-text">${escapeHtmlT(t.text)}</span>
        ${t.due_date ? `<span class="mile-date">${formatDate(t.due_date)}</span>` : ''}
      </div>`).join('');

    return `
      <div class="plan-card goal-card" style="border-left-color:${g.color}">
        <div class="goal-card-head">
          <div>
            <div class="goal-card-title"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> ${escapeHtmlT(g.title)}</div>
            <div class="goal-card-period">${formatDate(g.start_date)} 〜 ${formatDate(g.end_date)} ・ ${leftLabel}</div>
          </div>
          <div class="todo-actions">
            <button class="todo-edit-btn goal-edit" data-id="${g.id}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></button>
            <button class="todo-del goal-del" data-id="${g.id}">×</button>
          </div>
        </div>
        ${g.note ? `<div class="goal-card-note">${escapeHtmlT(g.note)}</div>` : ''}
        <div class="goal-progress">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${g.color}"></div></div>
          <span class="progress-count">${total ? `${done} / ${total}（${pct}%）` : '—'}</span>
        </div>

        <div class="goal-sub-title">マイルストーン</div>
        ${mileRows || '<div class="goal-empty">まだありません</div>'}
        <form class="mile-form" data-goal="${g.id}">
          <input type="text" class="mile-input" placeholder="マイルストーン（例: 模試で6.5）">
          <input type="date" class="mile-date-input">
          <button type="submit" class="add-schedule-btn">＋追加</button>
        </form>

        ${linked.length ? `<div class="goal-sub-title">ひもづいた ToDo</div>${todoRows}` : ''}
      </div>`;
  }).join('') || '<div class="empty-msg">目標がありません。下のフォームから追加してください</div>';

  box.querySelectorAll('.mile-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      await db.from('plan_milestones').update({ done: cb.checked }).eq('id', cb.dataset.id);
      loadPlan();
    });
  });

  box.querySelectorAll('.mile-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('このマイルストーンを削除しますか？')) return;
      await db.from('plan_milestones').delete().eq('id', btn.dataset.id);
      loadPlan();
    });
  });

  box.querySelectorAll('.mile-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = form.querySelector('.mile-input').value.trim();
      if (!title) return;
      const { error } = await db.from('plan_milestones').insert([{
        goal_id:  Number(form.dataset.goal),
        title,
        due_date: form.querySelector('.mile-date-input').value || null,
      }]);
      if (error) console.error('plan_milestones insert error:', error);
      loadPlan();
    });
  });

  box.querySelectorAll('.goal-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = planGoals.find(x => String(x.id) === btn.dataset.id);
      if (g) startGoalEdit(g);
    });
  });

  box.querySelectorAll('.goal-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('この目標を削除しますか？\nマイルストーンも一緒に消えます（ToDo は残ります）。')) return;
      await db.from('plan_goals').delete().eq('id', btn.dataset.id);
      loadPlan();
      loadTodos();
    });
  });
}

function startGoalEdit(g) {
  editingGoalId = g.id;
  document.getElementById('goal-title').value = g.title;
  document.getElementById('goal-start').value = g.start_date;
  document.getElementById('goal-end').value   = g.end_date;
  document.getElementById('goal-color').value = g.color || '#af52de';
  document.getElementById('goal-note').value  = g.note || '';
  document.getElementById('goal-form-title').innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg> 目標を編集';
  document.getElementById('goal-submit').textContent     = '保存';
  document.getElementById('goal-cancel').hidden          = false;
  document.getElementById('goal-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetGoalForm() {
  editingGoalId = null;
  document.getElementById('goal-form').reset();
  document.getElementById('goal-form-title').textContent = '＋ 目標を追加';
  document.getElementById('goal-submit').textContent     = '追加する';
  document.getElementById('goal-cancel').hidden          = true;
}

document.getElementById('goal-cancel').addEventListener('click', resetGoalForm);

document.getElementById('goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title:      document.getElementById('goal-title').value.trim(),
    start_date: document.getElementById('goal-start').value,
    end_date:   document.getElementById('goal-end').value,
    color:      document.getElementById('goal-color').value,
    note:       document.getElementById('goal-note').value.trim() || null,
  };
  if (!payload.title || !payload.start_date || !payload.end_date) {
    alert('目標・開始日・終了日を入力してください');
    return;
  }
  if (payload.end_date < payload.start_date) {
    alert('終了日は開始日より後にしてください');
    return;
  }

  const { error } = editingGoalId
    ? await db.from('plan_goals').update(payload).eq('id', editingGoalId)
    : await db.from('plan_goals').insert([payload]);
  if (error) console.error('plan_goals save error:', error);

  resetGoalForm();
  loadPlan();
});

document.getElementById('plan-prev').addEventListener('click', () => {
  planStart = new Date(planStart.getFullYear(), planStart.getMonth() - 3, 1);
  renderRoadmap();
});
document.getElementById('plan-next').addEventListener('click', () => {
  planStart = new Date(planStart.getFullYear(), planStart.getMonth() + 3, 1);
  renderRoadmap();
});

// ============================================================
// 初期化
// ============================================================
loadGoals().then(loadTodos);
loadNotionAssignments();
renderTimeline();
initGcal();

// データ更新ボタン
document.getElementById('btn-refresh').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  await Promise.all([loadGoals().then(loadTodos), loadNotionAssignments()]);
  if (document.getElementById('tab-plan').classList.contains('active')) await loadPlan();
  await renderTimeline();
  btn.classList.remove('spinning');
});
