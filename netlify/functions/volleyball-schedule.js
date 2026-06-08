const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const LEAGUE_MAP = [
  { re: /nations league/i,                          name: 'VNL' },
  { re: /world champ|world championship|olympic/i,  name: 'World Champ / Olympics' },
  { re: /champions league/i,                        name: 'CEV Champions League' },
  { re: /superliga|super liga/i,                    name: 'Italian SuperLega' },
  { re: /sv.?league|v.?league/i,                   name: 'SV.League' },
];

function mapLeague(leagueName) {
  for (const { re, name } of LEAGUE_MAP) {
    if (re.test(leagueName)) return name;
  }
  return leagueName || 'Volleyball';
}

exports.handler = async (event) => {
  const date   = (event.queryStringParameters || {}).date;
  const apiKey = process.env.VOLLEYBALL_API_KEY;

  if (!date)   return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: 'no-date' }) };
  if (!apiKey) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: 'no-api-key' }) };

  const BASE = 'https://v1.volleyball.api-sports.io/games';
  const fetchGames = (url) =>
    fetch(url, { headers: { 'x-apisports-key': apiKey }, signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : { response: [] })
      .catch(() => ({ response: [] }));

  try {
    // デフォルト（未来/ライブ）と status=FT（終了済み）を両方取得してマージ
    // 今日の日付でも終了済み試合が漏れないよう常に両方リクエスト
    const [defData, ftData] = await Promise.all([
      fetchGames(`${BASE}?date=${date}`),
      fetchGames(`${BASE}?date=${date}&status=FT`),
    ]);

    const toEvent = (g) => {
      const home     = g.teams?.home?.name || '';
      const away     = g.teams?.away?.name || '';
      const title    = home && away ? `${home} vs ${away}` : '';
      const league   = mapLeague(g.league?.name || '');
      const startUtc = g.date || null;
      return { id: g.id, title, league, startUtc, dateStr: date };
    };

    const seen = new Set();
    const events = [];
    for (const g of [...(defData.response || []), ...(ftData.response || [])]) {
      if (!seen.has(g.id)) {
        seen.add(g.id);
        const ev = toEvent(g);
        if (ev.title) events.push(ev);
      }
    }

    const debugInfo = `ok-${events.length}(def:${(defData.response||[]).length},ft:${(ftData.response||[]).length})`;
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events, debug: debugInfo }) };
  } catch (e) {
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: `catch: ${e?.message || e}` }) };
  }
};
