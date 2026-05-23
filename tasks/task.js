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
const ROUTINE_KEYS = ['ielts', 'reading', 'training'];
const CELL_W       = 36;

const CAT_COLORS = {
  '神大':   '#2980B9',
  'バイト': '#F39C12',
  'Betting':'#E74C3C',
  '資格':   '#27AE60',
  'その他': '#95A5A6',
};

// ============================================================
// Google Calendar 連携
// ============================================================
const GCAL_CLIENT_ID = '1053779234925-qc97npjce6q3avsssjkfl3jvldjv4sj1.apps.googleusercontent.com';
const GCAL_SCOPE     = 'https://www.googleapis.com/auth/calendar.events';

let gcalToken   = null;
let tokenClient = null;

function initGcal() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGcal, 300);
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GCAL_CLIENT_ID,
    scope:     GCAL_SCOPE,
    callback:  (resp) => {
      if (resp.error) {
        // サイレント認証が失敗したらヘッダーに手動認証ボタンを表示
        showGcalAuthBtn();
        return;
      }
      gcalToken = resp.access_token;
      hideGcalAuthBtn();
    },
  });
  // 過去に認証済みならポップアップなしで自動取得
  tokenClient.requestAccessToken({ prompt: 'none' });
  // callback が呼ばれない場合のフォールバック（2秒後にトークン未取得なら認証ボタンを表示）
  setTimeout(() => { if (!gcalToken) showGcalAuthBtn(); }, 2000);
}

function showGcalAuthBtn() {
  if (document.getElementById('gcal-auth-btn')) return;
  const btn = document.createElement('button');
  btn.id        = 'gcal-auth-btn';
  btn.className = 'gcal-auth-btn';
  btn.textContent = '📅 GCal 認証';
  btn.addEventListener('click', () => {
    if (tokenClient) tokenClient.requestAccessToken();
  });
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
      end:     { date: nextDay.toISOString().split('T')[0] },
      colorId: String(colorId),
    }),
  });
  if (res.status === 401) { gcalToken = null; updateGcalBtn(); return null; }
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
  if (res.status === 401) { gcalToken = null; updateGcalBtn(); }
}

// ============================================================
// ユーティリティ
// ============================================================
function todayStr() {
  return new Date().toISOString().split('T')[0];
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
    return y.toISOString().split('T')[0];
  }
  return now.toISOString().split('T')[0];
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
          ? `📅 ${formatDate(t.due_date)}`
          : `📅 ${formatDate(t.due_date)} ${t.due_time}`)
      : '';
    const catBadge  = t.category ? `<span class="cat-badge cat-${t.category}">${t.category}</span>` : '';
    const doneDate  = t.done_at  ? `<span class="done-date">✓ ${t.done_at}</span>` : '';

    // 実行予定日チップ
    const schedules = (t.task_schedules || [])
      .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
    const scheduleBadges = schedules.length > 0
      ? `<div class="todo-schedules">${schedules.map(s =>
          `<span class="s-badge">🗓 ${formatDate(s.schedule_date)}</span>`
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
              ${t.due_date ? `<span class="todo-due ${overdue ? 'overdue' : ''}">${dueLabel}</span>` : ''}
              ${doneDate}
            </div>
            ${scheduleBadges}
          </div>
        </div>
        <div class="todo-actions">
          <button class="todo-edit-btn" data-id="${t.id}">✏️</button>
          <button class="todo-del" data-id="${t.id}">×</button>
        </div>
      </div>`;
  }).join('') || '<div class="empty-msg">タスクがありません</div>';

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

  // ---- ラベル列（タスク名） ----
  const labelsEl = document.getElementById('tl-labels');
  labelsEl.innerHTML =
    `<div class="tl-label-header"></div>` +
    tasks.map(t =>
      `<div class="tl-label-row" title="${t.text}"><span class="tl-label-name">${t.text}</span></div>`
    ).join('') +
    `<div class="tl-label-row tl-add-label">＋ 新規追加</div>`;

  labelsEl.querySelector('.tl-add-label')?.addEventListener('click', () => {
    openTlModal(todayStr(), todayStr());
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
    const newDate = d.toISOString().split('T')[0];
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
    const newDateStr = base.toISOString().split('T')[0];
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
  const recordDate  = getRoutineDate();
  const now         = new Date();
  const isLateNight = now.getHours() < 3;

  document.getElementById('routine-record-date').textContent = formatDate(recordDate);

  const hintEl = document.getElementById('routine-hint');
  if (isLateNight) {
    hintEl.textContent = `⚠️ 現在${now.getHours()}時台のため、前日（${formatDate(recordDate)}）として記録されます`;
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }

  const { data } = await db.from('routine_logs').select('*').eq('date', recordDate).single();

  document.querySelectorAll('.routine-item input[type="checkbox"]').forEach(cb => {
    cb.checked = data ? !!data[cb.dataset.key] : false;
    cb.addEventListener('change', () => saveRoutine(recordDate));
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

async function saveRoutine(recordDate) {
  updateRoutineProgress();
  const { data: existing } = await db.from('routine_logs').select('*').eq('date', recordDate).single();
  const payload = { date: recordDate, ...existing };
  document.querySelectorAll('.routine-item input[type="checkbox"]').forEach(cb => {
    payload[cb.dataset.key] = cb.checked;
  });
  await db.from('routine_logs').upsert([payload], { onConflict: 'date' });
}

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
    const cnt = log ? ROUTINE_KEYS.reduce((s, k) => s + (log[k] ? 1 : 0), 0) : 0;
    labels.push(d.slice(5));
    counts.push(cnt);
    colors.push(cnt === 3 ? '#27AE60' : cnt >= 1 ? '#F5A623' : '#E4E9F0');
  }

  if (habitChart) habitChart.destroy();
  habitChart = new Chart(document.getElementById('habit-chart').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} / 3 完了` } } },
      scales: {
        y: { min: 0, max: 3, ticks: { stepSize: 1 }, grid: { color: '#F2F4F7' } },
        x: { ticks: { maxRotation: 0, callback: (v, i) => i % 5 === 0 ? labels[i] : '' }, grid: { display: false } },
      },
    },
  });
}

// ============================================================
// 初期化
// ============================================================
loadTodos();
renderTimeline();
initGcal();
