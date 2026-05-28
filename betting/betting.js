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
const SPORTS = ['Football', 'Baseball', 'Basketball', 'Tennis', 'Other'];
const LEAGUES_KEY = 'betting-leagues';
const DEFAULT_LEAGUES = {
  'Football':   ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'Other'],
  'Baseball':   ['NPB', 'MLB'],
  'Basketball': ['NBA', 'B.League'],
  'Tennis':     [],
};

// 旧日本語キー → 英語へのマッピング（既存データ互換）
const SPORT_JP_TO_EN = {
  'サッカー': 'Football', '野球': 'Baseball',
  'バスケ': 'Basketball', 'テニス': 'Tennis', 'その他': 'Other',
};
function sportDisplay(s) { return SPORT_JP_TO_EN[s] || s; }

function getLeagues() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEAGUES_KEY));
    if (stored && typeof stored === 'object') {
      // 旧日本語キーを英語キーに移行
      const migrated = {};
      for (const [k, v] of Object.entries(stored)) {
        migrated[SPORT_JP_TO_EN[k] || k] = v;
      }
      return migrated;
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_LEAGUES));
}

function addLeagueToStorage(sport, name) {
  const leagues = getLeagues();
  if (!leagues[sport]) leagues[sport] = [];
  if (!leagues[sport].includes(name)) leagues[sport].push(name);
  localStorage.setItem(LEAGUES_KEY, JSON.stringify(leagues));
}

// ============================================================
// ローカルキャッシュ（Supabaseから読み込んだデータを保持）
// ============================================================
let _bets      = [];
let _campaigns = [];
let _settings  = { bankroll: null };
let _goals     = [];
let _deposits  = [];

const _now = new Date();
let _pnlYear  = _now.getFullYear();
let _pnlMonth = _now.getMonth() + 1;

function normalizeBet(row) {
  return {
    id:           row.id,
    date:         row.date,
    type:         row.type          || 'single',
    sport:        row.sport,
    league:       row.league,
    match:        row.match_name,
    bet:          row.bet_content,
    odds:         row.odds,
    combinedOdds: row.combined_odds,
    comboBoost:   row.combo_boost ?? 0,
    legs:         row.legs,
    stake:        row.stake,
    isFreebet:    row.is_freebet    || false,
    campaignId:   row.campaign_id,
    result:       row.result        || 'pending',
    memo:         row.memo,
  };
}

function normalizeGoal(row) {
  return {
    id:         row.id,
    name:       row.name,
    goalAmount: row.goal_amount,
    goalStart:  row.goal_start,
    goalEnd:    row.goal_end,
  };
}

function normalizeCampaign(row) {
  return {
    id:            row.id,
    name:          row.name,
    wagerRequired: row.wager_required,
    fbReward:      row.fb_reward,
    startDate:     row.start_date,
    status:        row.status        || 'active',
    completedDate: row.completed_date,
  };
}

async function loadAll() {
  const [betsRes, campsRes, settingsRes, goalsRes, depositsRes] = await Promise.all([
    db.from('bets').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('bet_campaigns').select('*').order('created_at'),
    db.from('bet_settings').select('*').eq('id', 1).single(),
    db.from('bet_goals').select('*').order('created_at'),
    db.from('bet_deposits').select('*').order('deposit_date', { ascending: false }),
  ]);
  _bets      = (betsRes.data     || []).map(normalizeBet);
  _campaigns = (campsRes.data    || []).map(normalizeCampaign);
  _settings  =  settingsRes.data || { bankroll: null };
  _goals     = (goalsRes.data    || []).map(normalizeGoal);
  _deposits  =  depositsRes.data || [];
}

function getAllBets()      { return _bets; }
function getAllCampaigns() { return _campaigns; }

// ============================================================
// Bet CRUD
// ============================================================
async function addBet(bet) {
  const row = betToRow(bet);
  const { data, error } = await db.from('bets').insert([row]).select().single();
  if (error) { console.error('addBet error:', error); return; }
  _bets.unshift(normalizeBet(data));
}

async function updateBet(id, bet) {
  const row = betToRow(bet);
  const { error } = await db.from('bets').update(row).eq('id', id);
  if (error) { console.error('updateBet error:', error); return; }
  const idx = _bets.findIndex(b => b.id === id);
  if (idx !== -1) _bets[idx] = { ...normalizeBet({ id, ...row }) };
}

async function deleteBet(id) {
  const { error } = await db.from('bets').delete().eq('id', id);
  if (error) { console.error('deleteBet error:', error); return; }
  _bets = _bets.filter(b => b.id !== id);
}

function betToRow(bet) {
  return {
    date:          bet.date,
    type:          bet.type,
    sport:         bet.sport         || null,
    league:        bet.league        || null,
    match_name:    bet.match         || null,
    bet_content:   bet.bet           || null,
    odds:          bet.odds          || null,
    combined_odds: bet.combinedOdds  || null,
    combo_boost:   bet.comboBoost    ?? 0,
    legs:          bet.legs          || null,
    stake:         bet.stake,
    is_freebet:    !!bet.isFreebet,
    campaign_id:   bet.campaignId    || null,
    result:        bet.result,
    memo:          bet.memo          || null,
  };
}

// ============================================================
// Campaign CRUD
// ============================================================
async function addCampaign(c) {
  const row = {
    name:           c.name,
    start_date:     c.startDate      || null,
    wager_required: c.wagerRequired,
    fb_reward:      c.fbReward,
    status:         'active',
    completed_date: null,
  };
  const { data, error } = await db.from('bet_campaigns').insert([row]).select().single();
  if (error) { console.error('addCampaign error:', error); return; }
  _campaigns.push(normalizeCampaign(data));
}

async function updateCampaign(id, updates) {
  const row = {};
  if (updates.status        !== undefined) row.status         = updates.status;
  if (updates.completedDate !== undefined) row.completed_date = updates.completedDate;
  const { error } = await db.from('bet_campaigns').update(row).eq('id', id);
  if (error) { console.error('updateCampaign error:', error); return; }
  const idx = _campaigns.findIndex(c => c.id === id);
  if (idx !== -1) _campaigns[idx] = { ..._campaigns[idx], ...updates };
}

async function deleteCampaign(id) {
  const { error } = await db.from('bet_campaigns').delete().eq('id', id);
  if (error) { console.error('deleteCampaign error:', error); return; }
  _campaigns = _campaigns.filter(c => c.id !== id);
}

// ============================================================
// 試合予定タブ - Google Calendar 設定
// ============================================================
const GC_CLIENT_ID_BET  = '1053779234925-qc97npjce6q3avsssjkfl3jvldjv4sj1.apps.googleusercontent.com';
const GC_SCOPE_BET      = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const GCAL_TOKEN_KEY    = 'gcal_shared_token';
const GCAL_AUTOLOGIN_KEY = 'gcal_autologin';

let gcTokenClientBet    = null;
let gcalTokenBet        = null;
let bettingCalendarId   = 'primary'; // Sportsカレンダー取得後に上書き

function gcalTokenSave(token) {
  gcalTokenBet = token;
  sessionStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + 3500 * 1000 }));
}
function gcalTokenRestore() {
  try {
    const s = JSON.parse(sessionStorage.getItem(GCAL_TOKEN_KEY));
    if (s && s.exp > Date.now()) { gcalTokenBet = s.token; return true; }
  } catch {}
  return false;
}
function gcalTokenClear() {
  gcalTokenBet = null;
  sessionStorage.removeItem(GCAL_TOKEN_KEY);
}

// ============================================================
// 設定・目標 CRUD（Supabase）
// ============================================================
async function saveBankroll(bankroll) {
  const { error } = await db.from('bet_settings')
    .update({ bankroll, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) { console.error('saveBankroll error:', error); return; }
  _settings.bankroll = bankroll;
}

async function addGoal(goal) {
  const { data, error } = await db.from('bet_goals').insert([{
    name:        goal.name,
    goal_amount: goal.goalAmount,
    goal_start:  goal.goalStart,
    goal_end:    goal.goalEnd,
  }]).select().single();
  if (error) { console.error('addGoal error:', error); return; }
  _goals.push(normalizeGoal(data));
}

async function deleteGoal(id) {
  const { error } = await db.from('bet_goals').delete().eq('id', id);
  if (error) { console.error('deleteGoal error:', error); return; }
  _goals = _goals.filter(g => g.id !== id);
}

function initSettings() {
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const bankroll = parseInt(document.getElementById('settings-bankroll').value) || null;
    await saveBankroll(bankroll);
    refreshAll();
  });

  document.getElementById('btn-deposit').addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('settings-deposit').value);
    if (!amount || amount <= 0) return;
    const dateVal = document.getElementById('settings-deposit-date').value;
    const depositDate = dateVal || new Date().toISOString().slice(0, 10);

    // bankroll を更新
    const current = _settings.bankroll || 0;
    const newBankroll = current + amount;
    await saveBankroll(newBankroll);

    // 入金履歴をDBに保存
    const { data, error } = await db.from('bet_deposits').insert([{
      amount, deposit_date: depositDate,
    }]).select().single();
    if (!error && data) _deposits.unshift(data);

    document.getElementById('settings-bankroll').value    = newBankroll;
    document.getElementById('settings-deposit').value     = '';
    document.getElementById('settings-deposit-date').value = '';
    renderDepositHistory();
    refreshAll();
  });

  renderDepositHistory();
}

function renderDepositHistory() {
  const el = document.getElementById('deposit-history');
  if (!el) return;
  if (_deposits.length === 0) { el.innerHTML = ''; return; }
  const rows = _deposits.map(d => `
    <div class="deposit-row">
      <span class="deposit-date">${d.deposit_date}</span>
      <span class="deposit-amount">+¥${Number(d.amount).toLocaleString()}</span>
      <button class="deposit-del-btn" data-id="${d.id}">✕</button>
    </div>`).join('');
  el.innerHTML = `<div class="deposit-history-label">入金履歴</div>${rows}`;

  el.querySelectorAll('.deposit-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const dep = _deposits.find(d => d.id === id);
      if (!dep) return;
      // bankroll から差し引き
      const newBankroll = (_settings.bankroll || 0) - dep.amount;
      await saveBankroll(newBankroll);
      await db.from('bet_deposits').delete().eq('id', id);
      _deposits = _deposits.filter(d => d.id !== id);
      document.getElementById('settings-bankroll').value = newBankroll;
      renderDepositHistory();
      refreshAll();
    });
  });
}

function populateSettings() {
  if (_settings.bankroll) document.getElementById('settings-bankroll').value = _settings.bankroll;
  renderDepositHistory();
}

// ============================================================
// ユーティリティ
// ============================================================

// 無効レッグを除いた実効オッズを返す（無効レッグはベットしていないとみなす）
function calcEffectiveOdds(bet) {
  if (bet.type !== 'parlay' || !Array.isArray(bet.legs)) return bet.odds;
  const active = bet.legs.filter(l => l.legResult !== 'void');
  if (active.length === 0) return 1;
  const base = active.reduce((acc, l) => acc * (l.odds || 1), 1);
  const boost = bet.comboBoost || 1;
  return boost > 1 ? base * boost : base;
}

function calcPnl(bet) {
  if (bet.isFreebet && bet.campaignId) {
    const campaign = _campaigns.find(c => c.id === bet.campaignId);
    if (!campaign || campaign.status !== 'completed') return null;
  }
  const odds = bet.type === 'parlay' ? calcEffectiveOdds(bet) : bet.odds;
  if (bet.result === 'win')  return Math.round(bet.stake * (odds - 1));
  if (bet.result === 'loss') return bet.isFreebet ? 0 : -bet.stake;
  if (bet.result === 'void') return 0;
  return null;
}

function formatPnl(pnl) {
  if (pnl === null) return '-';
  return (pnl >= 0 ? '+' : '') + '¥' + pnl.toLocaleString();
}

function resultLabel(result) {
  return { win: '✅ 勝', loss: '❌ 負', void: '➖ 無効', pending: '⏳ 未確定' }[result] || result;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ============================================================
// 損益計算書
// ============================================================
function renderPnlStatement() {
  const y = _pnlYear, m = _pnlMonth;
  document.getElementById('pnl-month-label').textContent = `${y}年${m}月`;

  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end   = `${y}-${String(m).padStart(2, '0')}-31`;
  const filtered = _bets.filter(b =>
    b.date >= start && b.date <= end && (b.result === 'win' || b.result === 'loss')
  );

  const expenses = {};
  const revenues = {};

  for (const bet of filtered) {
    const sport  = bet.type === 'parlay' ? 'マルチ' : (bet.sport  || 'その他');
    const league = bet.type === 'parlay'
      ? `${(bet.legs || []).length}連`
      : (bet.league || '未設定');
    const odds = bet.type === 'parlay' ? calcEffectiveOdds(bet) : (bet.odds || 1);

    // FB は実費ゼロなので費用に計上しない
    if (!bet.isFreebet) {
      if (!expenses[sport]) expenses[sport] = {};
      expenses[sport][league] = (expenses[sport][league] || 0) + bet.stake;
    }

    if (bet.result === 'win') {
      // FB勝ちは元手が戻らないため純利益分のみ収益
      const revenue = bet.isFreebet
        ? Math.round(bet.stake * (odds - 1))
        : Math.round(bet.stake * odds);
      if (!revenues[sport]) revenues[sport] = {};
      revenues[sport][league] = (revenues[sport][league] || 0) + revenue;
    }
  }

  const expTotal = Object.values(expenses).flatMap(Object.values).reduce((a, b) => a + b, 0);
  const revTotal = Object.values(revenues).flatMap(Object.values).reduce((a, b) => a + b, 0);
  const profit   = revTotal - expTotal;

  const buildSection = (type, label, data, total) => {
    if (total === 0) return '';
    let rows = '';
    for (const [sport, leagues] of Object.entries(data)) {
      const sportTotal = Object.values(leagues).reduce((a, b) => a + b, 0);
      const sportPct   = Math.round(sportTotal / total * 100);
      rows += `
        <div class="pnl-row sport">
          <div class="pnl-row-label">${escapeHtml(sport)}</div>
          <div class="pnl-bar-wrap"><div class="pnl-bar" style="width:${sportPct}%"></div></div>
          <div class="pnl-row-amount">¥${sportTotal.toLocaleString()}</div><div class="pnl-row-pct">${sportPct}%</div>
        </div>`;
      for (const [league, amt] of Object.entries(leagues)) {
        const pct = Math.round(amt / total * 100);
        rows += `
          <div class="pnl-row league">
            <div class="pnl-row-label">${escapeHtml(league)}</div>
            <div class="pnl-bar-wrap"><div class="pnl-bar" style="width:${pct}%"></div></div>
            <div class="pnl-row-amount">¥${amt.toLocaleString()}</div><div class="pnl-row-pct">${pct}%</div>
          </div>`;
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
      <div class="pnl-profit-body ${profit >= 0 ? 'is-profit' : 'is-loss'}">${profitSign}¥${profit.toLocaleString()}</div>
    </div>`;

  const expBlock = buildSection('expense', '費用', expenses, expTotal);
  const revBlock = buildSection('revenue', '収益', revenues, revTotal);

  // 利益 → 左列に費用＋利益、右列に収益
  // 損失 → 左列に費用、右列に収益＋損失
  const leftCol  = profit >= 0
    ? `${expBlock}${resultBlock}`
    : `${expBlock}`;
  const rightCol = profit >= 0
    ? `${revBlock}`
    : `${revBlock}${resultBlock}`;

  document.getElementById('pnl-container').innerHTML = `
    <div class="pnl-heading">損益計算書</div>
    <div class="pnl-columns">
      <div class="pnl-col">${leftCol}</div>
      <div class="pnl-col">${rightCol}</div>
    </div>`;
}

// ============================================================
// 記録レンダリング
// ============================================================
function renderRecords() {
  const container = document.getElementById('records-list');
  if (_bets.length === 0) {
    container.innerHTML = '<div class="empty-msg">まだ記録がありません。「＋ 追加」から始めましょう。</div>';
    return;
  }
  let html = `<div class="table-scroll"><table>
    <thead><tr>
      <th>日付</th><th>種別</th><th>試合 / ベット</th>
      <th>オッズ</th><th>賭け金</th><th>結果</th><th>損益</th><th></th>
    </tr></thead><tbody>`;

  for (const bet of _bets) {
    const pnl      = calcPnl(bet);
    const pnlClass = pnl === null ? '' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '';
    const isParlay = bet.type === 'parlay';
    const fbBadge  = bet.isFreebet ? ' <span class="badge-fb">FB</span>' : '';
    const typeCell = isParlay
      ? `<td><span class="badge-parlay">マルチ ${(bet.legs || []).length}連</span>${fbBadge}</td>`
      : `<td><span class="badge-single">シングル</span>${fbBadge}</td>`;

    const resultOpts = (cur) =>
      [['pending','⏳'],['win','✅ 勝'],['loss','❌ 負'],['void','➖ 無効']]
        .map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('');

    let detailCell;
    if (isParlay && bet.legs) {
      const legLines = bet.legs.map((l, i) => {
        const legLabel = l.league ? escapeHtml(l.league) : escapeHtml(l.sport || '');
        const legSel = `<select class="leg-result-select" data-id="${bet.id}" data-leg="${i}">${resultOpts(l.legResult)}</select>`;
        return `<small>${i + 1}: <span class="badge-league">${legLabel}</span> ${escapeHtml(l.match || '')} — ${escapeHtml(l.bet || '')} (x${l.odds}) ${legSel}</small>`;
      }).join('<br>');
      detailCell = `<td>${legLines}${bet.memo ? `<br><small class="memo">${escapeHtml(bet.memo)}</small>` : ''}</td>`;
    } else {
      const leagueBadge = bet.league ? `<span class="badge-league">${escapeHtml(bet.league)}</span> ` : '';
      detailCell = `<td>
        ${leagueBadge}<strong>${escapeHtml(bet.match || '')}</strong><br>
        <small>${escapeHtml(bet.bet || '')}</small>
        ${bet.memo ? `<br><small class="memo">${escapeHtml(bet.memo)}</small>` : ''}
      </td>`;
    }

    const oddsVal = isParlay ? calcEffectiveOdds(bet).toFixed(2) : bet.odds;
    html += `<tr>
      <td>${bet.date}</td>
      ${typeCell}
      ${detailCell}
      <td>${oddsVal}</td>
      <td>¥${Number(bet.stake).toLocaleString()}</td>
      <td><select class="result-select" data-id="${bet.id}">${resultOpts(bet.result)}</select></td>
      <td class="${pnlClass}">${formatPnl(pnl)}</td>
      <td>
        <button class="small-btn btn-edit"   data-id="${bet.id}">編集</button>
        <button class="small-btn btn-delete" data-id="${bet.id}">削除</button>
      </td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;

  container.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => openEditForm(btn.dataset.id))
  );
  container.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id))
  );
  container.querySelectorAll('.result-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const bet = _bets.find(b => String(b.id) === sel.dataset.id);
      if (!bet) return;
      await updateBet(sel.dataset.id, { ...bet, result: sel.value });
      refreshAll();
    });
  });
  container.querySelectorAll('.leg-result-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const bet = _bets.find(b => String(b.id) === sel.dataset.id);
      if (!bet || !bet.legs) return;
      const legIdx = parseInt(sel.dataset.leg, 10);
      const updatedLegs = bet.legs.map((l, i) => i === legIdx ? { ...l, legResult: sel.value } : l);
      await updateBet(sel.dataset.id, { ...bet, legs: updatedLegs });
      refreshAll();
    });
  });
}

// ============================================================
// フォーム操作
// ============================================================
function sportOptions(selected = 'Football') {
  return SPORTS.map(s => `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`).join('');
}

function leagueOptions(sport, selected = '') {
  return (getLeagues()[sport] || [])
    .map(l => `<option value="${l}" ${l === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function updateLeagueSelect(sport, selected = '') {
  const wrap = document.getElementById('league-select-wrap');
  const sel  = document.getElementById('single-league-select');
  if (!wrap || !sel) return;
  const list = getLeagues()[sport];
  if (list !== undefined) {
    sel.innerHTML = leagueOptions(sport, selected);
    wrap.hidden = false;
  } else {
    sel.innerHTML = '';
    wrap.hidden = true;
  }
}

function setFormType(type) {
  document.getElementById('single-fields').hidden = type === 'parlay';
  document.getElementById('parlay-fields').hidden = type === 'single';
}

function getLegsFromForm() {
  return [...document.querySelectorAll('.leg-item')].map(item => {
    const sport     = item.querySelector('[data-field="sport"]').value;
    const leagueSel = item.querySelector('[data-field="league"]');
    return {
      sport,
      league:    (getLeagues()[sport] && leagueSel?.value) ? leagueSel.value : null,
      match:     item.querySelector('[data-field="match"]')?.value || null,
      bet:       item.querySelector('[data-field="bet"]').value,
      odds:      parseFloat(item.querySelector('[data-field="odds"]').value),
      legResult: item.querySelector('[data-field="legResult"]').value,
    };
  });
}

function legResultOptions(selected = 'pending') {
  return [['pending','⏳ 未確定'],['win','✅ 勝ち'],['loss','❌ 負け'],['void','➖ 無効']]
    .map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function createLegHtml(idx, leg = {}) {
  const sport     = sportDisplay(leg.sport || 'Football');
  const hasLeague = !!(getLeagues()[sport]);
  const leagueEl  = hasLeague
    ? `<div class="form-group"><label>リーグ</label><select data-field="league">${leagueOptions(sport, leg.league || '')}</select></div>`
    : `<div class="form-group" style="visibility:hidden"><label>リーグ</label><select data-field="league"></select></div>`;
  return `<div class="leg-item" data-idx="${idx}">
    <div class="leg-header">
      <strong>レッグ ${idx + 1}</strong>
      <button type="button" class="small-btn btn-remove-leg">削除</button>
    </div>
    <div class="form-row">
      <div class="form-group"><label>スポーツ</label><select data-field="sport">${sportOptions(sport)}</select></div>
      <div class="form-group"><label>オッズ</label><input type="number" data-field="odds" class="leg-odds" step="0.01" min="1.01" placeholder="2.10" value="${leg.odds || ''}"></div>
    </div>
    <div class="form-row">
      ${leagueEl}
    </div>
    <div class="form-group"><label>ベット内容</label><input type="text" data-field="bet" placeholder="ホーム勝利など" value="${escapeHtml(leg.bet || '')}"></div>
    <div class="form-group"><label>このレッグの結果</label><select data-field="legResult">${legResultOptions(leg.legResult)}</select></div>
  </div>`;
}

function addLeg(leg = {}) {
  const container = document.getElementById('legs-container');
  const idx = container.querySelectorAll('.leg-item').length;
  container.insertAdjacentHTML('beforeend', createLegHtml(idx, leg));
  rebindLegs();
  updateCombinedOdds();
}

function rebindLegs() {
  document.querySelectorAll('.btn-remove-leg').forEach(btn => {
    btn.onclick = () => { btn.closest('.leg-item').remove(); renumberLegs(); updateCombinedOdds(); };
  });
  document.querySelectorAll('.leg-odds').forEach(input => { input.oninput = updateCombinedOdds; });
  document.querySelectorAll('.leg-item [data-field="sport"]').forEach(sportSel => {
    sportSel.onchange = () => {
      const item       = sportSel.closest('.leg-item');
      const leagueSel  = item.querySelector('[data-field="league"]');
      const leagueWrap = item.querySelectorAll('.form-row > .form-group')[0];
      if (getLeagues()[sportSel.value]) {
        leagueSel.innerHTML = leagueOptions(sportSel.value);
        leagueWrap.style.visibility = '';
      } else {
        leagueSel.innerHTML = '';
        leagueWrap.style.visibility = 'hidden';
      }
    };
  });
}

function renumberLegs() {
  document.querySelectorAll('.leg-item').forEach((item, i) => {
    item.dataset.idx = i;
    item.querySelector('strong').textContent = `レッグ ${i + 1}`;
  });
}

function updateCombinedOdds() {
  const inputs  = [...document.querySelectorAll('.leg-odds')];
  const disp    = document.getElementById('combined-odds-display');
  const bDisp   = document.getElementById('boosted-odds-display');
  if (inputs.length === 0) { disp.textContent = '-'; bDisp.textContent = '-'; return; }
  const allFilled = inputs.every(i => parseFloat(i.value) > 0);
  const product = inputs.reduce((acc, inp) => {
    const v = parseFloat(inp.value);
    return isNaN(v) ? acc : acc * v;
  }, 1);
  disp.textContent = allFilled ? product.toFixed(2) : '-';

  const boost = parseFloat(document.getElementById('input-combo-boost')?.value) || 1;
  bDisp.textContent = allFilled
    ? (boost > 1 ? (product * boost).toFixed(2) : product.toFixed(2))
    : '-';
}


function openAddForm() {
  const form = document.getElementById('bet-form');
  form.reset();
  form.elements.id.value   = '';
  form.elements.date.value = new Date().toISOString().slice(0, 10);
  document.getElementById('form-title').textContent  = '新規ベット';
  document.getElementById('legs-container').innerHTML = '';
  setFormType('single');
  updateLeagueSelect(form.elements.sport.value);
  populateCampaignSelect();
  document.getElementById('form-container').hidden = false;
}

function openEditForm(id) {
  const bet = _bets.find(b => b.id === id);
  if (!bet) return;
  const form = document.getElementById('bet-form');
  form.elements.id.value         = bet.id;
  form.elements.date.value        = bet.date;
  form.elements.stake.value       = bet.stake;
  form.elements.result.value = bet.result;
  form.elements.memo.value   = bet.memo || '';
  populateCampaignSelect(bet.campaignId || '');
  const fbCb = document.getElementById('input-is-freebet');
  if (fbCb) { fbCb.checked = bet.isFreebet || false; fbCb.dataset.userSet = '1'; }

  if (bet.type === 'parlay') {
    form.querySelector('input[name="type"][value="parlay"]').checked = true;
    setFormType('parlay');
    document.getElementById('legs-container').innerHTML = '';
    (bet.legs || []).forEach(leg => addLeg(leg));
    document.getElementById('input-combo-boost').value = bet.comboBoost ?? 0;
    updateCombinedOdds();
  } else {
    form.querySelector('input[name="type"][value="single"]').checked = true;
    setFormType('single');
    form.elements.sport.value = bet.sport || 'サッカー';
    updateLeagueSelect(bet.sport, bet.league || '');
    form.elements.bet.value  = bet.bet   || '';
    form.elements.odds.value = bet.odds  || '';
  }
  document.getElementById('form-title').textContent = '編集';
  document.getElementById('form-container').hidden  = false;
}

async function confirmDelete(id) {
  const bet = _bets.find(b => b.id === id);
  if (!bet) return;
  const label = bet.type === 'parlay'
    ? `マルチ ${(bet.legs || []).length}連 (${bet.date})`
    : `${bet.match || '?'} — ${bet.bet || '?'}`;
  if (!confirm(`「${label}」を削除しますか？`)) return;
  await deleteBet(id);
  refreshAll();
}

// ============================================================
// キャンペーン
// ============================================================
function getCampaignProgress(campaignId) {
  return _bets
    .filter(b => b.campaignId === campaignId)
    .reduce((sum, b) => sum + (b.stake || 0), 0);
}

function populateCampaignSelect(currentId = '') {
  const sel = document.getElementById('form-campaign-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">なし</option>' +
    _campaigns.map(c =>
      `<option value="${c.id}" ${c.id === currentId ? 'selected' : ''}>${escapeHtml(c.name)}${c.status === 'completed' ? ' ✅' : ''}</option>`
    ).join('');
  updateFreebetToggle();
}

function updateFreebetToggle() {
  const sel = document.getElementById('form-campaign-select');
  const cb  = document.getElementById('input-is-freebet');
  if (sel && cb && sel.value && !cb.dataset.userSet) cb.checked = true;
}

function renderCampaigns() {
  const list = document.getElementById('campaign-list');
  if (_campaigns.length === 0) {
    list.innerHTML = '<p style="opacity:0.6;font-size:12px;padding:8px 0;">キャンペーンがありません。下から追加してください。</p>';
    return;
  }
  list.innerHTML = _campaigns.map(c => {
    const progress = getCampaignProgress(c.id);
    const pct      = Math.min(100, Math.round(progress / c.wagerRequired * 100));
    const isDone   = c.status === 'completed';
    const color    = isDone ? '#27AE60' : pct >= 100 ? '#F39C12' : '#9B59B6';
    return `<div class="campaign-item ${isDone ? 'campaign-done' : ''}">
      <div class="campaign-header">
        <span class="campaign-name">${escapeHtml(c.name)}</span>
        <span class="campaign-reward">FB報酬: <strong>¥${Number(c.fbReward).toLocaleString()}</strong></span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="progress-label">¥${progress.toLocaleString()} / ¥${Number(c.wagerRequired).toLocaleString()} (${pct}%)</span>
      </div>
      ${isDone
        ? `<small class="campaign-completed-label">✅ 達成済み（${c.completedDate || ''}）</small>`
        : `<button class="small-btn btn-campaign-complete" data-id="${c.id}">達成マーク</button>`}
      <button class="small-btn btn-campaign-delete" data-id="${c.id}">削除</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.btn-campaign-complete').forEach(btn =>
    btn.addEventListener('click', () => completeCampaign(btn.dataset.id))
  );
  list.querySelectorAll('.btn-campaign-delete').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteCampaign(btn.dataset.id))
  );
}

async function completeCampaign(id) {
  const c = _campaigns.find(c => c.id === id);
  if (!c || !confirm(`「${c.name}」を達成済みにしますか？`)) return;
  await updateCampaign(id, { status: 'completed', completedDate: new Date().toISOString().slice(0, 10) });
  refreshAll();
}

async function confirmDeleteCampaign(id) {
  const c = _campaigns.find(c => c.id === id);
  if (!c || !confirm(`「${c.name}」を削除しますか？`)) return;
  await deleteCampaign(id);
  refreshAll();
}

// 的中率（シングル勝敗 + マルチ各レッグ単位）
function calcHitRate() {
  let hits = 0, total = 0;
  for (const bet of _bets) {
    if (bet.type === 'single') {
      if (bet.result === 'win' || bet.result === 'loss') {
        total++;
        if (bet.result === 'win') hits++;
      }
    } else if (bet.type === 'parlay' && Array.isArray(bet.legs)) {
      for (const leg of bet.legs) {
        if (leg.legResult === 'win' || leg.legResult === 'loss') {
          total++;
          if (leg.legResult === 'win') hits++;
        }
      }
    }
  }
  return total > 0 ? (hits / total * 100).toFixed(1) + '%' : '-%';
}

// 連勝・連敗を計算
function calcStreak() {
  const settled = _bets.filter(b => b.result === 'win' || b.result === 'loss');
  if (settled.length === 0) return { type: null, count: 0 };
  const type = settled[0].result;
  let count = 0;
  for (const bet of settled) {
    if (bet.result === type) count++;
    else break;
  }
  return { type, count };
}

// ============================================================
// サマリー更新
// ============================================================
function updateSummary() {
  const settled   = _bets.filter(b => b.result === 'win' || b.result === 'loss');
  const wins      = settled.filter(b => b.result === 'win');
  const totalPnl  = _bets.reduce((sum, b) => sum + (calcPnl(b) ?? 0), 0);
  const winRate   = settled.length > 0 ? (wins.length / settled.length * 100).toFixed(1) + '%' : '-%';

  document.getElementById('total-bets').textContent = _bets.length;
  document.getElementById('win-rate').textContent   = winRate;
  document.getElementById('hit-rate').textContent   = calcHitRate();

  // 残高（元手が設定されていれば元手+損益、なければ損益だけ表示）
  const balanceEl = document.getElementById('balance');
  if (_settings.bankroll) {
    const balance = _settings.bankroll + totalPnl;
    balanceEl.textContent = '¥' + balance.toLocaleString();
    balanceEl.className   = 's-val ' + (totalPnl > 0 ? 'win' : totalPnl < 0 ? 'loss' : '');
  } else {
    balanceEl.textContent = (totalPnl >= 0 ? '+' : '') + '¥' + totalPnl.toLocaleString();
    balanceEl.className   = 's-val ' + (totalPnl > 0 ? 'win' : totalPnl < 0 ? 'loss' : '');
  }

  // 連勝・連敗
  const streak   = calcStreak();
  const streakEl = document.getElementById('streak');
  if (streak.count === 0) {
    streakEl.textContent = '-';
    streakEl.className   = 's-val';
  } else if (streak.type === 'win') {
    streakEl.textContent = `${streak.count}連勝🔥`;
    streakEl.className   = 's-val win';
  } else {
    streakEl.textContent = `${streak.count}連敗`;
    streakEl.className   = 's-val loss';
  }
}

// ============================================================
// 期間別損益
// ============================================================
let _periodDayOfs   = 0;
let _periodWeekOfs  = 0;
let _periodMonthOfs = 0;

function renderPeriodStats() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  // 今日 ± offset
  const dayDate = new Date(now);
  dayDate.setDate(dayDate.getDate() + _periodDayOfs);
  const dayStr   = dateStr(dayDate);
  const dayLabel = _periodDayOfs === 0 ? '今日' : `${dayDate.getMonth()+1}/${dayDate.getDate()}`;

  // 今週の月曜〜日曜 ± offset週
  const wOffset = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const monday  = new Date(now);
  monday.setDate(monday.getDate() + wOffset + _periodWeekOfs * 7);
  const sunday  = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = dateStr(monday);
  const weekEnd   = dateStr(sunday);
  const weekLabel = _periodWeekOfs === 0 ? '今週'
    : `${monday.getMonth()+1}/${monday.getDate()}〜${sunday.getMonth()+1}/${sunday.getDate()}`;

  // 今月 ± offset月
  const mBase     = new Date(now.getFullYear(), now.getMonth() + _periodMonthOfs, 1);
  const mLast     = new Date(mBase.getFullYear(), mBase.getMonth() + 1, 0);
  const monthStart = dateStr(mBase);
  const monthEnd   = dateStr(mLast);
  const monthLabel = _periodMonthOfs === 0 ? '今月' : `${mBase.getFullYear()}/${mBase.getMonth()+1}月`;

  const calcPeriod = (start, end) =>
    _bets.filter(b => b.date >= start && b.date <= end)
         .reduce((sum, b) => sum + (calcPnl(b) ?? 0), 0);

  const fmt = pnl => (pnl >= 0 ? '+' : '') + '¥' + pnl.toLocaleString();
  const cls = pnl => pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '';

  const dayPnl   = calcPeriod(dayStr, dayStr);
  const weekPnl  = calcPeriod(weekStart, weekEnd);
  const monthPnl = calcPeriod(monthStart, monthEnd);

  const item = (label, pnl, type, ofs) => `
    <div class="period-item">
      <button class="period-nav" data-type="${type}" data-dir="-1">‹</button>
      <div class="period-center">
        <div class="period-label">${label}</div>
        <div class="period-val ${cls(pnl)}">${fmt(pnl)}</div>
      </div>
      <button class="period-nav ${ofs >= 0 ? 'period-nav-disabled' : ''}" data-type="${type}" data-dir="1" ${ofs >= 0 ? 'disabled' : ''}>›</button>
    </div>`;

  document.getElementById('period-stats').innerHTML =
    item(dayLabel,   dayPnl,   'day',   _periodDayOfs)  +
    item(weekLabel,  weekPnl,  'week',  _periodWeekOfs) +
    item(monthLabel, monthPnl, 'month', _periodMonthOfs);

  document.querySelectorAll('#period-stats .period-nav').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = parseInt(btn.dataset.dir);
      if (btn.dataset.type === 'day')   _periodDayOfs   = Math.min(0, _periodDayOfs   + dir);
      if (btn.dataset.type === 'week')  _periodWeekOfs  = Math.min(0, _periodWeekOfs  + dir);
      if (btn.dataset.type === 'month') _periodMonthOfs = Math.min(0, _periodMonthOfs + dir);
      renderPeriodStats();
    });
  });
}

// ============================================================
// 目標進捗（複数対応）
// ============================================================
function renderGoalProgress() {
  const goals = _goals;
  const container = document.getElementById('goals-list');
  if (!container) return;

  if (goals.length === 0) {
    container.innerHTML = '<p class="goals-empty">目標がありません。「＋ 目標を追加」から設定してください。</p>';
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);

  container.innerHTML = goals.map(g => {
    const pnl = _bets
      .filter(b => b.date >= g.goalStart && b.date <= g.goalEnd)
      .reduce((sum, b) => sum + (calcPnl(b) ?? 0), 0);

    const pct   = Math.min(100, Math.max(0, Math.round(pnl / g.goalAmount * 100)));
    const color = pct >= 100 ? '#27AE60' : pct >= 50 ? '#F39C12' : '#9B59B6';
    const done  = pct >= 100 ? ' 🎉 達成！' : '';

    const startD = new Date(g.goalStart); startD.setHours(0,0,0,0);
    const endD   = new Date(g.goalEnd);   endD.setHours(0,0,0,0);
    const totalDays = Math.max(1, (endD - startD) / 86400000);
    const elapsed   = Math.max(0, Math.min(totalDays, (today - startD) / 86400000));
    const datePct   = Math.round(elapsed / totalDays * 100);
    const daysLeft  = Math.max(0, Math.ceil((endD - today) / 86400000));
    const dateLabel = datePct >= 100 ? '期間終了' : `残${daysLeft}日`;

    return `<div class="goal-card">
      <div class="goal-header">
        <span class="goal-name">${escapeHtml(g.name)}</span>
        <button class="small-btn btn-goal-delete" data-id="${g.id}">削除</button>
      </div>
      <div class="goal-meta">
        <span>${g.goalStart} 〜 ${g.goalEnd}</span>
        <span class="${pnl >= 0 ? 'win' : 'loss'}">${(pnl >= 0 ? '+' : '') + '¥' + pnl.toLocaleString()} / ¥${Number(g.goalAmount).toLocaleString()}</span>
      </div>
      <div class="goal-bar-row">
        <span class="goal-bar-label">損益</span>
        <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="goal-bar-pct">${pct}%${done}</span>
      </div>
      <div class="goal-bar-row">
        <span class="goal-bar-label">日付</span>
        <div class="goal-track"><div class="goal-fill goal-fill-date" style="width:${datePct}%"></div></div>
        <span class="goal-bar-pct goal-date-label">${dateLabel}</span>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.btn-goal-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('この目標を削除しますか？')) return;
      await deleteGoal(btn.dataset.id);
      renderGoalProgress();
    });
  });
}

// ============================================================
// チャート・統計
// ============================================================
let pnlChart = null, sportChart = null, balanceChart = null;
let _statsGroupBy  = 'sport'; // 'league' | 'sport'
let _pnlViewBy     = 'bet';   // 'bet' | 'day'
let _balanceViewBy = 'bet';   // 'bet' | 'day'

function getStatKey(sport, league) {
  if (_statsGroupBy === 'sport') return sportDisplay(sport || 'Other');
  return league || sportDisplay(sport) || 'Other';
}

function renderCharts() {
  const settled = _bets.filter(b => b.result !== 'pending').slice().reverse();
  renderPnlChart(settled);
  renderBalanceChart(settled);
  renderSportChart();
  renderStatsTable();
}

function renderBalanceChart(settledBets) {
  const totalDeposited = _deposits.reduce((s, d) => s + d.amount, 0);
  const initialBankroll = (_settings.bankroll || 0) - totalDeposited;

  const labels = [], data = [], pointColors = [], pointRadii = [], tooltipDeposits = [];
  let balance = initialBankroll;

  if (_balanceViewBy === 'bet') {
    // ベット別: ベットと入金を日付順にマージして1点ずつプロット
    const events = [];
    for (const bet of settledBets) {
      const pnl = calcPnl(bet);
      if (pnl === null) continue;
      events.push({ date: bet.date, pnl, deposit: 0 });
    }
    for (const dep of _deposits) {
      events.push({ date: dep.deposit_date, pnl: 0, deposit: dep.amount });
    }
    // 同日は入金→ベットの順、次に created_at 順（ここでは index順で近似）
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return b.deposit - a.deposit; // 入金を先に
    });
    for (const ev of events) {
      balance += ev.deposit + ev.pnl;
      labels.push(ev.date);
      data.push(balance);
      pointColors.push(ev.deposit > 0 ? '#F59E0B' : '#3498DB');
      pointRadii.push(ev.deposit > 0 ? 6 : 3);
      tooltipDeposits.push(ev.deposit);
    }
  } else {
    // 日別: 同じ日のベット損益・入金をまとめて1点
    const dayMap = {};
    for (const bet of settledBets) {
      const pnl = calcPnl(bet);
      if (pnl === null) continue;
      if (!dayMap[bet.date]) dayMap[bet.date] = { pnl: 0, deposit: 0 };
      dayMap[bet.date].pnl += pnl;
    }
    for (const dep of _deposits) {
      if (!dayMap[dep.deposit_date]) dayMap[dep.deposit_date] = { pnl: 0, deposit: 0 };
      dayMap[dep.deposit_date].deposit += dep.amount;
    }
    for (const d of Object.keys(dayMap).sort()) {
      const ev = dayMap[d];
      balance += ev.deposit + ev.pnl;
      labels.push(d);
      data.push(balance);
      pointColors.push(ev.deposit > 0 ? '#F59E0B' : '#3498DB');
      pointRadii.push(ev.deposit > 0 ? 6 : 3);
      tooltipDeposits.push(ev.deposit);
    }
  }

  const ctx = document.getElementById('chart-balance').getContext('2d');
  if (balanceChart) balanceChart.destroy();
  balanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '残高',
        data,
        borderColor: '#3498DB',
        backgroundColor: 'rgba(52,152,219,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: pointRadii,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (item) => {
              const dep = tooltipDeposits[item.dataIndex];
              return dep > 0 ? `入金: +¥${dep.toLocaleString()}` : '';
            },
          },
        },
      },
      scales: { y: { beginAtZero: false } },
    },
  });
}

function renderPnlChart(settledBets) {
  const labels = [], data = [];
  let cum = 0;

  if (_pnlViewBy === 'day') {
    const dayMap = {};
    for (const bet of settledBets) {
      const pnl = calcPnl(bet);
      if (pnl === null) continue;
      cum += pnl;
      dayMap[bet.date] = cum;
    }
    for (const d of Object.keys(dayMap).sort()) { labels.push(d); data.push(dayMap[d]); }
  } else {
    for (const bet of settledBets) {
      const pnl = calcPnl(bet);
      if (pnl === null) continue;
      cum += pnl;
      labels.push(bet.date);
      data.push(cum);
    }
  }
  const lastVal = data[data.length - 1] ?? 0;
  const color   = lastVal >= 0 ? '#27AE60' : '#E74C3C';
  const bg      = lastVal >= 0 ? 'rgba(39,174,96,0.1)' : 'rgba(231,76,60,0.1)';
  const ctx     = document.getElementById('chart-pnl').getContext('2d');
  if (pnlChart) pnlChart.destroy();
  pnlChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: '累計損益', data, borderColor: color, backgroundColor: bg, fill: true, tension: 0.3, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } },
  });
}

function renderSportChart() {
  const sportMap = {};
  const count = (key, result) => {
    if (result !== 'win' && result !== 'loss') return;
    if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0 };
    sportMap[key][result]++;
  };
  for (const bet of _bets) {
    if (bet.type === 'parlay' && Array.isArray(bet.legs)) {
      for (const leg of bet.legs) count(getStatKey(leg.sport, leg.league), leg.legResult);
    } else {
      count(getStatKey(bet.sport, bet.league), bet.result);
    }
  }
  document.getElementById('chart-sport-title').textContent = '勝敗数';
  const sports = Object.keys(sportMap);
  const ctx    = document.getElementById('chart-sport').getContext('2d');
  if (sportChart) sportChart.destroy();
  sportChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sports,
      datasets: [
        { label: '勝', data: sports.map(s => sportMap[s].win),  backgroundColor: 'rgba(39,174,96,0.8)' },
        { label: '負', data: sports.map(s => sportMap[s].loss), backgroundColor: 'rgba(231,76,60,0.8)' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
}

function renderStatsTable() {
  const sportMap = {};
  for (const bet of _bets) {
    if (bet.type === 'parlay' && Array.isArray(bet.legs)) {
      for (const leg of bet.legs) {
        const key = getStatKey(leg.sport, leg.league);
        if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
        sportMap[key][leg.legResult || 'pending']++;
      }
      const mainKey = bet.legs[0] ? getStatKey(bet.legs[0].sport, bet.legs[0].league) : 'その他';
      if (!sportMap[mainKey]) sportMap[mainKey] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
      const pnl = calcPnl(bet);
      if (pnl !== null) { sportMap[mainKey].pnl += pnl; sportMap[mainKey].stake += bet.stake; }
    } else {
      const key = getStatKey(bet.sport, bet.league);
      if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
      const s = sportMap[key];
      s[bet.result]++;
      const pnl = calcPnl(bet);
      if (pnl !== null) { s.pnl += pnl; s.stake += bet.stake; }
    }
  }
  document.getElementById('stats-table-title').textContent =
    (_statsGroupBy === 'sport' ? 'スポーツ別' : 'リーグ別') + ' 内訳';
  const sports = Object.keys(sportMap);
  if (sports.length === 0) {
    document.getElementById('stats-table').innerHTML = '<div class="empty-msg">データがありません</div>';
    return;
  }
  let html = `<div class="table-scroll"><table>
    <thead><tr><th>スポーツ</th><th>勝</th><th>負</th><th>無効</th><th>勝率</th><th>損益</th><th>ROI</th></tr></thead><tbody>`;
  for (const sport of sports) {
    const s    = sportMap[sport];
    const tot  = s.win + s.loss;
    const wr   = tot   > 0 ? (s.win / tot * 100).toFixed(1) + '%' : '-';
    const roi  = s.stake > 0 ? (s.pnl / s.stake * 100).toFixed(1) + '%' : '-';
    const pStr = (s.pnl >= 0 ? '+' : '') + '¥' + s.pnl.toLocaleString();
    html += `<tr>
      <td>${escapeHtml(sport)}</td>
      <td>${s.win}</td><td>${s.loss}</td><td>${s.void}</td>
      <td>${wr}</td>
      <td class="${s.pnl >= 0 ? 'win' : 'loss'}">${pStr}</td>
      <td class="${parseFloat(roi) >= 0 ? 'win' : 'loss'}">${roi}</td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  document.getElementById('stats-table').innerHTML = html;
}

// ============================================================
// 計算機
// ============================================================
// ============================================================
// 試合予定タブ（ESPN + MLB Stats API + TheSportsDB）
// ============================================================
const SCHEDULE_SPORTS = [
  { key: 'Soccer',      icon: '⚽', label: 'Football'   },
  { key: 'Baseball',    icon: '⚾', label: 'Baseball'   },
  { key: 'Basketball',  icon: '🏀', label: 'Basketball' },
  { key: 'Tennis',      icon: '🎾', label: 'Tennis'     },
  { key: 'TableTennis', icon: '🏓', label: 'Table Tennis' },
  { key: 'Rugby',       icon: '🏉', label: 'Rugby'      },
  { key: 'Volleyball',  icon: '🏐', label: 'Volleyball' },
];

// ---- サッカーリーグ定義（ESPN）----
const ESPN_SOCCER_LEAGUES = [
  // リーグ戦
  { id: 'eng.1',            label: 'Premier League'     },
  { id: 'esp.1',            label: 'La Liga'            },
  { id: 'ger.1',            label: 'Bundesliga'         },
  { id: 'ita.1',            label: 'Serie A'            },
  { id: 'fra.1',            label: 'Ligue 1'            },
  { id: 'ned.1',            label: 'Eredivisie'         },
  { id: 'por.1',            label: 'Primeira Liga'      },
  { id: 'jpn.1',            label: 'J1 League'          },
  { id: 'usa.1',            label: 'MLS'                },
  { id: 'sau.1',            label: 'Saudi Pro League'   },
  // 欧州カップ戦
  { id: 'uefa.champions',   label: 'Champions League'   },
  { id: 'uefa.europa',      label: 'Europa League'      },
  { id: 'uefa.ecl',         label: 'Conference League'  },
  // 五大リーグ国内カップ
  { id: 'eng.fa',           label: 'FA Cup'             },
  { id: 'eng.league_cup',   label: 'EFL Cup'            },
  { id: 'esp.copa_del_rey', label: 'Copa del Rey'       },
  { id: 'ger.dfb_pokal',    label: 'DFB Pokal'          },
  { id: 'ita.coppa_italia', label: 'Coppa Italia'       },
  { id: 'fra.coupe_de_france', label: 'Coupe de France' },
  // 国際大会
  { id: 'fifa.world',            label: 'World Cup'          },
  { id: 'fifa.worldq.afc',       label: 'WC Qual (AFC)'      },
  { id: 'fifa.worldq.uefa',      label: 'WC Qual (UEFA)'     },
  { id: 'fifa.worldq.conmebol',  label: 'WC Qual (CONMEBOL)' },
  { id: 'fifa.worldq.concacaf',  label: 'WC Qual (CONCACAF)' },
  { id: 'fifa.friendly.m',       label: "Int'l Friendly"     },
  { id: 'uefa.nations',          label: 'Nations League'     },
  { id: 'concacaf.nations.l',    label: 'CONCACAF Nations'   },
];

let scheduleDate   = new Date();
let scheduleFilter = 'all';
let leagueFilter   = new Set(); // 空 = すべて表示
let scheduleCache  = {};
let scheduledEvs   = [];

function schedDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function schedDateLabel(d) {
  const DAYS = ['日','月','火','水','木','金','土'];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${DAYS[d.getDay()]}）`;
}
function utcToJSTDisplay(utcStr) {
  if (!utcStr) return null;
  try {
    return new Date(utcStr).toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return null; }
}

// UTC文字列をJST日付文字列(YYYY-MM-DD)に変換
function utcToJSTDateStr(utcStr) {
  const jst = new Date(new Date(utcStr).getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth()+1).padStart(2,'0')}-${String(jst.getUTCDate()).padStart(2,'0')}`;
}

// UTC文字列 → JST offset付きISO（Google Calendar API用）
function toJSTIso(utcStr) {
  const dt  = new Date(utcStr);
  const jst = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth()+1)}-${pad(jst.getUTCDate())}` +
         `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;
}

// 「Sports」カレンダーを検索してIDを取得
async function findSportsCalendar() {
  if (!gcalTokenBet) return;
  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${gcalTokenBet}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const cal  = (data.items || []).find(c => /sports|スポーツ/i.test(c.summary));
    if (cal) {
      bettingCalendarId = cal.id;
      console.log('Sportsカレンダー発見:', cal.summary, '→', cal.id);
    } else {
      console.log('Sportsカレンダーが見つからないためprimaryを使用');
    }
  } catch (e) { console.error('findSportsCalendar:', e); }
}

// ---- ESPN汎用フェッチ ----
function parseESPNEvents(data, dateStr) {
  return (data.events || []).map(ev => {
    const comp  = ev.competitions?.[0];
    const home  = comp?.competitors?.find(c => c.homeAway === 'home');
    const away  = comp?.competitors?.find(c => c.homeAway === 'away');
    const title = (home && away)
      ? `${away.team.displayName} vs ${home.team.displayName}`
      : (ev.name || ev.shortName || '');
    return { title, startUtc: ev.date || null, dateStr };
  });
}

async function fetchESPN(sport, leagueId, dateStr) {
  try {
    const d    = dateStr.replace(/-/g, '');
    const base = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueId}`;
    // scoreboard を試し、4xx なら events にフォールバック（決勝など）
    const res = await fetch(`${base}/scoreboard?dates=${d}`);
    if (res.ok) return parseESPNEvents(await res.json(), dateStr);
    const res2 = await fetch(`${base}/events?dates=${d}`);
    if (!res2.ok) return [];
    return parseESPNEvents(await res2.json(), dateStr);
  } catch { return []; }
}

// ---- TheSportsDB汎用フェッチ ----
async function fetchTSDB(sport, dateStr) {
  try {
    const res = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${dateStr}&s=${encodeURIComponent(sport)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map(ev => ({
      title:    ev.strEvent || `${ev.strHomeTeam || ''} vs ${ev.strAwayTeam || ''}`,
      league:   ev.strLeague || '',
      startUtc: (ev.strTime && ev.strTime !== '00:00:00') ? `${ev.dateEvent}T${ev.strTime}Z` : null,
      dateStr,
    }));
  } catch { return []; }
}

// UEFA cup competitions: ノックアウト段階は seasontype=3 を追加で試す
const UEFA_CUPS = new Set(['uefa.champions', 'uefa.europa', 'uefa.ecl']);

// ---- ⚽ サッカー（ESPN + Netlify function 常時併用）----
async function fetchSoccer(dateStr) {
  const [espnResults, netlifyEvs] = await Promise.all([
    // ESPN: 各リーグを並列取得
    Promise.all(
      ESPN_SOCCER_LEAGUES.map(async ({ id, label }) => {
        let evs = await fetchESPN('soccer', id, dateStr);
        if (evs.length === 0 && UEFA_CUPS.has(id)) {
          try {
            const d = dateStr.replace(/-/g, '');
            const r = await fetch(
              `https://site.api.espn.com/apis/site/v2/sports/soccer/${id}/scoreboard?dates=${d}&seasontype=3`
            );
            if (r.ok) evs = parseESPNEvents(await r.json(), dateStr);
          } catch {}
        }
        return evs.map(ev => ({ ...ev, league: label, sportKey: 'Soccer' }));
      })
    ).then(r => r.flat()),
    // Netlify function: FotMob XML → UEFA → TSDB を常時取得
    fetch(`/.netlify/functions/soccer-schedule?date=${dateStr}`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(d => (d.events || []).map(ev => ({ ...ev, sportKey: 'Soccer' })))
      .catch(() => []),
  ]);

  // 重複除去: タイトルが同じものはESPNを優先
  const espnTitles = new Set(espnResults.map(e => e.title?.toLowerCase()));
  const uniqueNetlify = netlifyEvs.filter(e => !espnTitles.has(e.title?.toLowerCase()));
  return [...espnResults, ...uniqueNetlify];
}

// ---- ⚾ MLB（公式API）----
async function fetchMLB(dateStr) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=team`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.dates?.[0]?.games || []).map(g => ({
      title:    `${g.teams.away.team.name} vs ${g.teams.home.team.name}`,
      league:   'MLB',
      startUtc: g.gameDate || null,
      dateStr,
      sportKey: 'Baseball',
    }));
  } catch { return []; }
}

// ---- ⚾ NPB（npb.jp スクレイピング via CORSプロキシ）----
const npbHtmlCache = {}; // 月単位でHTMLをキャッシュ

async function fetchNPB(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const mm       = month.padStart(2, '0');
  const cacheKey = `${year}-${mm}`;

  let html = npbHtmlCache[cacheKey];
  if (!html) {
    try {
      const res = await fetch(
        `/.netlify/functions/npb?year=${year}&month=${mm}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return [];
      html = await res.text();
      if (html) npbHtmlCache[cacheKey] = html;
    } catch (e) { console.warn('[NPB] fetch error:', e.message); return []; }
  }
  if (!html) return [];

  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const rows = doc.querySelectorAll('table tr');


  // dateStr "2026-05-22" → targetDate "5/22"（npb.jpの日付表記に合わせる）
  const targetDate = `${parseInt(month)}/${parseInt(day)}`;

  const events = [];
  let currentDate = null;

  for (const row of rows) {
    // th と td 両方を対象にする
    const allCells = row.querySelectorAll('th, td');
    if (allCells.length === 0) continue;

    // 先頭セルが日付パターン(M/D)なら currentDate を更新
    const firstText = allCells[0].textContent
      .replace(/（[^）]*）|\([^)]*\)/g, '')
      .replace(/／/g, '/')
      .trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(firstText)) {
      currentDate = firstText;
    }

    if (currentDate !== targetDate) continue;

    // tds[0]=チーム名、tds[1]=球場・時刻（th有無に関わらず一定）
    const tds = row.querySelectorAll('td');
    if (tds.length < 1) continue;

    // チーム名抽出（&nbsp; を空白に正規化してから "-" で分割）
    const teamRaw = tds[0].textContent.replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
    const teamParts = teamRaw.split(/\s*[－-]\s*/);
    const away = teamParts[0]?.trim();
    const home = teamParts[1]?.trim();
    // チーム名に数字が入る = 試合結果（スコア表示）なのでスキップ
    if (!away || !home || /\d/.test(away) || /\d/.test(home)) continue;

    // 時刻抽出（tds[1]のテキストから HH:MM を探す）
    let startUtc = null;
    if (tds.length > 1) {
      const timeMatch = tds[1].textContent.match(/(\d{1,2}:\d{2})/);
      if (timeMatch) {
        const [h, mi] = timeMatch[1].split(':').map(Number);
        startUtc = new Date(
          `${dateStr}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00+09:00`
        ).toISOString();
      }
    }

    events.push({ title: `${away} vs ${home}`, league: 'NPB', startUtc, dateStr, sportKey: 'Baseball' });
  }

  return events;
}

async function fetchBaseball(dateStr) {
  const [mlbEvs, npbEvs] = await Promise.all([fetchMLB(dateStr), fetchNPB(dateStr)]);
  return [...mlbEvs, ...npbEvs];
}

// ---- 🏀 バスケ（ESPN: NBA + Bリーグ）----
async function fetchBLeagueData(dateStr) {
  // Netlify Function 経由で SofaScore から取得
  try {
    const res = await fetch(`/.netlify/functions/bleague?date=${dateStr}`);
    if (res.ok) {
      const data = await res.json();
      if (data.events && data.events.length > 0)
        return data.events.map(ev => ({ ...ev, sportKey: 'Basketball' }));
    }
  } catch { /* ignore */ }

  // ESPN フォールバック（複数IDを試す）
  for (const id of ['b-league', 'jpn.b-league', 'b.league']) {
    const evs = await fetchESPN('basketball', id, dateStr);
    if (evs.length > 0) return evs.map(ev => ({ ...ev, league: 'B.League', sportKey: 'Basketball' }));
  }
  return [];
}

async function fetchBasketball(dateStr) {
  const [nba, bLeague] = await Promise.all([
    fetchESPN('basketball', 'nba', dateStr)
      .then(evs => evs.map(ev => ({ ...ev, league: 'NBA', sportKey: 'Basketball' })))
      .catch(() => []),
    fetchBLeagueData(dateStr).catch(() => []),
  ]);
  return [...nba, ...bLeague];
}

// ---- 🎾 テニス（ESPN /events → フォールバック TheSportsDB）----
// /scoreboard は Grand Slam を1件のトーナメント扱いするため /events を使う
// /events は選手名が ev.competitors に直接入っており個別試合を返す
async function fetchESPNTennisEvents(leagueId, dateStr) {
  try {
    const d = dateStr.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${leagueId}/events?dates=${d}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map(ev => {
      const competitors = ev.competitors || ev.competitions?.[0]?.competitors || [];
      const getName = c => c?.displayName || c?.athlete?.displayName || c?.team?.displayName || '';
      const names = competitors.map(getName).filter(Boolean);
      const title = names.length >= 2 ? `${names[0]} vs ${names[1]}` : (ev.name || ev.shortName || '');
      const tournament = ev.name || null;
      return { title, startUtc: ev.date || null, dateStr, tournament };
    });
  } catch { return []; }
}

const TENNIS_ESPN = [
  { id: 'atp', label: 'ATP' },
  { id: 'wta', label: 'WTA' },
];

async function fetchTennis(dateStr) {
  const results = await Promise.all(
    TENNIS_ESPN.map(async ({ id, label }) => {
      const evs = await fetchESPNTennisEvents(id, dateStr);
      return evs.map(ev => ({ ...ev, league: ev.tournament ? `${ev.tournament} (${label})` : label, sportKey: 'Tennis' }));
    })
  );
  const flat = results.flat();
  if (flat.length > 0) return flat;
  const tsdb = await fetchTSDB('Tennis', dateStr);
  return tsdb.map(ev => ({ ...ev, sportKey: 'Tennis' }));
}

// ---- 🏓 卓球（TheSportsDB）----
async function fetchTableTennis(dateStr) {
  const evs = await fetchTSDB('Table_Tennis', dateStr);
  return evs.map(ev => ({ ...ev, sportKey: 'TableTennis' }));
}

// ---- 🏉 ラグビー（TheSportsDB）----
async function fetchRugby(dateStr) {
  const evs = await fetchTSDB('Rugby', dateStr);
  return evs.map(ev => ({ ...ev, sportKey: 'Rugby' }));
}

// ---- 🏐 バレー（TheSportsDB）----
async function fetchVolleyball(dateStr) {
  const evs = await fetchTSDB('Volleyball', dateStr);
  return evs.map(ev => ({ ...ev, sportKey: 'Volleyball' }));
}

const SPORT_FETCHERS = {
  Soccer:      fetchSoccer,
  Baseball:    fetchBaseball,
  Basketball:  fetchBasketball,
  Tennis:      fetchTennis,
  TableTennis: fetchTableTennis,
  Rugby:       fetchRugby,
  Volleyball:  fetchVolleyball,
};

async function loadSportsSchedule() {
  const dateStr   = schedDateStr(scheduleDate);
  const container = document.getElementById('schedule-events');
  if (!container) return;

  document.getElementById('sched-date-label').textContent = schedDateLabel(scheduleDate);

  if (scheduleCache[dateStr]) {
    scheduledEvs = scheduleCache[dateStr];
    leagueFilter.clear();
    renderLeagueFilters();
    renderSportsEvents();
    return;
  }

  container.innerHTML = '<div class="schedule-loading">読み込み中...</div>';

  // JSTの1日はUTC前日15:00〜当日15:00のため、前日UTC分も取得してJSTでフィルタ
  const prevDate    = new Date(scheduleDate.getTime() - 24 * 60 * 60 * 1000);
  const prevDateStr = schedDateStr(prevDate);

  const fetchAll = (d) => Promise.all(
    SCHEDULE_SPORTS.map(s => SPORT_FETCHERS[s.key](d).catch(() => []))
  ).then(r => r.flat());

  const [currentEvs, prevEvs] = await Promise.all([fetchAll(dateStr), fetchAll(prevDateStr)]);

  // startUtcがある→JSTで dateStr に一致するものだけ / ない→fetchした日が dateStr のものだけ
  const seen = new Set();
  scheduledEvs = [...currentEvs, ...prevEvs].filter(ev => {
    if (!(ev.startUtc ? utcToJSTDateStr(ev.startUtc) === dateStr : ev.dateStr === dateStr)) return false;
    const key = `${ev.sportKey}|${ev.title}|${ev.startUtc || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  scheduleCache[dateStr] = scheduledEvs;
  leagueFilter.clear();
  renderLeagueFilters();
  renderSportsEvents();
  if (gcalTokenBet) syncGcalState(dateStr);
}

async function syncGcalState(dateStr) {
  try {
    const calId   = encodeURIComponent(bettingCalendarId);
    const timeMin = encodeURIComponent(`${dateStr}T00:00:00+09:00`);
    const timeMax = encodeURIComponent(`${dateStr}T23:59:59+09:00`);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&maxResults=100`,
      { headers: { Authorization: `Bearer ${gcalTokenBet}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const gcEvents = data.items || [];

    for (const ev of scheduledEvs) {
      const match = gcEvents.find(g => g.summary === ev.title);
      if (match) gcalStoreSave(ev.title, ev.dateStr || '', ev.startUtc || '', match.id);
    }
    renderSportsEvents();
  } catch { /* ignore */ }
}

function renderLeagueFilters() {
  const container = document.getElementById('league-filters');
  if (!container) return;

  const base = scheduleFilter === 'all'
    ? scheduledEvs
    : scheduledEvs.filter(ev => ev.sportKey === scheduleFilter);

  const leagues = [...new Set(base.map(ev => ev.league).filter(Boolean))].sort();
  if (leagues.length <= 1) { container.innerHTML = ''; leagueFilter.clear(); return; }

  const allActive = leagueFilter.size === 0 ? ' active' : '';
  container.innerHTML = `<button class="league-filter-btn${allActive}" data-league="all">All</button>` +
    leagues.map(l => {
      const active = leagueFilter.has(l) ? ' active' : '';
      return `<button class="league-filter-btn${active}" data-league="${escapeHtml(l)}">${escapeHtml(l)}</button>`;
    }).join('');

  container.querySelectorAll('.league-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.league === 'all') {
        leagueFilter.clear();
      } else {
        leagueFilter.has(btn.dataset.league)
          ? leagueFilter.delete(btn.dataset.league)
          : leagueFilter.add(btn.dataset.league);
      }
      // すべてボタンのactive更新
      container.querySelector('[data-league="all"]').classList.toggle('active', leagueFilter.size === 0);
      container.querySelectorAll('[data-league]:not([data-league="all"])').forEach(b => {
        b.classList.toggle('active', leagueFilter.has(b.dataset.league));
      });
      renderSportsEvents();
    });
  });
}

function renderSportsEvents() {
  const container = document.getElementById('schedule-events');
  if (!container) return;

  let evs = scheduleFilter === 'all'
    ? scheduledEvs
    : scheduledEvs.filter(ev => ev.sportKey === scheduleFilter);

  if (leagueFilter.size > 0) evs = evs.filter(ev => leagueFilter.has(ev.league));

  if (evs.length === 0) {
    container.innerHTML = '<div class="schedule-empty">この日の試合情報はありません</div>';
    return;
  }

  const groups = {};
  for (const ev of evs) {
    if (!groups[ev.sportKey]) groups[ev.sportKey] = [];
    groups[ev.sportKey].push(ev);
  }

  let html = '';
  for (const { key } of SCHEDULE_SPORTS.filter(s => groups[s.key])) {
    const info   = SCHEDULE_SPORTS.find(s => s.key === key);
    const sorted = groups[key].sort((a, b) => {
      if (!a.startUtc && !b.startUtc) return 0;
      if (!a.startUtc) return 1;
      if (!b.startUtc) return -1;
      return a.startUtc.localeCompare(b.startUtc);
    });
    html += `<div class="sport-section">
      <div class="sport-section-title">${info.icon} ${info.label}</div>`;
    for (const ev of sorted) {
      const timeJST    = utcToJSTDisplay(ev.startUtc);
      const timeDisp   = timeJST ? `🕐 ${timeJST} (JST)` : '🕐 時刻未定';
      const savedId    = gcalGetEventId(ev.title, ev.dateStr || '', ev.startUtc || '');
      const btnText    = savedId ? '🗑 削除' : '📅＋';
      const btnStyle   = savedId ? ' style="background:#fde8e8;border-color:#f5b8b8;color:var(--loss)"' : '';
      const btnEventId = savedId ? ` data-event-id="${savedId}"` : '';
      html += `<div class="match-card">
        <div class="match-info">
          <div class="match-teams">${escapeHtml(ev.title)}</div>
          <div class="match-meta">
            ${ev.league ? `<span class="match-league">${escapeHtml(ev.league)}</span>` : ''}
            <span class="match-time">${timeDisp}</span>
          </div>
        </div>
        <button class="btn-add-gcal"${btnEventId}${btnStyle}
          data-title="${escapeHtml(ev.title)}"
          data-date="${ev.dateStr || ''}"
          data-start-utc="${ev.startUtc || ''}">${btnText}</button>
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
  container.querySelectorAll('.btn-add-gcal').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.eventId) removeMatchFromGcal(btn);
      else addMatchToGcal(btn);
    });
  });
}

async function addMatchToGcal(btn) {
  if (!gcalTokenBet) {
    if (!gcTokenClientBet) { alert('Googleカレンダーに接続できません'); return; }
    gcTokenClientBet.requestAccessToken({ prompt: 'consent' });
    alert('ログイン後、もう一度ボタンを押してください');
    return;
  }

  const title    = btn.dataset.title;
  const dateStr  = btn.dataset.date;
  const startUtc = btn.dataset.startUtc;

  let body;
  if (startUtc) {
    const endDt = new Date(new Date(startUtc).getTime() + 2 * 60 * 60 * 1000);
    body = {
      summary: title,
      start:   { dateTime: toJSTIso(startUtc),            timeZone: 'Asia/Tokyo' },
      end:     { dateTime: toJSTIso(endDt.toISOString()), timeZone: 'Asia/Tokyo' },
    };
  } else {
    const next = new Date(dateStr + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    body = {
      summary: title,
      start:   { date: dateStr },
      end:     { date: next.toISOString().split('T')[0] },
    };
  }

  btn.textContent = '追加中…'; btn.disabled = true;
  console.log('Calendar POST body:', JSON.stringify(body));

  try {
    const calId = encodeURIComponent(bettingCalendarId);
    const res   = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
      { method: 'POST', headers: { Authorization: `Bearer ${gcalTokenBet}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (res.status === 401) {
      gcalTokenClear();
      btn.textContent = '📅＋'; btn.disabled = false;
      alert('認証期限切れです。再ログインしてください。');
      return;
    }
    if (res.ok) {
      const created = await res.json();
      btn.dataset.eventId = created.id;
      btn.textContent = '🗑 削除';
      btn.style.background   = '#fde8e8';
      btn.style.borderColor  = '#f5b8b8';
      btn.style.color        = 'var(--loss)';
      btn.disabled = false;
      gcalStoreSave(title, dateStr, startUtc, created.id);
    } else {
      const errData = await res.json().catch(() => ({}));
      console.error('Calendar API error:', res.status, errData);
      btn.textContent = '📅＋'; btn.disabled = false;
      alert(`追加に失敗しました（${errData.error?.message || res.status}）`);
    }
  } catch (e) {
    console.error('addMatchToGcal fetch error:', e);
    btn.textContent = '📅＋'; btn.disabled = false;
  }
}

async function removeMatchFromGcal(btn) {
  const eventId = btn.dataset.eventId;
  const calId   = encodeURIComponent(bettingCalendarId);

  btn.textContent = '削除中…'; btn.disabled = true;

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${gcalTokenBet}` } }
    );
    if (res.ok || res.status === 204 || res.status === 410) {
      gcalStoreDelete(btn.dataset.title, btn.dataset.date, btn.dataset.startUtc);
      delete btn.dataset.eventId;
      btn.textContent      = '📅＋';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color      = '';
      btn.disabled = false;
    } else if (res.status === 401) {
      gcalTokenClear();
      btn.textContent = '🗑 削除'; btn.disabled = false;
      alert('認証期限切れです。再ログインしてください。');
    } else {
      btn.textContent = '🗑 削除'; btn.disabled = false;
      alert('削除に失敗しました');
    }
  } catch { btn.textContent = '🗑 削除'; btn.disabled = false; }
}

// ---- カレンダー連携済みの永続化 ----
const GCAL_STORE_KEY = 'betting_gcal_events';
function gcalStoreGet() { try { return JSON.parse(localStorage.getItem(GCAL_STORE_KEY) || '{}'); } catch { return {}; } }
function gcalEntryKey(title, dateStr, startUtc) { return `${title}||${startUtc || dateStr}`; }
function gcalStoreSave(title, dateStr, startUtc, eventId) {
  const s = gcalStoreGet(); s[gcalEntryKey(title, dateStr, startUtc)] = eventId;
  localStorage.setItem(GCAL_STORE_KEY, JSON.stringify(s));
}
function gcalStoreDelete(title, dateStr, startUtc) {
  const s = gcalStoreGet(); delete s[gcalEntryKey(title, dateStr, startUtc)];
  localStorage.setItem(GCAL_STORE_KEY, JSON.stringify(s));
}
function gcalGetEventId(title, dateStr, startUtc) {
  return gcalStoreGet()[gcalEntryKey(title, dateStr, startUtc)] || null;
}

function gcalSetConnected() {
  const btn = document.getElementById('gcal-login-btn');
  if (btn) {
    btn.textContent = '✅ 接続済み';
    btn.classList.add('connected');
  } else {
    setTimeout(gcalSetConnected, 200);
  }
}

function initGcalBetting() {
  if (gcTokenClientBet) return;
  if (typeof google === 'undefined' || !google.accounts) { setTimeout(initGcalBetting, 300); return; }

  // セッション内にトークンが残っていれば即復元
  if (gcalTokenRestore()) {
    gcalSetConnected();
    findSportsCalendar();
  }

  gcTokenClientBet = google.accounts.oauth2.initTokenClient({
    client_id:      GC_CLIENT_ID_BET,
    scope:          GC_SCOPE_BET,
    callback:       (resp) => {
      if (resp.error) { gcalTokenClear(); return; }
      gcalTokenSave(resp.access_token);
      localStorage.setItem(GCAL_AUTOLOGIN_KEY, '1');
      gcalSetConnected();
      findSportsCalendar();
    },
    error_callback: () => {},
  });

  // セッションに残っていなければ Google に silent リクエスト
  if (!gcalTokenBet && localStorage.getItem(GCAL_AUTOLOGIN_KEY)) {
    gcTokenClientBet.requestAccessToken({ prompt: '' });
  }
}

window.onGoogleLibraryLoad = initGcalBetting;

function initScheduleTab() {
  document.getElementById('sched-date-label').textContent = schedDateLabel(scheduleDate);

  document.getElementById('sched-prev').addEventListener('click', () => {
    scheduleDate.setDate(scheduleDate.getDate() - 1); loadSportsSchedule();
  });
  document.getElementById('sched-next').addEventListener('click', () => {
    scheduleDate.setDate(scheduleDate.getDate() + 1); loadSportsSchedule();
  });
  document.getElementById('sched-today').addEventListener('click', () => {
    scheduleDate = new Date(); loadSportsSchedule();
  });

  if (gcalTokenBet) gcalSetConnected();

  document.getElementById('gcal-login-btn').addEventListener('click', () => {
    if (!gcTokenClientBet) {
      alert('Googleカレンダーの初期化中です。しばらく待ってから再試行してください。');
      return;
    }
    gcTokenClientBet.requestAccessToken({ prompt: 'consent' });
  });

  document.querySelectorAll('.sport-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sport-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scheduleFilter = btn.dataset.sport;
      leagueFilter.clear();
      renderLeagueFilters();
      renderSportsEvents();
    });
  });
}

// ============================================================
// refreshAll / タブ切り替え
// ============================================================
function refreshAll() {
  renderRecords();
  renderCampaigns();
  populateCampaignSelect();
  updateSummary();
  if (!document.getElementById('tab-stats').hidden) {
    renderCharts();
    renderPeriodStats();
    renderGoalProgress();
  }
}

function initTabs() {
  // 勝敗数グラフ：リーグ別 / スポーツ別
  document.querySelectorAll('.stats-toggle-btn[data-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-toggle-btn[data-group]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _statsGroupBy = btn.dataset.group;
      renderSportChart();
      renderStatsTable();
      renderPeriodStats();
      renderGoalProgress();
    });
  });

  // 累計損益グラフ：ベット別 / 日別
  document.querySelectorAll('.stats-toggle-btn[data-pnl]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-toggle-btn[data-pnl]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _pnlViewBy = btn.dataset.pnl;
      const settled = _bets.filter(b => b.result !== 'pending').slice().reverse();
      renderPnlChart(settled);
    });
  });

  document.querySelectorAll('.stats-toggle-btn[data-balance]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-toggle-btn[data-balance]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _balanceViewBy = btn.dataset.balance;
      const settled = _bets.filter(b => b.result !== 'pending').slice().reverse();
      renderBalanceChart(settled);
    });
  });

  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => { t.hidden = true; });
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === 'stats') {
        renderCharts();
        renderPeriodStats();
        renderGoalProgress();
      }
      if (btn.dataset.tab === 'schedule') {
        loadSportsSchedule();
      }
      if (btn.dataset.tab === 'pnl') {
        renderPnlStatement();
      }
    });
  });

  document.getElementById('pnl-prev').addEventListener('click', () => {
    _pnlMonth--;
    if (_pnlMonth < 1) { _pnlMonth = 12; _pnlYear--; }
    renderPnlStatement();
  });
  document.getElementById('pnl-next').addEventListener('click', () => {
    _pnlMonth++;
    if (_pnlMonth > 12) { _pnlMonth = 1; _pnlYear++; }
    renderPnlStatement();
  });
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initSettings();
  initScheduleTab();

  // 記録フォーム
  document.getElementById('btn-add').addEventListener('click', openAddForm);
  document.getElementById('btn-cancel').addEventListener('click', () => {
    document.getElementById('form-container').hidden = true;
  });
  document.getElementById('form-container').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });
  document.getElementById('btn-add-leg').addEventListener('click', () => addLeg());
  document.getElementById('input-combo-boost').addEventListener('input', updateCombinedOdds);

  document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', () => setFormType(radio.value));
  });
  document.querySelector('select[name="sport"]').addEventListener('change', e => {
    updateLeagueSelect(e.target.value);
  });

  document.getElementById('form-campaign-select').addEventListener('change', () => {
    const cb = document.getElementById('input-is-freebet');
    if (cb) { cb.checked = true; delete cb.dataset.userSet; }
    updateFreebetToggle();
  });

  document.getElementById('btn-add-league').addEventListener('click', () => {
    const sport = document.querySelector('select[name="sport"]').value;
    const name  = prompt(`「${sport}」に追加するリーグ名を入力してください`);
    if (!name || !name.trim()) return;
    addLeagueToStorage(sport, name.trim());
    updateLeagueSelect(sport, name.trim());
  });

  document.getElementById('bet-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f    = e.target;
    const type = f.querySelector('input[name="type"]:checked').value;
    let bet;

    if (type === 'parlay') {
      const legs = getLegsFromForm();
      if (legs.length < 2)                                 { alert('マルチは2レッグ以上必要です'); return; }
      if (legs.some(l => isNaN(l.odds) || l.odds < 1.01)) { alert('すべてのレッグにオッズを入力してください'); return; }
      const combinedOdds = Math.round(legs.reduce((acc, l) => acc * l.odds, 1) * 100) / 100;
      const comboBoost   = parseFloat(document.getElementById('input-combo-boost').value) || null;
      const campaignIdP  = f.elements.campaignId.value || null;
      const isFreebetP   = document.getElementById('input-is-freebet').checked;
      bet = { type: 'parlay', date: f.elements.date.value, legs, combinedOdds, comboBoost,
              stake: parseInt(f.elements.stake.value), isFreebet: isFreebetP,
              campaignId: campaignIdP,
              result: f.elements.result.value, memo: f.elements.memo.value.trim() };
    } else {
      if (!f.elements.odds.value) { alert('オッズを入力してください'); return; }
      const sport      = f.elements.sport.value;
      const leagueSel  = document.getElementById('single-league-select');
      const campaignId = f.elements.campaignId.value || null;
      const isFreebet  = document.getElementById('input-is-freebet').checked;
      bet = { type: 'single', date: f.elements.date.value, sport,
              league: (getLeagues()[sport] !== undefined && leagueSel?.value) ? leagueSel.value : null,
              match: null, bet: f.elements.bet.value,
              odds: parseFloat(f.elements.odds.value),
              stake: parseInt(f.elements.stake.value), isFreebet,
              campaignId,
              result: f.elements.result.value, memo: f.elements.memo.value.trim() };
    }

    const id = f.elements.id.value;
    if (id) await updateBet(id, bet); else await addBet(bet);
    document.getElementById('form-container').hidden = true;
    refreshAll();
  });

  // キャンペーンフォーム
  document.getElementById('campaign-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await addCampaign({
      name:          f.elements.campaignName.value.trim(),
      wagerRequired: parseInt(f.elements.wagerRequired.value),
      fbReward:      parseInt(f.elements.fbReward.value),
      startDate:     f.elements.campaignStart.value,
    });
    f.reset();
    f.elements.campaignStart.value = new Date().toISOString().slice(0, 10);
    refreshAll();
  });
  document.querySelector('#campaign-add-form [name="campaignStart"]').value =
    new Date().toISOString().slice(0, 10);

  // 目標追加フォーム
  document.getElementById('goal-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await addGoal({
      name:       f.elements.goalName.value.trim(),
      goalAmount: parseInt(f.elements.goalAmount.value),
      goalStart:  f.elements.goalStart.value,
      goalEnd:    f.elements.goalEnd.value,
    });
    f.reset();
    renderGoalProgress();
  });

  // データ読み込みと初期描画
  await loadAll();
  populateSettings();
  refreshAll();

  // 最初のタブを表示
  document.getElementById('tab-records').hidden = false;
});
