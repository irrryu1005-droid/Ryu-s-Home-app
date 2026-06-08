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

  // 過去日付は status=FT（終了済み）も指定して取得
  const today = new Date().toISOString().slice(0, 10);
  const url   = date < today
    ? `https://v1.volleyball.api-sports.io/games?date=${date}&status=FT`
    : `https://v1.volleyball.api-sports.io/games?date=${date}`;

  try {
    const res = await fetch(url,
      {
        headers: {
          'x-apisports-key': apiKey,
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: `api-${res.status}` }) };

    const data   = await res.json();
    const events = (data.response || []).map(g => {
      const home      = g.teams?.home?.name || '';
      const away      = g.teams?.away?.name || '';
      const title     = home && away ? `${home} vs ${away}` : '';
      const league    = mapLeague(g.league?.name || '');
      const startUtc  = g.date || null;
      return { title, league, startUtc, dateStr: date };
    }).filter(ev => ev.title);

    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events, debug: `ok-${events.length}` }) };
  } catch (e) {
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: `catch: ${e?.message || e}` }) };
  }
};
