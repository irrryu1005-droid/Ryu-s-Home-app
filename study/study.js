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
function todayJST() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// 状態
// ============================================================
let _books       = [];
let _scores      = [];
let _studyLogs   = [];
let _statusFilter = 'all';
let _catFilter    = 'all';
let _ieltsGoal    = localStorage.getItem('ielts_goal') || null;

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

// ============================================================
// Reading — CRUD
// ============================================================
function normalizeBook(row) {
  return {
    id:          row.id,
    title:       row.title,
    author:      row.author       || '',
    status:      row.status       || 'unread',
    currentPage: row.current_page || 0,
    totalPages:  row.total_pages  || null,
    category:    row.category     || '',
    completedAt: row.completed_at || null,
  };
}
function bookToRow(b) {
  return {
    title:        b.title,
    author:       b.author       || null,
    status:       b.status,
    current_page: b.currentPage  ? parseInt(b.currentPage) : 0,
    total_pages:  b.totalPages   ? parseInt(b.totalPages)  : null,
    category:     b.category     || null,
    completed_at: b.completedAt  || null,
  };
}

async function loadBooks() {
  const { data } = await db.from('books').select('*').order('created_at', { ascending: false });
  _books = (data || []).map(normalizeBook);
}
async function addBook(b) {
  const { data, error } = await db.from('books').insert([bookToRow(b)]).select().single();
  if (error) { console.error(error); return; }
  _books.unshift(normalizeBook(data));
}
async function updateBook(id, b) {
  const row = bookToRow(b);
  const { error } = await db.from('books').update(row).eq('id', id);
  if (error) { console.error(error); return; }
  const idx = _books.findIndex(x => x.id === id);
  if (idx !== -1) _books[idx] = normalizeBook({ id, ...row });
}
async function deleteBook(id) {
  const { error } = await db.from('books').delete().eq('id', id);
  if (error) { console.error(error); return; }
  _books = _books.filter(x => x.id !== id);
}

// ============================================================
// Reading — レンダリング
// ============================================================
const STATUS_LABEL = { unread: '未読', reading: '読中', completed: '完読' };
const STATUS_BADGE = { unread: 'badge-unread', reading: 'badge-reading', completed: 'badge-completed' };

function renderBooks() {
  let list = _books;
  if (_statusFilter !== 'all') list = list.filter(b => b.status === _statusFilter);
  if (_catFilter    !== 'all') list = list.filter(b => b.category === _catFilter);

  document.getElementById('count-reading').textContent   = _books.filter(b => b.status === 'reading').length;
  document.getElementById('count-completed').textContent = _books.filter(b => b.status === 'completed').length;
  document.getElementById('count-unread').textContent    = _books.filter(b => b.status === 'unread').length;

  const container = document.getElementById('book-list');
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-msg">本がありません。「＋ 追加」から登録してください。</div>';
    return;
  }

  const rows = list.map(b => {
    const pct = (b.totalPages && b.currentPage)
      ? Math.min(100, Math.round(b.currentPage / b.totalPages * 100)) : null;
    const progressHtml = (b.status === 'reading' && pct !== null)
      ? `<div class="book-progress-wrap">
           <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
           <span class="progress-text">${b.currentPage}/${b.totalPages}p (${pct}%)</span>
         </div>`
      : '';
    const completedHtml = b.status === 'completed' && b.completedAt
      ? `<span class="completed-date">✅ ${b.completedAt}</span>` : '';
    const catBadge = b.category
      ? `<span class="badge-cat">${escapeHtml(b.category)}</span>` : '';

    return `<div class="book-row">
      <div class="book-row-left">
        <div class="book-title">${escapeHtml(b.title)}</div>
        ${b.author ? `<div class="book-author">${escapeHtml(b.author)}</div>` : ''}
        ${progressHtml}
      </div>
      <div class="book-row-right">
        <div style="display:flex;gap:4px;align-items:center;">
          ${catBadge}
          <span class="badge-status ${STATUS_BADGE[b.status]}">${STATUS_LABEL[b.status]}</span>
        </div>
        ${completedHtml}
        <div class="book-actions">
          <button class="small-btn btn-edit" data-id="${b.id}">編集</button>
          <button class="small-btn btn-delete" data-id="${b.id}">削除</button>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="book-list-wrap">${rows}</div>`;

  container.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => openEditBook(btn.dataset.id))
  );
  container.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteBook(btn.dataset.id))
  );
}

// ============================================================
// Reading — フォーム
// ============================================================
function openAddBook() {
  const form = document.getElementById('book-form');
  form.reset();
  form.elements.id.value = '';
  document.getElementById('book-form-title').textContent = '本を追加';
  updateCompletedAt('unread');
  document.getElementById('book-modal-overlay').hidden = false;
}
function openEditBook(id) {
  const b = _books.find(x => x.id === id);
  if (!b) return;
  const form = document.getElementById('book-form');
  form.elements.id.value          = b.id;
  form.elements.title.value       = b.title;
  form.elements.author.value      = b.author      || '';
  form.elements.category.value    = b.category    || '';
  form.elements.status.value      = b.status;
  form.elements.currentPage.value = b.currentPage || '';
  form.elements.totalPages.value  = b.totalPages  || '';
  form.elements.completedAt.value = b.completedAt || '';
  updateCompletedAt(b.status);
  document.getElementById('book-form-title').textContent = '編集';
  document.getElementById('book-modal-overlay').hidden = false;
}
function updateCompletedAt(status) {
  document.getElementById('completed-at-wrap').hidden = status !== 'completed';
}
async function confirmDeleteBook(id) {
  const b = _books.find(x => x.id === id);
  if (!b || !confirm(`「${b.title}」を削除しますか？`)) return;
  await deleteBook(id);
  renderBooks();
}

// ============================================================
// IELTS — CRUD
// ============================================================
function normalizeScore(row) {
  return {
    id:        row.id,
    date:      row.date,
    overall:   row.overall,
    listening: row.listening,
    reading:   row.reading,
    writing:   row.writing,
    speaking:  row.speaking,
    scoreType: row.score_type || 'mock',
    note:      row.note || '',
  };
}
async function loadScores() {
  const { data } = await db.from('ielts_scores').select('*').order('date', { ascending: false });
  _scores = (data || []).map(normalizeScore);
}
async function addScore(s) {
  const row = {
    date: s.date, overall: s.overall || null,
    listening: s.listening || null, reading: s.reading || null,
    writing: s.writing || null, speaking: s.speaking || null,
    score_type: s.scoreType, note: s.note || null,
  };
  const { data, error } = await db.from('ielts_scores').insert([row]).select().single();
  if (error) { console.error(error); return; }
  _scores.unshift(normalizeScore(data));
}
async function deleteScore(id) {
  await db.from('ielts_scores').delete().eq('id', id);
  _scores = _scores.filter(x => x.id !== id);
}

function normalizeLog(row) {
  return {
    id:       row.id,
    date:     row.date,
    duration: row.duration_minutes,
    section:  row.section || 'overall',
    note:     row.note || '',
  };
}
async function loadStudyLogs() {
  const { data } = await db.from('ielts_study_log').select('*').order('date', { ascending: false });
  _studyLogs = (data || []).map(normalizeLog);
}
async function addStudyLog(l) {
  const row = {
    date: l.date, duration_minutes: parseInt(l.duration),
    section: l.section, note: l.note || null,
  };
  const { data, error } = await db.from('ielts_study_log').insert([row]).select().single();
  if (error) { console.error(error); return; }
  _studyLogs.unshift(normalizeLog(data));
}
async function deleteStudyLog(id) {
  await db.from('ielts_study_log').delete().eq('id', id);
  _studyLogs = _studyLogs.filter(x => x.id !== id);
}

// ============================================================
// IELTS — レンダリング
// ============================================================
const SECTION_LABEL = {
  overall: '総合', listening: 'L', reading: 'R',
  writing: 'W', speaking: 'S', vocabulary: '単語'
};

function renderIelts() {
  // 目標・最新スコア
  document.getElementById('ielts-goal-val').textContent   = _ieltsGoal || '—';
  document.getElementById('ielts-latest-val').textContent = _scores.length ? _scores[0].overall ?? '—' : '—';

  // 学習時間サマリー
  const today = new Date();
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const toDate = s => new Date(s.date);
  const weekMin  = _studyLogs.filter(l => toDate(l) >= weekStart).reduce((s, l) => s + l.duration, 0);
  const monthMin = _studyLogs.filter(l => toDate(l) >= monthStart).reduce((s, l) => s + l.duration, 0);
  const totalMin = _studyLogs.reduce((s, l) => s + l.duration, 0);

  document.getElementById('study-week').textContent  = fmtMin(weekMin);
  document.getElementById('study-month').textContent = fmtMin(monthMin);
  document.getElementById('study-total').textContent = fmtMin(totalMin);

  // スコア一覧
  const scoreContainer = document.getElementById('score-list');
  if (_scores.length === 0) {
    scoreContainer.innerHTML = '<div class="empty-msg">スコアがありません</div>';
  } else {
    scoreContainer.innerHTML = _scores.map(s => {
      const secs = ['listening','reading','writing','speaking']
        .filter(k => s[k] != null)
        .map(k => `<span class="score-sec">${k[0].toUpperCase()}:<span>${s[k]}</span></span>`)
        .join('');
      return `<div class="score-row">
        <span class="score-date">${s.date}</span>
        <span class="score-type-badge score-type-${s.scoreType}">${s.scoreType === 'mock' ? '模試' : '本番'}</span>
        <span class="score-overall">${s.overall ?? '—'}</span>
        <div class="score-sections">${secs}</div>
        ${s.note ? `<span style="font-size:11px;color:var(--muted)">${escapeHtml(s.note)}</span>` : ''}
        <div class="score-actions">
          <button class="small-btn btn-delete" data-score-id="${s.id}">削除</button>
        </div>
      </div>`;
    }).join('');
    scoreContainer.querySelectorAll('[data-score-id]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('削除しますか？')) return;
        await deleteScore(btn.dataset.scoreId);
        renderIelts();
      })
    );
  }

  // 学習ログ一覧
  const logContainer = document.getElementById('study-log-list');
  if (_studyLogs.length === 0) {
    logContainer.innerHTML = '<div class="empty-msg">学習ログがありません</div>';
  } else {
    logContainer.innerHTML = _studyLogs.map(l =>
      `<div class="log-row">
        <span class="log-date">${l.date}</span>
        <span class="log-section-badge">${SECTION_LABEL[l.section] || l.section}</span>
        <span class="log-duration">${fmtMin(l.duration)}</span>
        ${l.note ? `<span class="log-note">${escapeHtml(l.note)}</span>` : '<span class="log-note"></span>'}
        <div class="log-actions">
          <button class="small-btn btn-delete" data-log-id="${l.id}">削除</button>
        </div>
      </div>`
    ).join('');
    logContainer.querySelectorAll('[data-log-id]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('削除しますか？')) return;
        await deleteStudyLog(btn.dataset.logId);
        renderIelts();
      })
    );
  }
}

// ============================================================
// Programming — 知識メモ（静的データ）
// ============================================================
const PROG_NOTES = [
  {
    category: 'JavaScript 基礎',
    items: [
      {
        title: 'async/await と Promise',
        body: `<p>非同期処理を書くときの2つの方法。<code>async/await</code> の方が読みやすい。</p>
<pre>// async/await
async function fetchData() {
  const res  = await fetch('https://api.example.com/data');
  const data = await res.json();
  return data;
}

// Promise チェーン（古い書き方）
fetch('https://api.example.com/data')
  .then(res => res.json())
  .then(data => console.log(data));</pre>
<ul>
  <li><code>await</code> は <code>async</code> 関数の中でしか使えない</li>
  <li>エラー処理は <code>try { } catch (e) { }</code> で包む</li>
</ul>`
      },
      {
        title: 'DOM 操作の基本',
        body: `<ul>
  <li><code>document.getElementById('id')</code> — ID で要素取得</li>
  <li><code>document.querySelector('.class')</code> — CSSセレクタで取得（最初の1つ）</li>
  <li><code>document.querySelectorAll('button')</code> — 複数取得（NodeList）</li>
  <li><code>element.innerHTML = '...'</code> — HTMLを丸ごと書き換え</li>
  <li><code>element.textContent = '...'</code> — テキストのみ書き換え（XSS安全）</li>
  <li><code>element.hidden = true/false</code> — 表示切替（CSSに <code>[hidden]{display:none}</code> 必要なことあり）</li>
</ul>`
      },
      {
        title: 'イベントリスナー',
        body: `<pre>// クリックイベント
button.addEventListener('click', () => {
  console.log('クリックされた！');
});

// フォーム送信（デフォルト動作をキャンセル）
form.addEventListener('submit', e => {
  e.preventDefault();
  const value = e.target.elements.inputName.value;
});</pre>
<p><code>forEach</code> で複数要素に一括登録できる：</p>
<pre>document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', () => { /* ... */ });
});</pre>`
      },
      {
        title: 'テンプレートリテラル（バッククォート）',
        body: `<p>文字列の中に変数を埋め込める。HTMLを動的に生成するのに便利。</p>
<pre>const name = 'Ryu';
const score = 7.5;

// 古い書き方
const msg = 'こんにちは、' + name + '！スコアは' + score + 'です';

// テンプレートリテラル（バッククォート）
const msg = \`こんにちは、\${name}！スコアは\${score}です\`;

// 複数行もOK
const html = \`
  &lt;div class="card"&gt;
    &lt;h2&gt;\${name}&lt;/h2&gt;
  &lt;/div&gt;
\`;</pre>`
      },
    ]
  },
  {
    category: 'CSS テクニック',
    items: [
      {
        title: 'Flexbox レイアウト',
        body: `<p>要素を横並び・縦並びに配置する最もよく使うCSS。</p>
<pre>.container {
  display: flex;
  gap: 10px;              /* 要素間のすき間 */
  align-items: center;    /* 縦方向の揃え */
  justify-content: space-between; /* 横方向の配置 */
  flex-wrap: wrap;        /* 折り返し許可 */
}
.child {
  flex: 1;   /* 残りの幅を均等分割 */
  flex: 0 0 200px; /* 固定幅200px */
}</pre>`
      },
      {
        title: 'CSS変数（カスタムプロパティ）',
        body: `<p>色やサイズを一か所で管理できる。変更が楽になる。</p>
<pre>/* :root で全体に適用 */
:root {
  --accent: #2563EB;
  --bg:     #F2F4F7;
  --radius: 14px;
}

/* 使うとき */
.button {
  background: var(--accent);
  border-radius: var(--radius);
}</pre>`
      },
      {
        title: '[hidden] 属性と display の競合',
        body: `<p>CSSで <code>display: flex</code> を指定している要素に <code>hidden</code> 属性をつけても、<code>display: flex</code> が勝って非表示にならないことがある。</p>
<pre>/* この1行を追加して明示的にhiddenを効かせる */
.modal-overlay[hidden] { display: none; }</pre>
<p>これは author stylesheet（自分のCSS）が user-agent stylesheet（ブラウザ標準）より優先されるため。</p>`
      },
      {
        title: 'CSSトグルスイッチ（チェックボックス）',
        body: `<p>JavaScriptなしで作れるトグルスイッチ。</p>
<pre>/* HTML */
&lt;label class="toggle-lbl"&gt;
  &lt;input type="checkbox"&gt;
  &lt;span class="toggle-switch"&gt;&lt;/span&gt;
  &lt;span&gt;ラベル&lt;/span&gt;
&lt;/label&gt;

/* CSS */
.toggle-lbl input { display: none; }
.toggle-switch {
  width: 40px; height: 22px;
  background: #ccc; border-radius: 99px;
  position: relative; transition: background 0.2s;
}
.toggle-switch::after {
  content: '';
  position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px;
  background: white; border-radius: 50%;
  transition: transform 0.2s;
}
/* チェック時 */
.toggle-lbl input:checked + .toggle-switch { background: #2563EB; }
.toggle-lbl input:checked + .toggle-switch::after { transform: translateX(18px); }</pre>`
      },
    ]
  },
  {
    category: 'Supabase 使い方',
    items: [
      {
        title: 'クライアントの初期化',
        body: `<pre>const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);</pre>
<p>URLとANON KEYはSupabaseダッシュボードの「Project Settings → API」から確認できる。</p>`
      },
      {
        title: 'SELECT（データ取得）',
        body: `<pre>// 全件取得
const { data, error } = await db.from('todos').select('*');

// 条件付き
const { data } = await db
  .from('todos')
  .select('*')
  .eq('status', 'active')       // WHERE status = 'active'
  .order('created_at')          // ORDER BY created_at
  .limit(20);                   // LIMIT 20

// 1件だけ取得
const { data } = await db
  .from('todos')
  .select('*')
  .eq('id', someId)
  .single();                    // 配列でなくオブジェクトで返る</pre>`
      },
      {
        title: 'INSERT（追加）',
        body: `<pre>const { data, error } = await db
  .from('todos')
  .insert([{ text: 'やること', status: 'will' }])
  .select()   // 追加後のデータを返す
  .single();</pre>`
      },
      {
        title: 'UPDATE（更新）',
        body: `<pre>const { error } = await db
  .from('todos')
  .update({ status: 'done' })
  .eq('id', targetId);</pre>`
      },
      {
        title: 'DELETE（削除）',
        body: `<pre>const { error } = await db
  .from('todos')
  .delete()
  .eq('id', targetId);</pre>`
      },
      {
        title: 'Promise.all で並列取得',
        body: `<p>複数テーブルを同時に取得すると速い。</p>
<pre>const [booksRes, logsRes] = await Promise.all([
  db.from('books').select('*'),
  db.from('ielts_study_log').select('*'),
]);
const books = booksRes.data || [];
const logs  = logsRes.data  || [];</pre>`
      },
    ]
  },
  {
    category: 'よく使うパターン',
    items: [
      {
        title: 'モーダル（下から出るボトムシート）',
        body: `<pre>/* HTML */
&lt;div id="modal" class="modal-overlay" hidden&gt;
  &lt;div class="modal-card"&gt;
    &lt;!-- コンテンツ --&gt;
  &lt;/div&gt;
&lt;/div&gt;

/* CSS */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: flex-end;
  z-index: 200;
}
.modal-overlay[hidden] { display: none; }
.modal-card {
  width: 100%; max-height: 90vh;
  overflow-y: auto;
  border-radius: 14px 14px 0 0;
}

/* JS */
document.getElementById('open-btn').addEventListener('click', () => {
  document.getElementById('modal').hidden = false;
});
// 背景クリックで閉じる
modal.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});</pre>`
      },
      {
        title: 'XSS対策（escapeHtml）',
        body: `<p>ユーザーが入力した文字列をそのまま <code>innerHTML</code> に使うと、悪意あるスクリプトが実行される（XSS攻撃）。必ずエスケープする。</p>
<pre>function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;amp;')
    .replace(/&lt;/g, '&amp;lt;')
    .replace(/&gt;/g, '&amp;gt;')
    .replace(/"/g, '&amp;quot;');
}

// 使い方
container.innerHTML = \`&lt;div&gt;\${escapeHtml(userInput)}&lt;/div&gt;\`;</pre>`
      },
      {
        title: 'リアルタイム為替レート取得',
        body: `<p>frankfurter.app はlocalhostでCORSエラーになる。<code>@fawazahmed0/currency-api</code> を使う。</p>
<pre>const res  = await fetch(
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'
);
const data = await res.json();
const usdJpy = data.usd.jpy; // 例: 157.3</pre>`
      },
    ]
  },
];

function renderProgramming() {
  const query = document.getElementById('prog-search').value.toLowerCase();
  const container = document.getElementById('prog-list');

  let html = '';
  PROG_NOTES.forEach(section => {
    const filtered = section.items.filter(item =>
      !query || item.title.toLowerCase().includes(query) || item.body.toLowerCase().includes(query)
    );
    if (filtered.length === 0) return;
    html += `<div class="prog-section">
      <div class="prog-section-title">${escapeHtml(section.category)}</div>
      ${filtered.map(item => `
        <div class="prog-card">
          <div class="prog-card-header" onclick="this.parentElement.classList.toggle('open')">
            <span class="prog-card-title">${escapeHtml(item.title)}</span>
            <span class="prog-card-arrow">▶</span>
          </div>
          <div class="prog-card-body">${item.body}</div>
        </div>
      `).join('')}
    </div>`;
  });
  container.innerHTML = html || '<div class="empty-msg">該当するメモが見つかりません</div>';
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
    });
  });
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();

  // ---- Reading ----
  document.getElementById('btn-add-book').addEventListener('click', openAddBook);
  document.getElementById('btn-cancel-book').addEventListener('click', () => {
    document.getElementById('book-modal-overlay').hidden = true;
  });
  document.getElementById('book-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  document.querySelector('#book-form select[name="status"]').addEventListener('change', e => {
    updateCompletedAt(e.target.value);
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _statusFilter = btn.dataset.status;
      renderBooks();
    });
  });
  document.querySelectorAll('.cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _catFilter = btn.dataset.cat;
      renderBooks();
    });
  });

  document.getElementById('book-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const book = {
      title:       f.elements.title.value.trim(),
      author:      f.elements.author.value.trim()      || null,
      category:    f.elements.category.value           || null,
      status:      f.elements.status.value,
      currentPage: f.elements.currentPage.value        || 0,
      totalPages:  f.elements.totalPages.value         || null,
      completedAt: f.elements.completedAt.value        || null,
    };
    const id = f.elements.id.value;
    if (id) await updateBook(id, book); else await addBook(book);
    document.getElementById('book-modal-overlay').hidden = true;
    renderBooks();
  });

  // ---- IELTS ----
  document.getElementById('btn-edit-goal').addEventListener('click', () => {
    const val = prompt('目標スコアを入力（例: 7.0）', _ieltsGoal || '');
    if (val === null) return;
    _ieltsGoal = val.trim() || null;
    if (_ieltsGoal) localStorage.setItem('ielts_goal', _ieltsGoal);
    else localStorage.removeItem('ielts_goal');
    renderIelts();
  });

  document.getElementById('btn-add-score').addEventListener('click', () => {
    document.getElementById('score-form').reset();
    document.getElementById('score-form').elements.date.value = todayJST();
    document.getElementById('score-modal-overlay').hidden = false;
  });
  document.querySelectorAll('.modal-close-score').forEach(btn =>
    btn.addEventListener('click', () => { document.getElementById('score-modal-overlay').hidden = true; })
  );
  document.getElementById('score-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });
  document.getElementById('score-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await addScore({
      date: f.elements.date.value, scoreType: f.elements.scoreType.value,
      overall: f.elements.overall.value || null, listening: f.elements.listening.value || null,
      reading: f.elements.reading.value || null, writing: f.elements.writing.value || null,
      speaking: f.elements.speaking.value || null, note: f.elements.note.value || null,
    });
    document.getElementById('score-modal-overlay').hidden = true;
    renderIelts();
  });

  document.getElementById('btn-add-log').addEventListener('click', () => {
    document.getElementById('log-form').reset();
    document.getElementById('log-form').elements.date.value = todayJST();
    document.getElementById('log-modal-overlay').hidden = false;
  });
  document.querySelectorAll('.modal-close-log').forEach(btn =>
    btn.addEventListener('click', () => { document.getElementById('log-modal-overlay').hidden = true; })
  );
  document.getElementById('log-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });
  document.getElementById('log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await addStudyLog({
      date: f.elements.date.value, duration: f.elements.duration.value,
      section: f.elements.section.value, note: f.elements.note.value || null,
    });
    document.getElementById('log-modal-overlay').hidden = true;
    renderIelts();
  });

  // ---- Programming ----
  document.getElementById('prog-search').addEventListener('input', renderProgramming);

  // ---- データ読み込み ----
  await Promise.all([loadBooks(), loadScores(), loadStudyLogs()]);
  renderBooks();
  renderIelts();
  renderProgramming();

  // データ更新ボタン
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    await Promise.all([loadBooks(), loadScores(), loadStudyLogs()]);
    renderBooks();
    renderIelts();
    renderProgramming();
    btn.classList.remove('spinning');
  });
});
