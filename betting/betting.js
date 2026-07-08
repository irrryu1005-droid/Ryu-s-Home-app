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
let _sportsOrder = [];
function getSports() { return _sportsOrder; }
// 旧日本語キー → 英語へのマッピング（既存データ互換）
const SPORT_JP_TO_EN = {
  'サッカー': 'Football', '野球': 'Baseball',
  'バスケ': 'Basketball', 'テニス': 'Tennis', 'その他': 'Other',
};
function sportDisplay(s) { return SPORT_JP_TO_EN[s] || s; }

// リーグはSupabaseのbet_leaguesテーブルで管理（sport → [name, ...] のキャッシュ）
let _leaguesMap = {};
function getLeagues() { return _leaguesMap; }

async function addLeague(sport, name) {
  if (!_leaguesMap[sport]) _leaguesMap[sport] = [];
  if (_leaguesMap[sport].includes(name)) return;
  const { error } = await db.from('bet_leagues').insert([{ sport, name }]);
  if (!error) _leaguesMap[sport].push(name);
}

// ============================================================
// ローカルキャッシュ（Supabaseから読み込んだデータを保持）
// ============================================================
let _bets          = [];
let _campaigns     = [];
let _settings      = { bankroll: null };
let _goals         = [];
let _deposits      = [];
let _consultations = [];
let _detailsOpenState = null; // null=初回レンダリング。toggle イベントで常に最新を保持

const _now = new Date();
let _pnlYear  = _now.getFullYear();
let _pnlMonth = _now.getMonth() + 1;
let _pnlMode  = 'monthly'; // 'monthly' | 'all'

function todayJST() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _makeOverlay(html) {
  const overlay = document.createElement('div');
  overlay.className = 'custom-confirm-overlay';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  return overlay;
}
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = _makeOverlay(`<div class="custom-confirm-dialog"><p class="custom-confirm-msg">${escapeHtml(message)}</p><div class="custom-confirm-btns"><button class="custom-confirm-cancel">キャンセル</button><button class="custom-confirm-ok">OK</button></div></div>`);
    const close = (val) => { document.body.removeChild(overlay); resolve(val); };
    overlay.querySelector('.custom-confirm-ok').addEventListener('click', () => close(true));
    overlay.querySelector('.custom-confirm-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  });
}
function showAlert(message) {
  return new Promise(resolve => {
    const overlay = _makeOverlay(`<div class="custom-confirm-dialog"><p class="custom-confirm-msg">${escapeHtml(message)}</p><div class="custom-confirm-btns"><button class="custom-confirm-ok">OK</button></div></div>`);
    const close = () => { document.body.removeChild(overlay); resolve(); };
    overlay.querySelector('.custom-confirm-ok').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  });
}
function showPrompt(message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = _makeOverlay(`<div class="custom-confirm-dialog"><p class="custom-confirm-msg">${escapeHtml(message)}</p><input class="custom-prompt-input" type="text" value="${escapeHtml(defaultValue)}"><div class="custom-confirm-btns"><button class="custom-confirm-cancel">キャンセル</button><button class="custom-confirm-ok">OK</button></div></div>`);
    const input = overlay.querySelector('.custom-prompt-input');
    const close = (val) => { document.body.removeChild(overlay); resolve(val); };
    overlay.querySelector('.custom-confirm-ok').addEventListener('click', () => close(input.value));
    overlay.querySelector('.custom-confirm-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); });
  });
}

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
    sortOrder:    row.sort_order    ?? 0,
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
    id:             row.id,
    name:           row.name,
    wagerRequired:  row.wager_required,
    fbReward:       row.fb_reward,
    startDate:      row.start_date,
    status:         row.status         || 'active',
    completedDate:  row.completed_date,
    completionType: row.completion_type || 'success',
  };
}

async function loadAll() {
  const [betsRes, campsRes, settingsRes, goalsRes, depositsRes, leaguesRes, consultRes] = await Promise.all([
    db.from('bets').select('*').order('date', { ascending: false }).order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
    db.from('bet_campaigns').select('*').eq('hidden', false).order('created_at'),
    db.from('bet_settings').select('*').eq('id', 1).single(),
    db.from('bet_goals').select('*').order('created_at'),
    db.from('bet_deposits').select('*').order('deposit_date', { ascending: false }),
    db.from('bet_leagues').select('*').order('sport').order('sort_order'),
    db.from('bet_consultations').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  _bets          = (betsRes.data     || []).map(normalizeBet);
  _campaigns     = (campsRes.data    || []).map(normalizeCampaign);
  _settings      =  settingsRes.data || { bankroll: null };
  _goals         = (goalsRes.data    || []).map(normalizeGoal);
  _deposits      =  depositsRes.data || [];
  _consultations =  consultRes.data  || [];
  _leaguesMap = {};
  _sportsOrder = [];
  for (const row of (leaguesRes.data || [])) {
    if (!_leaguesMap[row.sport]) {
      _leaguesMap[row.sport] = [];
      _sportsOrder.push(row.sport);
    }
    _leaguesMap[row.sport].push(row.name);
  }
  if (!_sportsOrder.includes('Other')) _sportsOrder.push('Other');
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
    sort_order:    bet.sortOrder     ?? 0,
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
  if (updates.name          !== undefined) row.name           = updates.name;
  if (updates.startDate     !== undefined) row.start_date     = updates.startDate || null;
  if (updates.wagerRequired !== undefined) row.wager_required = updates.wagerRequired;
  if (updates.fbReward      !== undefined) row.fb_reward      = updates.fbReward;
  const { error } = await db.from('bet_campaigns').update(row).eq('id', id);
  if (error) { console.error('updateCampaign error:', error); return; }
  // String() で型不一致を回避
  const idx = _campaigns.findIndex(c => String(c.id) === String(id));
  if (idx !== -1) _campaigns[idx] = { ..._campaigns[idx], ...updates };
}

async function deleteCampaign(id) {
  const { error } = await db.from('bet_campaigns').update({ hidden: true }).eq('id', id);
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

  async function handleDepositAction(type) {
    const amount = parseInt(document.getElementById('settings-deposit').value);
    if (!amount || amount <= 0) return;
    const dateVal = document.getElementById('settings-deposit-date').value;
    const depositDate = dateVal || todayJST();

    const current = _settings.bankroll || 0;
    const newBankroll = type === 'deposit' ? current + amount : current - amount;
    await saveBankroll(newBankroll);

    const { data, error } = await db.from('bet_deposits').insert([{
      amount, deposit_date: depositDate, type, sort_order: -1,
    }]).select().single();
    if (!error && data) _deposits.unshift(data);

    document.getElementById('settings-bankroll').value     = newBankroll;
    document.getElementById('settings-deposit').value      = '';
    document.getElementById('settings-deposit-date').value = '';
    renderDepositHistory();
    refreshAll();
  }

  document.getElementById('btn-deposit') .addEventListener('click', () => handleDepositAction('deposit'));
  document.getElementById('btn-withdraw').addEventListener('click', () => handleDepositAction('withdrawal'));

  renderDepositHistory();
}

function renderDepositHistory() {
  const el = document.getElementById('deposit-history');
  if (!el) return;
  if (_deposits.length === 0) { el.innerHTML = ''; return; }

  // 日付降順（新しい順）
  const sorted = [..._deposits].sort((a, b) => b.deposit_date.localeCompare(a.deposit_date));

  const rows = sorted.map(d => {
    const isWithdrawal = d.type === 'withdrawal';
    const sign = isWithdrawal ? '－' : '＋';
    const cls  = isWithdrawal ? 'deposit-amount withdrawal' : 'deposit-amount';
    return `
    <div class="deposit-row" data-id="${d.id}">
      <span class="deposit-date">${d.deposit_date}</span>
      <span class="${cls}">${sign}¥${Number(d.amount).toLocaleString()}</span>
      <button class="deposit-edit-btn small-btn btn-secondary" data-id="${d.id}">編集</button>
      <button class="deposit-del-btn small-btn btn-danger" data-id="${d.id}">削除</button>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="deposit-history-label">入出金履歴</div>${rows}`;

  el.querySelectorAll('.deposit-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = Number(btn.dataset.id);
      const dep = _deposits.find(d => d.id === id);
      if (!dep) return;
      const row = el.querySelector(`.deposit-row[data-id="${id}"]`);
      row.innerHTML = `
        <input type="date" class="dep-edit-date" value="${dep.deposit_date}" style="width:130px">
        <input type="number" class="dep-edit-amount" value="${dep.amount}" min="1" style="width:100px">
        <select class="dep-edit-type">
          <option value="deposit"   ${dep.type === 'deposit'    ? 'selected' : ''}>入金</option>
          <option value="withdrawal"${dep.type === 'withdrawal' ? 'selected' : ''}>出金</option>
        </select>
        <button class="dep-save-btn small-btn">保存</button>
        <button class="dep-cancel-btn small-btn btn-secondary">キャンセル</button>`;

      row.querySelector('.dep-cancel-btn').addEventListener('click', () => renderDepositHistory());

      row.querySelector('.dep-save-btn').addEventListener('click', async () => {
        const newDate   = row.querySelector('.dep-edit-date').value;
        const newAmount = parseInt(row.querySelector('.dep-edit-amount').value);
        const newType   = row.querySelector('.dep-edit-type').value;
        if (!newDate || !newAmount || newAmount <= 0) return;

        // bankroll への影響差分を計算
        const oldEffect = dep.type === 'withdrawal' ? -dep.amount :  dep.amount;
        const newEffect = newType  === 'withdrawal' ? -newAmount  :  newAmount;
        const newBankroll = (_settings.bankroll || 0) + (newEffect - oldEffect);

        await saveBankroll(newBankroll);
        await db.from('bet_deposits').update({ amount: newAmount, deposit_date: newDate, type: newType }).eq('id', id);

        const idx = _deposits.findIndex(d => d.id === id);
        if (idx !== -1) _deposits[idx] = { ..._deposits[idx], amount: newAmount, deposit_date: newDate, type: newType };
        document.getElementById('settings-bankroll').value = newBankroll;
        renderDepositHistory();
        refreshAll();
      });
    });
  });

  el.querySelectorAll('.deposit-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id  = Number(btn.dataset.id);
      const dep = _deposits.find(d => d.id === id);
      if (!dep) return;
      if (!await showConfirm(`この入出金履歴を削除しますか？`)) return;
      const isWithdrawal = dep.type === 'withdrawal';
      const newBankroll  = (_settings.bankroll || 0) + (isWithdrawal ? dep.amount : -dep.amount);
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
    if (campaign.completionType === 'failed') return 0; // 条件未達: FB損益は常に0
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
// 分析タブ
// ============================================================
function renderAI() {
  const rows = _consultations;
  const el   = document.getElementById('ai-container');

  // --- サマリー集計 ---
  const settled = rows.filter(r => r.result === 'win' || r.result === 'loss');
  const wins    = settled.filter(r => r.result === 'win').length;
  const losses  = settled.filter(r => r.result === 'loss').length;
  const pending = rows.filter(r => r.result === 'pending' || !r.result).length;
  const hitRate = settled.length > 0 ? Math.round(wins / settled.length * 100) : null;
  const avgPred = rows.length > 0
    ? (rows.reduce((s, r) => s + (parseFloat(r.predicted_win_rate) || 0), 0) / rows.length).toFixed(1)
    : null;

  // --- キャリブレーション（勝率帯ごと）---
  const BANDS = [
    { label: '〜60%',  min: 0,  max: 60  },
    { label: '61〜70%', min: 60, max: 70  },
    { label: '71〜80%', min: 70, max: 80  },
    { label: '81%〜',   min: 80, max: 100 },
  ];
  const calib = BANDS.map(band => {
    const inBand  = settled.filter(r => {
      const p = parseFloat(r.predicted_win_rate);
      return p > band.min && p <= band.max;
    });
    const w = inBand.filter(r => r.result === 'win').length;
    return { ...band, total: inBand.length, wins: w,
             actual: inBand.length > 0 ? Math.round(w / inBand.length * 100) : null };
  });

  const resultSelect = (r, id) => `
    <select class="consult-result-select result-select" data-id="${id}">
      <option value="pending" ${(!r || r === 'pending') ? 'selected' : ''}>未</option>
      <option value="win"     ${r === 'win'  ? 'selected' : ''}>勝</option>
      <option value="loss"    ${r === 'loss' ? 'selected' : ''}>負</option>
    </select>`;

  const evColor = ev => {
    const v = parseFloat(ev);
    if (isNaN(v)) return '';
    return v >= 5 ? 'style="color:var(--win);font-weight:700"'
         : v >= 0 ? 'style="color:var(--text)"'
         : 'style="color:var(--loss)"';
  };

  // --- 補正詳細カード ---
  const withCorr = rows.filter(r => r.corrections_json);
  const corrCards = withCorr.map(r => {
    const cj       = r.corrections_json;
    const isSettled = r.result === 'win' || r.result === 'loss';
    const badge    = r.result === 'win' ? '<span class="ai-badge ai-win">勝</span>'
                   : r.result === 'loss' ? '<span class="ai-badge ai-loss">負</span>'
                   : '<span class="ai-badge ai-pending">未</span>';
    const factorRows = (cj.factors || []).map((f, i) => {
      const fbVal  = f.feedback || '';
      const fbOpts = [
        ['', '—'],
        ['accurate', '○ 正確'],
        ['over',     '△ 過大'],
        ['under',    '▽ 過小'],
        ['miss',     '✗ 外れ'],
      ].map(([v, l]) => `<option value="${v}" ${fbVal === v ? 'selected' : ''}>${l}</option>`).join('');
      const corrColor = f.correction >= 0 ? 'var(--win)' : 'var(--loss)';
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 6px;font-weight:600;white-space:nowrap">${f.factor}</td>
        <td style="padding:5px 6px;font-size:11px">${f.team_a || '—'}</td>
        <td style="padding:5px 6px;font-size:11px">${f.team_b || '—'}</td>
        <td style="padding:5px 6px;text-align:center;font-weight:700;color:${corrColor};white-space:nowrap">
          ${f.correction >= 0 ? '+' : ''}${f.correction}%
        </td>
        <td style="padding:5px 6px;text-align:center">
          <select class="factor-fb-sel result-select"
            data-consult-id="${r.id}" data-factor-idx="${i}"
            ${!isSettled ? 'disabled title="結果確定後に評価できます"' : ''}>
            ${fbOpts}
          </select>
        </td>
      </tr>`;
    }).join('');

    return `<div class="correction-card">
      <div class="correction-card-head">
        <span>${r.date} ${r.sport} / ${r.league || ''}</span>
        <span>オッズ ${r.odds} &nbsp;|&nbsp; ベース <b>${cj.base_rate}%</b> → 予想 <b>${r.predicted_win_rate}%</b>
          (EV <span ${evColor(r.expected_value)}>${r.expected_value}%</span>)
          ${badge}
        </span>
      </div>
      <div class="table-scroll" style="margin-top:6px">
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="background:var(--bg)">
            <th style="padding:5px 6px;text-align:left">要素</th>
            <th style="padding:5px 6px">チームA</th>
            <th style="padding:5px 6px">チームB</th>
            <th style="padding:5px 6px;text-align:center">補正値</th>
            <th style="padding:5px 6px;text-align:center">評価</th>
          </tr></thead>
          <tbody>${factorRows}</tbody>
        </table>
      </div>
      ${cj.reliability_items != null
        ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">取得項目 ${cj.reliability_items}件${cj.reliability_penalty ? ' / 信頼度ペナルティ ' + cj.reliability_penalty + '%' : ''}</div>`
        : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <!-- サマリー -->
    <div class="ai-summary-row">
      <div class="ai-s-item"><div class="ai-s-label">相談件数</div><div class="ai-s-val">${rows.length}</div></div>
      <div class="ai-s-item"><div class="ai-s-label">勝/負/未</div><div class="ai-s-val">${wins}/${losses}/${pending}</div></div>
      <div class="ai-s-item"><div class="ai-s-label">的中率</div><div class="ai-s-val ${hitRate !== null && hitRate >= 50 ? 'win' : hitRate !== null ? 'loss' : ''}">${hitRate !== null ? hitRate + '%' : '—'}</div></div>
      <div class="ai-s-item"><div class="ai-s-label">平均予想勝率</div><div class="ai-s-val">${avgPred !== null ? avgPred + '%' : '—'}</div></div>
    </div>

    <!-- キャリブレーション -->
    <div class="chart-card" style="margin-bottom:14px">
      <h3>精度キャリブレーション</h3>
      ${settled.length < 5
        ? `<p class="empty-msg" style="padding:10px 0">データが5件以上で集計されます（現在 ${settled.length} 件）</p>`
        : `<table style="width:100%;font-size:12px">
            <thead><tr>
              <th>予想勝率帯</th><th style="text-align:center">件数</th>
              <th style="text-align:center">予想</th><th style="text-align:center">実際</th>
              <th style="text-align:center">差</th>
            </tr></thead>
            <tbody>
              ${calib.map(b => {
                const mid  = b.total > 0 ? ((b.min + b.max) / 2).toFixed(0) : '—';
                const diff = b.actual !== null ? b.actual - parseInt(mid) : null;
                const diffStr = diff !== null
                  ? `<span style="color:${diff >= 0 ? 'var(--win)' : 'var(--loss)'}">${diff >= 0 ? '+' : ''}${diff}%</span>`
                  : '—';
                return `<tr>
                  <td>${b.label}</td>
                  <td style="text-align:center">${b.total}</td>
                  <td style="text-align:center">${b.total > 0 ? mid + '%' : '—'}</td>
                  <td style="text-align:center">${b.actual !== null ? b.actual + '%' : '—'}</td>
                  <td style="text-align:center">${diffStr}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`
      }
    </div>

    <!-- 補正詳細カード -->
    ${withCorr.length > 0 ? `
    <div class="chart-card" style="margin-bottom:14px">
      <h3>補正詳細フィードバック</h3>
      <p style="font-size:11px;color:var(--muted);margin-bottom:12px">結果確定後に各補正要素が正しかったか評価してください</p>
      ${corrCards}
    </div>` : ''}

    <!-- 履歴テーブル -->
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>日付</th><th>スポーツ</th><th>リーグ</th><th>オッズ</th>
          <th>必要勝率</th><th>予想勝率</th><th>EV</th><th>推奨</th><th>結果</th>
        </tr></thead>
        <tbody>
          ${rows.length === 0
            ? `<tr><td colspan="9" class="empty-msg">まだ記録がありません</td></tr>`
            : rows.map(r => `<tr>
                <td style="white-space:nowrap">${r.date || ''}</td>
                <td>${r.sport || ''}</td>
                <td>${r.league || ''}</td>
                <td>${r.odds || ''}</td>
                <td style="text-align:right">${r.required_win_rate ? r.required_win_rate + '%' : '—'}</td>
                <td style="text-align:right;font-weight:700">${r.predicted_win_rate ? r.predicted_win_rate + '%' : '—'}</td>
                <td style="text-align:right" ${evColor(r.expected_value)}>${r.expected_value ? r.expected_value + '%' : '—'}</td>
                <td style="font-size:11px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.recommendation || '—'}</td>
                <td>${resultSelect(r.result, r.id)}</td>
              </tr>`).join('')
          }
        </tbody>
      </table>
    </div>
  `;

  // 結果更新
  el.querySelectorAll('.consult-result-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const { error } = await db.from('bet_consultations').update({ result: sel.value }).eq('id', sel.dataset.id);
      if (error) { console.error('consult update error:', error); return; }
      const row = _consultations.find(r => String(r.id) === sel.dataset.id);
      if (row) row.result = sel.value;
      renderAI();
    });
  });

  // 補正要素フィードバック更新
  el.querySelectorAll('.factor-fb-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      const consultId = sel.dataset.consultId;
      const factorIdx = parseInt(sel.dataset.factorIdx);
      const row = _consultations.find(r => String(r.id) === consultId);
      if (!row || !row.corrections_json) return;
      const updated = JSON.parse(JSON.stringify(row.corrections_json));
      updated.factors[factorIdx].feedback = sel.value || null;
      const { error } = await db.from('bet_consultations')
        .update({ corrections_json: updated }).eq('id', consultId);
      if (error) { console.error('factor feedback error:', error); return; }
      row.corrections_json = updated;
    });
  });
}

// ============================================================
// 損益計算書
// ============================================================
function renderPnlStatement() {
  const y = _pnlYear, m = _pnlMonth;
  const isAll = _pnlMode === 'all';

  document.getElementById('pnl-month-label').textContent = isAll ? '全期間' : `${y}年${m}月`;
  document.getElementById('pnl-prev').style.visibility = isAll ? 'hidden' : '';
  document.getElementById('pnl-next').style.visibility = isAll ? 'hidden' : '';

  // モード切替ボタンのアクティブ状態を更新
  document.querySelectorAll('.pnl-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === _pnlMode);
  });

  const filtered = isAll
    ? _bets.filter(b => b.result === 'win' || b.result === 'loss')
    : (() => {
        const start = `${y}-${String(m).padStart(2, '0')}-01`;
        const end   = `${y}-${String(m).padStart(2, '0')}-31`;
        return _bets.filter(b => b.date >= start && b.date <= end && (b.result === 'win' || b.result === 'loss'));
      })();

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
let _dragBetId    = null;
let _dragBetDate  = null;
let _dragOverId   = null;
let _dragOverPos  = null; // 'before' | 'after'
let _touchDragRow = null;

// dayItems: [{ type: 'bet', ref: betObj } | { type: 'deposit', ref: depObj }]
async function saveSortOrders(dayItems) {
  await Promise.all(dayItems.map((item, i) => {
    if (item.type === 'deposit') {
      item.ref.sort_order = i;
      return db.from('bet_deposits').update({ sort_order: i }).eq('id', item.ref.id);
    } else {
      item.ref.sortOrder = i;
      return db.from('bets').update({ sort_order: i }).eq('id', item.ref.id);
    }
  }));
}

function getDayItems(date) {
  const items = [];
  _bets.filter(b => b.date === date).forEach(b =>
    items.push({ type: 'bet', id: String(b.id), sort_order: b.sortOrder ?? 0, ref: b }));
  _deposits.filter(d => d.deposit_date === date).forEach(d =>
    items.push({ type: 'deposit', id: `dep-${d.id}`, sort_order: d.sort_order ?? -1, ref: d }));
  return items.sort((a, b) => a.sort_order - b.sort_order);
}

const DAY_NAMES = ['日','月','火','水','木','金','土'];

function buildBetRow(bet) {
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
  return `<tr class="bet-row" draggable="true" data-id="${bet.id}" data-date="${bet.date}">
    <td class="drag-handle" title="ドラッグして並び替え">⠿</td>
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

function buildDepositRow(dep) {
  const signed = dep.type === 'withdrawal' ? -dep.amount : dep.amount;
  const isIn   = signed >= 0;
  const label  = isIn ? '入金' : '出金';
  const cls    = isIn ? 'badge-deposit-in' : 'badge-deposit-out';
  return `<tr class="bet-row records-deposit-row" draggable="true" data-id="dep-${dep.id}" data-date="${dep.deposit_date}" data-deposit-id="${dep.id}">
    <td class="drag-handle" title="ドラッグして並び替え">⠿</td>
    <td colspan="5"><span class="badge-deposit ${cls}">${label}</span> ¥${Math.abs(dep.amount).toLocaleString()}</td>
    <td>—</td>
    <td></td>
  </tr>`;
}

function renderRecords(preOpenMonths = null, preOpenWeeks = null, preOpenDays = null) {
  const container  = document.getElementById('records-list');
  if (_bets.length === 0 && _deposits.length === 0) {
    container.innerHTML = '<div class="empty-msg">まだ記録がありません。「＋ 追加」から始めましょう。</div>';
    return;
  }

  const todayMonth = todayJST().slice(0, 7);

  // 開閉状態を決定（優先順: 明示引数 > module変数 > 初回デフォルト）
  const state = preOpenMonths !== null
    ? { months: preOpenMonths, weeks: preOpenWeeks, days: preOpenDays }
    : _detailsOpenState;
  const isFirstRender = state === null;
  const mOpen = (mKey)       => isFirstRender ? mKey === todayMonth : state.months.has(mKey);
  const wOpen = (mKey, wKey) => isFirstRender ? mKey === todayMonth : state.weeks.has(`${mKey}/${wKey}`);
  const dOpen = (dKey, mKey) => isFirstRender ? mKey === todayMonth : state.days.has(dKey);

  // 月 → 週（月曜始まり・日曜終わり）→ 日 の3段階グルーピング（ベット＋入出金の両方を対象）
  const getMondayStr = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay(); // 0=日 1=月 ... 6=土
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  };
  const monthMap = new Map();
  const addToMonthMap = (dateStr) => {
    const mKey = dateStr.slice(0, 7);
    const wKey = getMondayStr(dateStr); // その週の月曜日 YYYY-MM-DD
    const dKey = dateStr;
    if (!monthMap.has(mKey)) monthMap.set(mKey, new Map());
    const wMap = monthMap.get(mKey);
    if (!wMap.has(wKey)) wMap.set(wKey, new Map());
    const dMap = wMap.get(wKey);
    if (!dMap.has(dKey)) dMap.set(dKey, []);
    return dMap.get(dKey);
  };
  for (const bet of _bets) {
    addToMonthMap(bet.date).push(bet);
  }
  for (const dep of _deposits) {
    addToMonthMap(dep.deposit_date); // 入出金のみの日も日グループを作る（ベットは空配列）
  }

  const sumPnl  = bets => bets.reduce((s, b) => s + (calcPnl(b) ?? 0), 0);
  const pnlSpan = (pnl) => {
    const cls = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '';
    return `<span class="group-pnl ${cls}">${formatPnl(pnl)}</span>`;
  };

  let html = '';

  const sortedMonths = [...monthMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  for (const [mKey, wMap] of sortedMonths) {
    const [year, monStr] = mKey.split('-');
    const mon            = parseInt(monStr);
    const allMonthBets   = [...wMap.values()].flatMap(d => [...d.values()].flat());
    const mPnl           = sumPnl(allMonthBets);

    html += `<details class="month-group" data-month="${mKey}" ${mOpen(mKey) ? 'open' : ''}>
      <summary class="group-summary month-summary">
        <span class="group-arrow">▶</span>
        <span class="group-label">${year}年${mon}月</span>
        <span class="group-meta">${allMonthBets.length}件 ${pnlSpan(mPnl)}</span>
      </summary>`;

    const sortedWeeks = [...wMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));

    for (const [wKey, dMap] of sortedWeeks) {
      const allWeekBets = [...dMap.values()].flat();
      const wPnl        = sumPnl(allWeekBets);
      // wKey はその週の月曜日 (YYYY-MM-DD)。日曜日 = 月曜 + 6日
      const monDate = new Date(wKey + 'T12:00:00');
      const sunDate = new Date(wKey + 'T12:00:00');
      sunDate.setDate(sunDate.getDate() + 6);
      const wLabel = `${monDate.getMonth()+1}/${monDate.getDate()} 〜 ${sunDate.getMonth()+1}/${sunDate.getDate()}`;

      html += `<details class="week-group" data-month="${mKey}" data-week="${wKey}" ${wOpen(mKey, wKey) ? 'open' : ''}>
        <summary class="group-summary week-summary">
          <span class="group-arrow">▶</span>
          <span class="group-label">${wLabel}</span>
          <span class="group-meta">${allWeekBets.length}件 ${pnlSpan(wPnl)}</span>
        </summary>`;

      for (const [dKey, bets] of [...dMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
        const d      = new Date(dKey + 'T12:00:00');
        const dLabel = `${d.getMonth()+1}月${d.getDate()}日（${DAY_NAMES[d.getDay()]}）`;
        const dPnl   = sumPnl(bets);

        // ベットと入金を sort_order で並べて混合表示
        const dayItems = getDayItems(dKey);
        const rowsHtml = dayItems.map(item =>
          item.type === 'bet' ? buildBetRow(item.ref) : buildDepositRow(item.ref)
        ).join('');

        html += `<details class="day-group" data-date="${dKey}" ${dOpen(dKey, mKey) ? 'open' : ''}>
          <summary class="group-summary day-summary">
            <span class="group-arrow">▶</span>
            <span class="group-label">${dLabel}</span>
            <span class="group-meta">${bets.length}件 ${pnlSpan(dPnl)}</span>
          </summary>
          <div class="table-scroll"><table>
            <thead><tr>
              <th class="col-drag"></th>
              <th>種別</th><th>試合 / ベット</th>
              <th>オッズ</th><th>賭け金</th><th>結果</th><th>損益</th><th></th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>
        </details>`;
      }
      html += '</details>'; // week-group
    }
    html += '</details>'; // month-group
  }

  container.innerHTML = html;

  // toggle イベントで _detailsOpenState を常に最新化（どの経路で再描画が走っても状態が維持される）
  const syncDetailsState = () => {
    _detailsOpenState = {
      months: new Set([...container.querySelectorAll('.month-group[open]')].map(el => el.dataset.month)),
      weeks:  new Set([...container.querySelectorAll('.week-group[open]')].map(el => `${el.dataset.month}/${el.dataset.week}`)),
      days:   new Set([...container.querySelectorAll('.day-group[open]')].map(el => el.dataset.date))
    };
  };
  syncDetailsState(); // 描画直後の状態を保存
  container.querySelectorAll('details').forEach(d => d.addEventListener('toggle', syncDetailsState));

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

  // ---- Drag & Drop (mouse + touch) ----
  const rows = container.querySelectorAll('.bet-row');

  const clearDropIndicators = () => {
    rows.forEach(r => r.classList.remove('drop-before', 'drop-after'));
  };

  async function applyReorder() {
    if (!_dragBetId || !_dragOverId) return;
    const items   = getDayItems(_dragBetDate);
    const dragIdx = items.findIndex(it => it.id === _dragBetId);
    if (dragIdx === -1) return;
    const [dragged] = items.splice(dragIdx, 1);
    const targetIdx = items.findIndex(it => it.id === _dragOverId);
    items.splice(_dragOverPos === 'before' ? targetIdx : targetIdx + 1, 0, dragged);
    // await 前に開閉状態を保存（dragend がawait中に発火してもDOM状態が変わらないよう保全）
    const savedMonths = new Set([...container.querySelectorAll('.month-group[open]')].map(el => el.dataset.month));
    const savedWeeks  = new Set([...container.querySelectorAll('.week-group[open]')].map(el => `${el.dataset.month}/${el.dataset.week}`));
    const savedDays   = new Set([...container.querySelectorAll('.day-group[open]')].map(el => el.dataset.date));
    await saveSortOrders(items);
    renderRecords(savedMonths, savedWeeks, savedDays);
    renderCharts();
  }

  function updateDropTarget(clientX, clientY) {
    // ドラッグ中の行を一時的に透明にして下の要素を取得
    if (_touchDragRow) _touchDragRow.style.visibility = 'hidden';
    const el = document.elementFromPoint(clientX, clientY);
    if (_touchDragRow) _touchDragRow.style.visibility = '';

    const targetRow = el?.closest('.bet-row');
    clearDropIndicators();
    if (!targetRow || targetRow === _touchDragRow || targetRow.dataset.date !== _dragBetDate) {
      _dragOverId = _dragOverPos = null;
      return;
    }
    const { top, height } = targetRow.getBoundingClientRect();
    if (clientY < top + height / 2) {
      targetRow.classList.add('drop-before');
      _dragOverId  = targetRow.dataset.id;
      _dragOverPos = 'before';
    } else {
      targetRow.classList.add('drop-after');
      _dragOverId  = targetRow.dataset.id;
      _dragOverPos = 'after';
    }
  }

  // -- マウス（PC）--
  rows.forEach(row => {
    row.addEventListener('dragstart', e => {
      _dragBetId   = row.dataset.id;
      _dragBetDate = row.dataset.date;
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => row.classList.add('bet-row-dragging'));
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('bet-row-dragging');
      clearDropIndicators();
      _dragBetId = _dragBetDate = _dragOverId = _dragOverPos = null;
    });

    row.addEventListener('dragover', e => {
      if (!_dragBetId || _dragBetDate !== row.dataset.date) return;
      if (_dragBetId === row.dataset.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropIndicators();
      const { top, height } = row.getBoundingClientRect();
      if (e.clientY < top + height / 2) {
        row.classList.add('drop-before');
        _dragOverId  = row.dataset.id;
        _dragOverPos = 'before';
      } else {
        row.classList.add('drop-after');
        _dragOverId  = row.dataset.id;
        _dragOverPos = 'after';
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-before', 'drop-after');
    });

    row.addEventListener('drop', async e => {
      e.preventDefault();
      if (!_dragBetId || !_dragOverId) return;
      if (_dragBetDate !== row.dataset.date) return;
      if (_dragBetId === _dragOverId) return;
      await applyReorder();
    });
  });

  // -- タッチ（スマホ）: ⠿ ハンドルを長押しでドラッグ開始 --
  function onTouchMove(e) {
    if (!_dragBetId) return;
    e.preventDefault();
    const { clientX, clientY } = e.touches[0];
    updateDropTarget(clientX, clientY);
  }

  async function onTouchEnd() {
    document.removeEventListener('touchmove', onTouchMove);
    if (_touchDragRow) _touchDragRow.classList.remove('bet-row-dragging');
    clearDropIndicators();
    await applyReorder();
    _dragBetId = _dragBetDate = _dragOverId = _dragOverPos = _touchDragRow = null;
  }

  container.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('touchstart', e => {
      const row = handle.closest('.bet-row');
      if (!row) return;
      e.preventDefault();
      _dragBetId    = row.dataset.id;
      _dragBetDate  = row.dataset.date;
      _touchDragRow = row;
      requestAnimationFrame(() => row.classList.add('bet-row-dragging'));
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd, { once: true });
    }, { passive: false });
  });

}

// ============================================================
// フォーム操作
// ============================================================
function sportOptions(selected = 'Football') {
  return getSports().map(s => `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`).join('');
}

function populateSportSelect() {
  document.querySelectorAll('select[name="sport"]').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = sportOptions(cur || 'Football');
  });
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
  const matchVal = leg.match ? escapeHtml(leg.match) : '';
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
    <div class="form-group">
      <label>試合（任意）</label>
      <div class="match-select-row">
        <span class="leg-match-display ${matchVal ? '' : 'match-none-label'}">${matchVal || '未選択'}</span>
        <button type="button" class="btn-secondary btn-sm btn-pick-match-leg">試合から選ぶ</button>
        <button type="button" class="btn-sm btn-clear-match btn-clear-match-leg" ${matchVal ? '' : 'hidden'}>✕</button>
      </div>
      <input type="hidden" data-field="match" value="${matchVal}">
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
  document.querySelectorAll('.btn-pick-match-leg').forEach(btn => {
    btn.onclick = () => {
      const legItem = btn.closest('.leg-item');
      const betDate = document.querySelector('[name="date"]').value;
      const d = betDate ? new Date(betDate + 'T00:00:00') : new Date();
      openMatchPicker(d, match => applyMatchToLeg(legItem, match));
    };
  });
  document.querySelectorAll('.btn-clear-match-leg').forEach(btn => {
    btn.onclick = () => {
      const legItem = btn.closest('.leg-item');
      legItem.querySelector('[data-field="match"]').value = '';
      const disp = legItem.querySelector('.leg-match-display');
      disp.textContent = '未選択';
      disp.classList.add('match-none-label');
      btn.setAttribute('hidden', '');
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
  form.elements.date.value = todayJST();
  document.getElementById('form-title').textContent  = '新規ベット';
  document.getElementById('legs-container').innerHTML = '';
  setFormType('single');
  updateLeagueSelect(form.elements.sport.value);
  populateCampaignSelect();
  clearSingleMatchDisplay();
  document.getElementById('form-container').hidden = false;
}

function clearSingleMatchDisplay() {
  document.getElementById('single-match-input').value = '';
  const disp = document.getElementById('single-match-display');
  disp.textContent = '未選択';
  disp.classList.add('match-none-label');
  document.getElementById('btn-clear-match-single').setAttribute('hidden', '');
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
    if (bet.match) {
      document.getElementById('single-match-input').value = bet.match;
      const disp = document.getElementById('single-match-display');
      disp.textContent = bet.match;
      disp.classList.remove('match-none-label');
      document.getElementById('btn-clear-match-single').removeAttribute('hidden');
    } else {
      clearSingleMatchDisplay();
    }
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
  if (!await showConfirm(`「${label}」を削除しますか？`)) return;
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
  // 進行中のみ表示。編集時に既に完了済みキャンペーンが選択されていれば例外的に追加
  const visible = _campaigns.filter(c =>
    c.status !== 'completed' || String(c.id) === String(currentId)
  );
  sel.innerHTML = '<option value="">なし</option>' +
    visible.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(currentId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
  updateFreebetToggle();
}

function updateFreebetToggle() {
  const sel = document.getElementById('form-campaign-select');
  const cb  = document.getElementById('input-is-freebet');
  if (sel && cb && sel.value && !cb.dataset.userSet) cb.checked = true;
}

function renderCampaigns() {
  const list     = document.getElementById('campaign-list');
  const active   = _campaigns.filter(c => c.status !== 'completed');
  const completed = _campaigns.filter(c => c.status === 'completed')
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

  let html = '';

  // ---- 進行中キャンペーン ----
  if (active.length === 0) {
    html += '<p class="campaign-empty">進行中のキャンペーンがありません。</p>';
  } else {
    html += active.map(c => {
      const progress = getCampaignProgress(c.id);
      const pct      = Math.min(100, Math.round(progress / c.wagerRequired * 100));
      const color    = pct >= 100 ? '#F39C12' : '#9B59B6';
      return `<div class="campaign-item" data-id="${c.id}">
        <div class="campaign-header">
          <span class="campaign-name">${escapeHtml(c.name)}</span>
          <span class="campaign-reward">FB報酬: <strong>¥${Number(c.fbReward).toLocaleString()}</strong></span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="progress-label">¥${progress.toLocaleString()} / ¥${Number(c.wagerRequired).toLocaleString()} (${pct}%)</span>
        </div>
        <div class="campaign-actions">
          <button class="small-btn btn-campaign-complete" data-id="${c.id}">✅ ベット成功</button>
          <button class="small-btn btn-campaign-end"      data-id="${c.id}">❌ 条件未達</button>
          <button class="small-btn btn-campaign-edit"     data-id="${c.id}">編集</button>
        </div>
        <form class="campaign-edit-form" data-id="${c.id}" hidden>
          <div class="form-row">
            <div class="form-group">
              <label>名前</label>
              <input type="text" name="campaignName" value="${escapeHtml(c.name)}" required>
            </div>
            <div class="form-group">
              <label>開始日</label>
              <input type="date" name="campaignStart" value="${c.startDate || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>達成条件 (¥)</label>
              <input type="number" name="wagerRequired" value="${c.wagerRequired}" step="1000" required>
            </div>
            <div class="form-group">
              <label>FB報酬額 (¥)</label>
              <input type="number" name="fbReward" value="${c.fbReward}" step="500" required>
            </div>
          </div>
          <div class="campaign-edit-btns">
            <button type="submit" class="btn-secondary">保存</button>
            <button type="button" class="btn-secondary btn-campaign-edit-cancel" data-id="${c.id}">キャンセル</button>
          </div>
        </form>
      </div>`;
    }).join('');
  }

  // ---- 過去の結果 ----
  if (completed.length > 0) {
    const rows = completed.map(c => {
      const isFailed = c.completionType === 'failed';
      const betPnl   = isFailed ? 0 : _bets
        .filter(b => String(b.campaignId) === String(c.id))
        .reduce((sum, b) => sum + (calcPnl(b) ?? 0), 0);
      const pnlClass = betPnl > 0 ? 'win' : betPnl < 0 ? 'loss' : '';
      const statusBadge = isFailed
        ? '<span class="badge-failed">条件未達</span>'
        : '<span class="badge-success">ベット成功</span>';
      return `<tr>
        <td>${escapeHtml(c.name)} ${statusBadge}</td>
        <td>¥${Number(c.fbReward).toLocaleString()}</td>
        <td class="${pnlClass}">${formatPnl(betPnl)}</td>
        <td><button class="small-btn btn-campaign-reopen" data-id="${c.id}">再開</button></td>
      </tr>`;
    }).join('');
    html += `
    <div class="campaign-history">
      <div class="campaign-history-label">過去の結果（${completed.length}件）</div>
      <div class="table-scroll">
        <table class="campaign-history-table">
          <thead><tr><th>キャンペーン</th><th>FB報酬</th><th>ベット損益</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  list.innerHTML = html;

  list.querySelectorAll('.btn-campaign-reopen').forEach(btn =>
    btn.addEventListener('click', () => reopenCampaign(btn.dataset.id))
  );
  list.querySelectorAll('.btn-campaign-complete').forEach(btn =>
    btn.addEventListener('click', () => completeCampaign(btn.dataset.id))
  );
  list.querySelectorAll('.btn-campaign-end').forEach(btn =>
    btn.addEventListener('click', () => endCampaign(btn.dataset.id))
  );
  list.querySelectorAll('.btn-campaign-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = list.querySelector(`.campaign-edit-form[data-id="${btn.dataset.id}"]`);
      if (form) form.hidden = !form.hidden;
    });
  });
  list.querySelectorAll('.btn-campaign-edit-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = list.querySelector(`.campaign-edit-form[data-id="${btn.dataset.id}"]`);
      if (form) form.hidden = true;
    });
  });
  list.querySelectorAll('.campaign-edit-form').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const id   = form.dataset.id;
      const f    = form.elements;
      await updateCampaign(id, {
        name:          f.campaignName.value.trim(),
        startDate:     f.campaignStart.value || null,
        wagerRequired: parseInt(f.wagerRequired.value),
        fbReward:      parseInt(f.fbReward.value),
      });
      refreshAll();
    });
  });
}

async function completeCampaign(id) {
  const c = _campaigns.find(c => String(c.id) === String(id));
  if (!c || !await showConfirm(`「${c.name}」をベット成功で完了しますか？`)) return;
  const { error } = await db.from('bet_campaigns')
    .update({ status: 'completed', completed_date: todayJST(), completion_type: 'success' })
    .eq('id', id);
  if (error) { console.error('completeCampaign error:', error); return; }
  const { data } = await db.from('bet_campaigns').select('*').eq('hidden', false).order('created_at');
  if (data) _campaigns = data.map(normalizeCampaign);
  refreshAll();
}

async function endCampaign(id) {
  const c = _campaigns.find(c => String(c.id) === String(id));
  if (!c || !await showConfirm(`「${c.name}」を条件未達で終了しますか？`)) return;
  const { error } = await db.from('bet_campaigns')
    .update({ status: 'completed', completed_date: todayJST(), completion_type: 'failed' })
    .eq('id', id);
  if (error) { console.error('endCampaign error:', error); return; }
  const { data } = await db.from('bet_campaigns').select('*').eq('hidden', false).order('created_at');
  if (data) _campaigns = data.map(normalizeCampaign);
  refreshAll();
}

async function reopenCampaign(id) {
  const c = _campaigns.find(c => String(c.id) === String(id));
  if (!c || !await showConfirm(`「${c.name}」を進行中に戻しますか？`)) return;
  const { error } = await db.from('bet_campaigns')
    .update({ status: 'active', completed_date: null })
    .eq('id', id);
  if (error) { console.error('reopenCampaign error:', error); return; }
  const { data } = await db.from('bet_campaigns').select('*').eq('hidden', false).order('created_at');
  if (data) _campaigns = data.map(normalizeCampaign);
  refreshAll();
}

async function confirmDeleteCampaign(id) {
  const c = _campaigns.find(c => c.id === id);
  if (!c || !await showConfirm(`「${c.name}」を削除しますか？`)) return;
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

  // 未確定ベットの賭け金は既に支出済みなので残高から差し引く（フリーベットは実費なし）
  const pendingStake = _bets
    .filter(b => b.result === 'pending' && !b.isFreebet)
    .reduce((sum, b) => sum + (b.stake || 0), 0);

  // 残高（元手が設定されていれば元手+損益、なければ損益だけ表示）
  const balanceEl = document.getElementById('balance');
  if (_settings.bankroll) {
    const balance = _settings.bankroll + totalPnl - pendingStake;
    balanceEl.textContent = '¥' + balance.toLocaleString();
    balanceEl.className   = 's-val ' + (balance < _settings.bankroll ? 'loss' : balance > _settings.bankroll ? 'win' : '');
  } else {
    const effectivePnl = totalPnl - pendingStake;
    balanceEl.textContent = (effectivePnl >= 0 ? '+' : '') + '¥' + effectivePnl.toLocaleString();
    balanceEl.className   = 's-val ' + (effectivePnl > 0 ? 'win' : effectivePnl < 0 ? 'loss' : '');
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
// 目標進捗（ナビゲーション付き）
// ============================================================
let _goalIdx = 0;

function renderGoalProgress() {
  const container = document.getElementById('goals-list');
  if (!container) return;

  if (_goals.length === 0) {
    container.innerHTML = '<p class="goals-empty">目標がありません。「＋ 目標を追加」から設定してください。</p>';
    return;
  }

  // goalEnd 降順（新しい順）
  const sorted = [..._goals].sort((a, b) => b.goalEnd.localeCompare(a.goalEnd));
  _goalIdx = Math.max(0, Math.min(_goalIdx, sorted.length - 1));
  const g = sorted[_goalIdx];

  const today = new Date(); today.setHours(0,0,0,0);

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

  container.innerHTML = `
    <div class="goal-nav">
      <button class="goal-nav-btn" id="btn-goal-prev" ${_goalIdx >= sorted.length - 1 ? 'disabled' : ''}>‹</button>
      <span class="goal-nav-label">${escapeHtml(g.name)} <small>(${_goalIdx + 1}/${sorted.length})</small></span>
      <button class="goal-nav-btn" id="btn-goal-next" ${_goalIdx <= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="goal-card">
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

  document.getElementById('btn-goal-prev').addEventListener('click', () => { _goalIdx++; renderGoalProgress(); });
  document.getElementById('btn-goal-next').addEventListener('click', () => { _goalIdx--; renderGoalProgress(); });
  container.querySelector('.btn-goal-delete').addEventListener('click', async () => {
    if (!await showConfirm('この目標を削除しますか？')) return;
    await deleteGoal(g.id);
    _goalIdx = Math.max(0, _goalIdx - 1);
    renderGoalProgress();
  });
}

// ============================================================
// チャート・統計
// ============================================================
let pnlChart = null, sportChart = null, sportAmountChart = null, balanceChart = null;
let _statsGroupBy      = 'sport'; // 'league' | 'sport'  ← グラフ用
let _statsTableGroupBy = 'sport'; // 'league' | 'sport'  ← テーブル用（独立）
let _pnlViewBy         = 'bet';   // 'bet' | 'day'
let _balanceViewBy     = 'bet';   // 'bet' | 'day'

function getStatKey(sport, league) {
  if (_statsGroupBy === 'sport') return sportDisplay(sport || 'Other');
  return league || sportDisplay(sport) || 'Other';
}

function getTableKey(sport, league) {
  if (_statsTableGroupBy === 'sport') return sportDisplay(sport || 'Other');
  return league || sportDisplay(sport) || 'Other';
}

function renderCharts() {
  const settled = _bets.filter(b => b.result !== 'pending').slice().reverse();
  renderPnlChart(settled);
  renderBalanceChart();
  renderSportChart();
  renderStatsTable();
}

function renderBalanceChart() {
  // 出金は負数として計算（入金:+amount、出金:-amount）
  const netDeposited = _deposits.reduce((s, d) => s + (d.type === 'withdrawal' ? -d.amount : d.amount), 0);
  const initialBankroll = (_settings.bankroll || 0) - netDeposited;

  // ベット時点でスタークを控除し、確定時に払い戻しを加算する方式
  // pending非FB: -stake（ベット時点で即控除）
  // 勝ち: stake*(odds-1)  負け: 0  無効: 0  ※いずれも確定P&Lとして加算
  const calcPnlForChart = (bet) => {
    if (bet.result === 'pending') return bet.isFreebet ? null : -bet.stake;
    return calcPnl(bet);
  };

  const labels = [], data = [], pointColors = [], pointRadii = [], tooltipDeposits = [];
  let balance = initialBankroll;

  // 全ベット（pending含む）を時系列順に並べる（settled と pending を統合）
  const allBets = _bets.slice().reverse(); // renderCharts で reverse 済みのものを再利用

  if (_balanceViewBy === 'bet') {
    const events = [];
    for (const bet of allBets) {
      const pnl = calcPnlForChart(bet);
      if (pnl === null) continue;
      events.push({ date: bet.date, pnl, deposit: 0, sort_order: bet.sortOrder ?? 0 });
    }
    for (const dep of _deposits) {
      const signed = dep.type === 'withdrawal' ? -dep.amount : dep.amount;
      events.push({ date: dep.deposit_date, pnl: 0, deposit: signed, sort_order: dep.sort_order ?? -1 });
    }
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (b.sort_order ?? 9999) - (a.sort_order ?? 9999); // 同日内は降順（recordsの下＝古い順）
    });
    for (const ev of events) {
      balance += ev.deposit + ev.pnl;
      labels.push(ev.date);
      data.push(balance);
      pointColors.push(ev.deposit !== 0 ? '#F59E0B' : '#3498DB');
      pointRadii.push(ev.deposit !== 0 ? 6 : 3);
      tooltipDeposits.push(ev.deposit);
    }
  } else {
    const dayMap = {};
    for (const bet of allBets) {
      const pnl = calcPnlForChart(bet);
      if (pnl === null) continue;
      if (!dayMap[bet.date]) dayMap[bet.date] = { pnl: 0, deposit: 0 };
      dayMap[bet.date].pnl += pnl;
    }
    for (const dep of _deposits) {
      const signed = dep.type === 'withdrawal' ? -dep.amount : dep.amount;
      if (!dayMap[dep.deposit_date]) dayMap[dep.deposit_date] = { pnl: 0, deposit: 0 };
      dayMap[dep.deposit_date].deposit += signed;
    }
    for (const d of Object.keys(dayMap).sort()) {
      const ev = dayMap[d];
      balance += ev.deposit + ev.pnl;
      labels.push(d);
      data.push(balance);
      pointColors.push(ev.deposit !== 0 ? '#F59E0B' : '#3498DB');
      pointRadii.push(ev.deposit !== 0 ? 6 : 3);
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
              return dep > 0 ? `入金: +¥${dep.toLocaleString()}` : dep < 0 ? `出金: -¥${Math.abs(dep).toLocaleString()}` : '';
            },
          },
        },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan:  { enabled: true, mode: 'x' },
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
  // ゼロ交差点を補間してセグメントが正負をまたがないようにする
  const iLabels = [], iData = [];
  for (let i = 0; i < data.length; i++) {
    if (i > 0 && data[i-1] !== 0 && data[i] !== 0 && Math.sign(data[i-1]) !== Math.sign(data[i])) {
      const t = data[i-1] / (data[i-1] - data[i]);
      iLabels.push(labels[i-1] + (labels[i] !== labels[i-1] ? '→' + labels[i] : ''));
      iData.push(0);
    }
    iLabels.push(labels[i]);
    iData.push(data[i]);
  }

  const GREEN = '#27AE60', RED = '#E74C3C';
  const GREEN_BG = 'rgba(39,174,96,0.15)', RED_BG = 'rgba(231,76,60,0.15)';
  const segColor = c => c.p1.parsed.y >= 0 ? GREEN : RED;

  // y=0を境にcanvasクリッピングで上は緑・下は赤を塗り分けるプラグイン
  // fill:true を使うと Chart.js が borderColor(緑)でfill枠をストロークするため使わない
  const greenRedFill = {
    id: 'greenRedFill',
    beforeDatasetDraw(chart, args) {
      const { ctx, chartArea, scales: { y } } = chart;
      const pts = args.meta.data;
      if (!pts.length) return;
      const yZero = Math.max(chartArea.top, Math.min(chartArea.bottom, y.getPixelForValue(0)));

      const tracePath = () => {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], c = pts[i];
          ctx.bezierCurveTo(
            p.cp2x ?? p.x, p.cp2y ?? p.y,
            c.cp1x ?? c.x, c.cp1y ?? c.y,
            c.x, c.y
          );
        }
        ctx.lineTo(pts[pts.length - 1].x, yZero);
        ctx.lineTo(pts[0].x, yZero);
        ctx.closePath();
      };

      for (const [color, clipTop, clipBottom] of [
        [GREEN_BG, chartArea.top, yZero],
        [RED_BG, yZero, chartArea.bottom],
      ]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, clipTop, chartArea.width, clipBottom - clipTop);
        ctx.clip();
        ctx.beginPath();
        tracePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }
    },
  };

  const ctx = document.getElementById('chart-pnl').getContext('2d');
  if (pnlChart) pnlChart.destroy();
  pnlChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: iLabels,
      datasets: [{
        label: '累計損益',
        data: iData,
        borderColor: GREEN,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointRadius: iData.map(v => v === 0 ? 0 : 3),
        pointBackgroundColor: iData.map(v => v >= 0 ? GREEN : RED),
        pointBorderColor: iData.map(v => v >= 0 ? GREEN : RED),
        segment: { borderColor: segColor },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { filter: item => iData[item.dataIndex] !== 0 },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan:  { enabled: true, mode: 'x' },
        },
      },
      scales: { y: { beginAtZero: false } },
    },
    plugins: [greenRedFill],
  });
}

function renderSportChart() {
  const countMap = {}, amountMap = {};

  // 的中数集計
  const addCount = (key, result) => {
    if (result !== 'win' && result !== 'loss') return;
    if (!countMap[key]) countMap[key] = { win: 0, loss: 0 };
    countMap[key][result]++;
  };
  for (const bet of _bets) {
    if (bet.type === 'parlay' && Array.isArray(bet.legs)) {
      for (const leg of bet.legs) addCount(getStatKey(leg.sport, leg.league), leg.legResult);
    } else {
      addCount(getStatKey(bet.sport, bet.league), bet.result);
    }
  }

  // 勝敗額集計
  for (const bet of _bets) {
    const pnl = calcPnl(bet);
    if (pnl === null) continue;
    if (bet.type === 'parlay' && Array.isArray(bet.legs) && bet.legs.length > 0) {
      if (pnl < 0) {
        const nonWinLegs = bet.legs.filter(l => l.legResult !== 'win');
        const targets = nonWinLegs.length > 0 ? nonWinLegs : bet.legs;
        const share = Math.abs(pnl) / targets.length;
        for (const leg of targets) {
          const key = getStatKey(leg.sport, leg.league);
          if (!amountMap[key]) amountMap[key] = { win: 0, loss: 0 };
          amountMap[key].loss += share;
        }
      } else if (pnl > 0) {
        const share = pnl / bet.legs.length;
        for (const leg of bet.legs) {
          const key = getStatKey(leg.sport, leg.league);
          if (!amountMap[key]) amountMap[key] = { win: 0, loss: 0 };
          amountMap[key].win += share;
        }
      }
    } else {
      const key = getStatKey(bet.sport, bet.league);
      if (!amountMap[key]) amountMap[key] = { win: 0, loss: 0 };
      if (pnl > 0) amountMap[key].win  += pnl;
      else if (pnl < 0) amountMap[key].loss += Math.abs(pnl);
    }
  }

  // 的中数グラフ
  const countKeys = Object.keys(countMap);
  const ctxCount = document.getElementById('chart-sport-count').getContext('2d');
  if (sportChart) sportChart.destroy();
  sportChart = new Chart(ctxCount, {
    type: 'bar',
    data: {
      labels: countKeys,
      datasets: [
        { label: '勝', data: countKeys.map(k => countMap[k].win),  backgroundColor: 'rgba(39,174,96,0.8)' },
        { label: '負', data: countKeys.map(k => countMap[k].loss), backgroundColor: 'rgba(231,76,60,0.8)' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
      plugins: { legend: { position: 'top' } },
    },
  });

  // 勝敗額グラフ
  const amountKeys = Object.keys(amountMap);
  const ctxAmount = document.getElementById('chart-sport-amount').getContext('2d');
  if (sportAmountChart) sportAmountChart.destroy();
  sportAmountChart = new Chart(ctxAmount, {
    type: 'bar',
    data: {
      labels: amountKeys,
      datasets: [
        { label: '利益', data: amountKeys.map(k => amountMap[k].win),  backgroundColor: 'rgba(39,174,96,0.8)' },
        { label: '損失', data: amountKeys.map(k => amountMap[k].loss), backgroundColor: 'rgba(231,76,60,0.8)' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: false },
        y: { beginAtZero: true, ticks: { callback: v => '¥' + v.toLocaleString() } },
      },
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ¥${Math.round(ctx.parsed.y).toLocaleString()}` } },
      },
    },
  });
}

function renderStatsTable() {
  const sportMap = {};
  for (const bet of _bets) {
    if (bet.type === 'parlay' && Array.isArray(bet.legs)) {
      // 勝敗数: 各レッグごとに計上
      for (const leg of bet.legs) {
        const key = getTableKey(leg.sport, leg.league);
        if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
        sportMap[key][leg.legResult || 'pending']++;
      }
      // 損益: グラフと同じ分配ロジック
      const pnl = calcPnl(bet);
      if (pnl !== null && bet.legs.length > 0) {
        if (pnl < 0) {
          const nonWinLegs = bet.legs.filter(l => l.legResult !== 'win');
          const targets = nonWinLegs.length > 0 ? nonWinLegs : bet.legs;
          const share = pnl / targets.length;
          const stakeShare = bet.stake / targets.length;
          for (const leg of targets) {
            const key = getTableKey(leg.sport, leg.league);
            if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
            sportMap[key].pnl   += share;
            sportMap[key].stake += stakeShare;
          }
        } else if (pnl > 0) {
          const share = pnl / bet.legs.length;
          const stakeShare = bet.stake / bet.legs.length;
          for (const leg of bet.legs) {
            const key = getTableKey(leg.sport, leg.league);
            if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
            sportMap[key].pnl   += share;
            sportMap[key].stake += stakeShare;
          }
        }
      }
    } else {
      const key = getTableKey(bet.sport, bet.league);
      if (!sportMap[key]) sportMap[key] = { win: 0, loss: 0, void: 0, pending: 0, pnl: 0, stake: 0 };
      const s = sportMap[key];
      s[bet.result]++;
      const pnl = calcPnl(bet);
      if (pnl !== null) { s.pnl += pnl; s.stake += bet.stake; }
    }
  }
  document.getElementById('stats-table-title').textContent =
    (_statsTableGroupBy === 'sport' ? 'スポーツ別' : 'リーグ別') + ' 内訳';
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

    // 先頭セルが日付パターンなら currentDate を更新（"5/29" と "5月29日" 両形式に対応）
    const firstText = allCells[0].textContent
      .replace(/（[^）]*）|\([^)]*\)/g, '')
      .replace(/／/g, '/')
      .trim();
    const dateMatch = firstText.match(/^(\d{1,2})[\/月](\d{1,2})日?$/);
    if (dateMatch) currentDate = `${dateMatch[1]}/${dateMatch[2]}`;

    if (currentDate !== targetDate) continue;

    // tds[0]=チーム名、tds[1]=球場・時刻（th有無に関わらず一定）
    const tds = row.querySelectorAll('td');
    if (tds.length < 1) continue;

    // チーム名抽出（&nbsp; を空白に正規化してから "-" で分割）
    // 過去の試合は "チームA 3－2 チームB" のようにスコアが混入するので端の数字を除去する
    const teamRaw = tds[0].textContent.replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
    const teamParts = teamRaw.split(/\s*[－-]\s*/);
    const away = teamParts[0]?.replace(/\s*\d+\s*$/, '').replace(/^\s*\d+\s*/, '').trim();
    const home = teamParts[teamParts.length - 1]?.replace(/\s*\d+\s*$/, '').replace(/^\s*\d+\s*/, '').trim();
    if (!away || !home || away === home || /\d/.test(away) || /\d/.test(home)) continue;

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

// ---- 🏀 バスケ（ESPN: NBA + Bリーグ + 国際）----
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

// ESPN の国際バスケリーグ slug → 表示リーグ名 のマッピング
const INTL_BBALL_ESPN = [
  { id: 'mens-fiba-world-cup',                label: 'FIBA World Cup'    },
  { id: 'fiba-world-cup-qualifying-europe',   label: 'FIBA WC Qualifier' },
  { id: 'fiba-world-cup-qualifying-americas', label: 'FIBA WC Qualifier' },
  { id: 'fiba-world-cup-qualifying-asia',     label: 'FIBA WC Qualifier' },
  { id: 'fiba-world-cup-qualifying-africa',   label: 'FIBA WC Qualifier' },
  { id: 'fiba-world-cup-qualifying-oceania',  label: 'FIBA WC Qualifier' },
  { id: 'mens-fiba-eurobasket',               label: 'EuroBasket'        },
  { id: 'mens-fiba-asia-cup',                 label: 'FIBA Asia Cup'     },
  { id: 'mens-fiba-americup',                 label: 'FIBA AmeriCup'     },
  { id: 'mens-fiba-africa',                   label: 'FIBA AfroBasket'   },
  { id: 'mens-basketball-olympics',           label: 'Olympics'          },
];

async function fetchBasketballInternational(dateStr) {
  const results = await Promise.allSettled(
    INTL_BBALL_ESPN.map(({ id, label }) =>
      fetchESPN('basketball', id, dateStr)
        .then(evs => evs.map(ev => ({ ...ev, league: label, sportKey: 'Basketball' })))
    )
  );
  // 開催中の大会だけデータが返る。404は [] なので自動でスキップ
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

async function fetchBasketballIntlApi(dateStr) {
  try {
    const res = await fetch(`/.netlify/functions/basketball-international?date=${dateStr}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map(ev => ({ ...ev, sportKey: 'Basketball' }));
  } catch { return []; }
}

const BBALL_DOMESTIC_RE = /\bnba\b|b\.?league|euroleague|eurocup|ncaa|g[-\s]?league/i;

async function fetchBasketball(dateStr) {
  const [nba, bLeague, intlEspn, intlApi, tsdbEvs] = await Promise.all([
    fetchESPN('basketball', 'nba', dateStr)
      .then(evs => evs.map(ev => ({ ...ev, league: 'NBA', sportKey: 'Basketball' })))
      .catch(() => []),
    fetchBLeagueData(dateStr).catch(() => []),
    fetchBasketballInternational(dateStr).catch(() => []),
    fetchBasketballIntlApi(dateStr).catch(() => []),
    // TheSportsDB: 無料・キー不要・FIBA予選も収録
    fetchTSDB('Basketball', dateStr)
      .then(evs => evs
        .filter(ev => !BBALL_DOMESTIC_RE.test(ev.league || ''))
        .map(ev => ({ ...ev, sportKey: 'Basketball' }))
      ).catch(() => []),
  ]);

  // 全ソースをタイトルで重複除去（先着優先）
  const seen = new Set();
  const all  = [...nba, ...bLeague, ...intlEspn, ...intlApi, ...tsdbEvs];
  return all.filter(ev => {
    const key = ev.title?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

async function fetchSofascoreTennis(dateStr) {
  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${dateStr}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map(ev => {
      const home = ev.homeTeam?.name || '';
      const away = ev.awayTeam?.name || '';
      const title = home && away ? `${home} vs ${away}` : (ev.slug || '');
      const cat = ev.tournament?.category?.name || 'Tennis';
      const tournName = ev.tournament?.name || '';
      // カテゴリを5種類に集約
      const simpleCat = /^ATP/i.test(cat) ? 'ATP' : /^WTA/i.test(cat) ? 'WTA'
        : /^Challenger/i.test(cat) ? 'Challenger' : /^ITF/i.test(cat) ? 'ITF'
        : /^UTR/i.test(cat) ? 'UTR' : 'Other';
      // Grand Slam は大会名を正規化して付加
      const gsName = /french open|roland.garros/i.test(tournName) ? 'Roland Garros'
        : /wimbledon/i.test(tournName) ? 'Wimbledon'
        : /us open/i.test(tournName) ? 'US Open'
        : /australian open/i.test(tournName) ? 'Australian Open' : null;
      const league = gsName ? `${simpleCat} - ${gsName}` : simpleCat;
      const startUtc = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
      return { title, league, startUtc, dateStr, sportKey: 'Tennis' };
    }).filter(ev => ev.title);
  } catch { return []; }
}

async function fetchTennis(dateStr) {
  const [espnResults, tsdbEvs, sofaEvs] = await Promise.all([
    Promise.all(
      TENNIS_ESPN.map(async ({ id, label }) => {
        const evs = await fetchESPNTennisEvents(id, dateStr);
        return evs.map(ev => ({ ...ev, league: ev.tournament ? `${ev.tournament} (${label})` : label, sportKey: 'Tennis' }));
      })
    ),
    fetchTSDB('Tennis', dateStr),
    fetchSofascoreTennis(dateStr),
  ]);
  const espnFlat  = espnResults.flat();
  const tsdbFlat  = tsdbEvs.map(ev => ({ ...ev, sportKey: 'Tennis' }));
  // ESPN優先、次にSofascore・TSDB でタイトル重複を除いて追加
  const seen = new Set(espnFlat.map(e => e.title));
  const extra = [...sofaEvs, ...tsdbFlat].filter(e => {
    if (seen.has(e.title)) return false;
    seen.add(e.title);
    return true;
  });
  return [...espnFlat, ...extra];
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

// ---- 🏐 バレー（Netlify Function → api-sports.io + TheSportsDB）----
const VBALL_LEAGUE_MAP = [
  { re: /nations league/i,                         name: 'VNL' },
  { re: /world champ|world championship|olympic/i, name: 'World Champ / Olympics' },
  { re: /champions league/i,                       name: 'CEV Champions League' },
  { re: /superliga|super liga/i,                   name: 'Italian SuperLega' },
  { re: /sv.?league|v.?league/i,                  name: 'SV.League' },
];
function mapVLeague(l) {
  for (const { re, name } of VBALL_LEAGUE_MAP) { if (re.test(l)) return name; }
  return l;
}
// チーム名を正規化して重複判定（"Volleyball Women" と "W" の表記ゆれに対応）
function normalizeVTitle(title) {
  return title.toLowerCase()
    .replace(/\bvolleyball\b\s*/gi, '')
    .replace(/\bwomen\b/gi, 'w')
    .replace(/\bmen\b/gi, 'm')
    .replace(/\s+/g, ' ').trim();
}

async function fetchSofascoreVolleyball(dateStr) {
  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/sport/volleyball/scheduled-events/${dateStr}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map(ev => {
      const home      = ev.homeTeam?.name || '';
      const away      = ev.awayTeam?.name || '';
      const title     = home && away ? `${home} vs ${away}` : '';
      const tournName = ev.tournament?.name || '';
      const cat       = ev.tournament?.category?.name || '';
      const league    = mapVLeague(tournName || cat);
      const startUtc  = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
      return { title, league, startUtc, dateStr, sportKey: 'Volleyball' };
    }).filter(ev => ev.title);
  } catch { return []; }
}

async function fetchVolleyball(dateStr) {
  const [netlifyRes, sofaEvs, tsdbEvs] = await Promise.all([
    fetch(`/.netlify/functions/volleyball-schedule?date=${dateStr}`).then(r => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
    fetchSofascoreVolleyball(dateStr),
    fetchTSDB('Volleyball', dateStr),
  ]);
  const apiEvs     = (netlifyRes.events || []).map(ev => ({ ...ev, sportKey: 'Volleyball' }));
  const tsdbMapped = tsdbEvs.map(ev => ({ ...ev, league: mapVLeague(ev.league || ''), sportKey: 'Volleyball' }));

  // api-sports.io 優先 → Sofascore(ブラウザ) → TSDB の順で重複除去しながら合成
  const seen = new Set(apiEvs.map(e => normalizeVTitle(e.title)));
  const addIfNew = (list) => list.filter(e => {
    const norm = normalizeVTitle(e.title);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
  return [...apiEvs, ...addIfNew(sofaEvs), ...addIfNew(tsdbMapped)];
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

// 全スポーツを1日分フェッチ（生データ）
function fetchAllRaw(dateStr) {
  return Promise.all(
    SCHEDULE_SPORTS.map(s => SPORT_FETCHERS[s.key](dateStr).catch(() => []))
  ).then(r => r.flat());
}

// 日付文字列の試合一覧を取得（JST補正・キャッシュ込み）
async function fetchEventsForDate(dateStr) {
  if (scheduleCache[dateStr]) return scheduleCache[dateStr];
  const prevDate    = new Date(new Date(dateStr + 'T00:00:00').getTime() - 24 * 60 * 60 * 1000);
  const prevDateStr = schedDateStr(prevDate);
  const [curr, prev] = await Promise.all([fetchAllRaw(dateStr), fetchAllRaw(prevDateStr)]);
  const seen = new Set();
  const evs = [...curr, ...prev].filter(ev => {
    if (!(ev.startUtc ? utcToJSTDateStr(ev.startUtc) === dateStr : ev.dateStr === dateStr)) return false;
    const key = `${ev.sportKey}|${ev.title}|${ev.startUtc || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  scheduleCache[dateStr] = evs;
  return evs;
}

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

  scheduledEvs = await fetchEventsForDate(dateStr);
  leagueFilter.clear();
  renderLeagueFilters();
  renderSportsEvents();
  if (gcalTokenBet) syncGcalState(dateStr);
}

// ---- 試合ピッカー ----
const SPORT_KEY_TO_FORM = {
  Soccer: 'Football', Baseball: 'Baseball', Basketball: 'Basketball', Tennis: 'Tennis',
  Volleyball: 'Volleyball', TableTennis: 'TableTennis', Rugby: 'Rugby',
};

let pickerDate         = new Date();
let pickerSportFilter  = 'all';
let pickerLeagueFilter = 'all';
let pickerCallback     = null;

function openMatchPicker(initialDate, callback) {
  pickerDate         = initialDate || new Date();
  pickerCallback     = callback;
  pickerSportFilter  = 'all';
  pickerLeagueFilter = 'all';
  document.getElementById('match-picker-backdrop').removeAttribute('hidden');
  document.getElementById('match-picker').removeAttribute('hidden');
  loadPickerEvents();
}

function closeMatchPicker() {
  document.getElementById('match-picker-backdrop').setAttribute('hidden', '');
  document.getElementById('match-picker').setAttribute('hidden', '');
  pickerCallback = null;
}

async function loadPickerEvents() {
  const dateStr = schedDateStr(pickerDate);
  document.getElementById('picker-date-display').textContent = schedDateLabel(pickerDate);
  document.getElementById('picker-events').innerHTML = '<div class="picker-loading">読み込み中...</div>';
  const evs = await fetchEventsForDate(dateStr);
  pickerLeagueFilter = 'all';
  renderPickerSportFilters(evs);
  renderPickerLeagueFilters(evs);
  renderPickerEvents(evs);
}

function renderPickerSportFilters(evs) {
  const presentKeys = [...new Set(evs.map(e => e.sportKey))];
  const container   = document.getElementById('picker-sport-filters');
  if (presentKeys.length <= 1) { container.innerHTML = ''; return; }

  const allActive = pickerSportFilter === 'all' ? ' active' : '';
  container.innerHTML = `<button class="picker-filter-btn${allActive}" data-key="all">すべて</button>` +
    SCHEDULE_SPORTS
      .filter(s => presentKeys.includes(s.key))
      .map(s => {
        const active = pickerSportFilter === s.key ? ' active' : '';
        return `<button class="picker-filter-btn${active}" data-key="${s.key}">${s.icon}</button>`;
      }).join('');

  container.querySelectorAll('.picker-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pickerSportFilter  = btn.dataset.key;
      pickerLeagueFilter = 'all';
      renderPickerSportFilters(evs);
      renderPickerLeagueFilters(evs);
      renderPickerEvents(evs);
    });
  });
}

function renderPickerLeagueFilters(evs) {
  const container = document.getElementById('picker-league-filters');
  const base      = pickerSportFilter === 'all' ? evs : evs.filter(e => e.sportKey === pickerSportFilter);
  const leagues   = [...new Set(base.map(e => e.league).filter(Boolean))].sort();

  if (leagues.length <= 1) { container.innerHTML = ''; return; }

  const allActive = pickerLeagueFilter === 'all' ? ' active' : '';
  container.innerHTML = `<button class="picker-league-btn${allActive}" data-league="all">すべて</button>` +
    leagues.map(l => {
      const active = pickerLeagueFilter === l ? ' active' : '';
      return `<button class="picker-league-btn${active}" data-league="${escapeHtml(l)}">${escapeHtml(l)}</button>`;
    }).join('');

  container.querySelectorAll('.picker-league-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pickerLeagueFilter = btn.dataset.league;
      renderPickerLeagueFilters(evs);
      renderPickerEvents(evs);
    });
  });
}

function renderPickerEvents(evs) {
  const container = document.getElementById('picker-events');
  let filtered    = pickerSportFilter === 'all' ? evs : evs.filter(e => e.sportKey === pickerSportFilter);
  if (pickerLeagueFilter !== 'all') filtered = filtered.filter(e => e.league === pickerLeagueFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="picker-empty">この日の試合情報はありません</div>';
    return;
  }

  const groups = {};
  for (const ev of filtered) {
    if (!groups[ev.sportKey]) groups[ev.sportKey] = [];
    groups[ev.sportKey].push(ev);
  }

  let html = '';
  for (const { key, icon, label } of SCHEDULE_SPORTS.filter(s => groups[s.key])) {
    const sorted = groups[key].sort((a, b) => {
      if (!a.startUtc && !b.startUtc) return 0;
      if (!a.startUtc) return 1;
      if (!b.startUtc) return -1;
      return a.startUtc.localeCompare(b.startUtc);
    });
    html += `<div class="picker-sport-label">${icon} ${label}</div>`;
    for (const ev of sorted) {
      const time = utcToJSTDisplay(ev.startUtc);
      html += `<button type="button" class="picker-match-btn"
        data-title="${escapeHtml(ev.title)}"
        data-sport="${ev.sportKey}"
        data-league="${escapeHtml(ev.league || '')}">
        <span class="picker-match-main">
          ${ev.league ? `<span class="picker-league">${escapeHtml(ev.league)}</span>` : ''}
          <span class="picker-teams">${escapeHtml(ev.title)}</span>
        </span>
        ${time ? `<span class="picker-time">${time}</span>` : ''}
      </button>`;
    }
  }
  container.innerHTML = html;

  container.querySelectorAll('.picker-match-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pickerCallback?.({ title: btn.dataset.title, sportKey: btn.dataset.sport, league: btn.dataset.league });
      closeMatchPicker();
    });
  });
}

function applyMatchToSingleForm({ title, sportKey }) {
  const formSport = SPORT_KEY_TO_FORM[sportKey] || 'Other';
  document.querySelector('[name="sport"]').value = formSport;
  updateLeagueSelect(formSport);
  document.getElementById('single-match-input').value = title;
  const disp = document.getElementById('single-match-display');
  disp.textContent = title;
  disp.classList.remove('match-none-label');
  document.getElementById('btn-clear-match-single').removeAttribute('hidden');
}

function applyMatchToLeg(legItem, { title, sportKey, league }) {
  const formSport = SPORT_KEY_TO_FORM[sportKey] || 'Other';
  const sportSel  = legItem.querySelector('[data-field="sport"]');
  sportSel.value  = formSport;
  const leagueSel  = legItem.querySelector('[data-field="league"]');
  const leagueWrap = legItem.querySelectorAll('.form-row > .form-group')[0];
  if (getLeagues()[formSport]) {
    leagueSel.innerHTML = leagueOptions(formSport);
    leagueWrap.style.visibility = '';
  }
  legItem.querySelector('[data-field="match"]').value = title;
  const disp = legItem.querySelector('.leg-match-display');
  disp.textContent = title;
  disp.classList.remove('match-none-label');
  legItem.querySelector('.btn-clear-match-leg').removeAttribute('hidden');
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
    if (!gcTokenClientBet) { await showAlert('Googleカレンダーに接続できません'); return; }
    gcTokenClientBet.requestAccessToken({ prompt: 'consent' });
    await showAlert('ログイン後、もう一度ボタンを押してください');
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
      await showAlert('認証期限切れです。再ログインしてください。');
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
      await showAlert(`追加に失敗しました（${errData.error?.message || res.status}）`);
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
      await showAlert('認証期限切れです。再ログインしてください。');
    } else {
      btn.textContent = '🗑 削除'; btn.disabled = false;
      await showAlert('削除に失敗しました');
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

  document.getElementById('gcal-login-btn').addEventListener('click', async () => {
    if (!gcTokenClientBet) {
      await showAlert('Googleカレンダーの初期化中です。しばらく待ってから再試行してください。');
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
  document.querySelectorAll('.stats-toggle-btn[data-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-toggle-btn[data-group]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _statsGroupBy = btn.dataset.group;
      renderSportChart();
      renderPeriodStats();
      renderGoalProgress();
    });
  });

  document.querySelectorAll('.stats-toggle-btn[data-table-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-toggle-btn[data-table-group]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _statsTableGroupBy = btn.dataset.tableGroup;
      renderStatsTable();
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
      renderBalanceChart();
    });
  });

  document.getElementById('btn-reset-pnl-zoom')?.addEventListener('click', () => pnlChart?.resetZoom());
  document.getElementById('btn-reset-balance-zoom')?.addEventListener('click', () => balanceChart?.resetZoom());

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
      if (btn.dataset.tab === 'ai') {
        renderAI();
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
  document.querySelectorAll('.pnl-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _pnlMode = btn.dataset.mode;
      renderPnlStatement();
    });
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

  // 試合ピッカー
  document.getElementById('btn-pick-match-single').addEventListener('click', () => {
    const betDate = document.querySelector('[name="date"]').value;
    const d = betDate ? new Date(betDate + 'T00:00:00') : new Date();
    openMatchPicker(d, applyMatchToSingleForm);
  });
  document.getElementById('btn-clear-match-single').addEventListener('click', () => {
    document.getElementById('single-match-input').value = '';
    const disp = document.getElementById('single-match-display');
    disp.textContent = '未選択';
    disp.classList.add('match-none-label');
    document.getElementById('btn-clear-match-single').setAttribute('hidden', '');
  });
  document.getElementById('picker-prev').addEventListener('click', () => {
    pickerDate.setDate(pickerDate.getDate() - 1);
    loadPickerEvents();
  });
  document.getElementById('picker-next').addEventListener('click', () => {
    pickerDate.setDate(pickerDate.getDate() + 1);
    loadPickerEvents();
  });
  document.getElementById('picker-cancel').addEventListener('click', closeMatchPicker);
  document.getElementById('match-picker-backdrop').addEventListener('click', closeMatchPicker);

  document.getElementById('btn-add-league').addEventListener('click', async () => {
    const sport = document.querySelector('select[name="sport"]').value;
    const name  = await showPrompt(`「${sport}」に追加するリーグ名を入力してください`);
    if (!name || !name.trim()) return;
    await addLeague(sport, name.trim());
    updateLeagueSelect(sport, name.trim());
  });

  document.getElementById('bet-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f      = e.target;
    const submitBtn = f.querySelector('[type="submit"]');
    if (submitBtn.disabled) return; // 二重送信防止
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中…';

    const type = f.querySelector('input[name="type"]:checked').value;
    let bet;

    if (type === 'parlay') {
      const legs = getLegsFromForm();
      if (legs.length < 2)                                 { await showAlert('マルチは2レッグ以上必要です'); submitBtn.disabled = false; submitBtn.textContent = '保存'; return; }
      if (legs.some(l => isNaN(l.odds) || l.odds < 1.01)) { await showAlert('すべてのレッグにオッズを入力してください'); submitBtn.disabled = false; submitBtn.textContent = '保存'; return; }
      const combinedOdds = Math.round(legs.reduce((acc, l) => acc * l.odds, 1) * 100) / 100;
      const comboBoost   = parseFloat(document.getElementById('input-combo-boost').value) || null;
      const campaignIdP  = f.elements.campaignId.value || null;
      const isFreebetP   = document.getElementById('input-is-freebet').checked;
      bet = { type: 'parlay', date: f.elements.date.value, legs, combinedOdds, comboBoost,
              stake: parseInt(f.elements.stake.value), isFreebet: isFreebetP,
              campaignId: campaignIdP,
              result: f.elements.result.value, memo: f.elements.memo.value.trim() };
    } else {
      if (!f.elements.odds.value) { await showAlert('オッズを入力してください'); submitBtn.disabled = false; submitBtn.textContent = '保存'; return; }
      const sport      = f.elements.sport.value;
      const leagueSel  = document.getElementById('single-league-select');
      const campaignId = f.elements.campaignId.value || null;
      const isFreebet  = document.getElementById('input-is-freebet').checked;
      bet = { type: 'single', date: f.elements.date.value, sport,
              league: (getLeagues()[sport] !== undefined && leagueSel?.value) ? leagueSel.value : null,
              match: f.elements.match_name?.value?.trim() || null, bet: f.elements.bet.value,
              odds: parseFloat(f.elements.odds.value),
              stake: parseInt(f.elements.stake.value), isFreebet,
              campaignId,
              result: f.elements.result.value, memo: f.elements.memo.value.trim() };
    }

    const id = f.elements.id.value;
    if (id) await updateBet(id, bet); else await addBet(bet);
    submitBtn.disabled = false;
    submitBtn.textContent = '保存';
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
    f.elements.campaignStart.value = todayJST();
    refreshAll();
  });
  document.querySelector('#campaign-add-form [name="campaignStart"]').value = todayJST();

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
  populateSportSelect();
  populateSettings();
  refreshAll();

  // 最初のタブを表示
  document.getElementById('tab-records').hidden = false;

  // データ更新ボタン
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    await loadAll();
    populateSettings();
    refreshAll();
    btn.classList.remove('spinning');
  });
});
