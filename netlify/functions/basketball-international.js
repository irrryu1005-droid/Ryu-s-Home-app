const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// api-sports.io のリーグ名 → アプリ表示名
const LEAGUE_MAP = [
  { re: /world cup.*qualif|qualif.*world cup/i, name: 'FIBA WC Qualifier' },
  { re: /world cup/i,                           name: 'FIBA World Cup'    },
  { re: /eurobasket|euro basket/i,              name: 'EuroBasket'        },
  { re: /asia.*cup|asian.*cup/i,                name: 'FIBA Asia Cup'     },
  { re: /americup|america.*cup/i,               name: 'FIBA AmeriCup'     },
  { re: /afrobasket|africa.*cup/i,              name: 'FIBA AfroBasket'   },
  { re: /olympic/i,                             name: 'Olympics'          },
  { re: /fiba/i,                                name: 'FIBA'              },
];

// NBA・Bリーグ・国内リーグは別関数で取得するので除外
const DOMESTIC_RE = /\bnba\b|b\.?league|euroleague|eurocup|ncaa|g[-\s]?league/i;

function mapLeague(leagueName) {
  if (!leagueName) return null;
  if (DOMESTIC_RE.test(leagueName)) return null; // 国内リーグは除外
  for (const { re, name } of LEAGUE_MAP) {
    if (re.test(leagueName)) return name;
  }
  return leagueName; // マッチしなければ元の名前をそのまま使う
}

exports.handler = async (event) => {
  const date   = (event.queryStringParameters || {}).date;
  const apiKey = process.env.VOLLEYBALL_API_KEY; // api-sports.io は全スポーツ共通キー

  if (!date)   return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: 'no-date' }) };
  if (!apiKey) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: 'no-api-key' }) };

  const BASE = 'https://v1.basketball.api-sports.io/games';
  const fetchGames = (url) =>
    fetch(url, { headers: { 'x-apisports-key': apiKey }, signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : { response: [] })
      .catch(() => ({ response: [] }));

  try {
    const [defData, ftData] = await Promise.all([
      fetchGames(`${BASE}?date=${date}`),
      fetchGames(`${BASE}?date=${date}&status=FT`),
    ]);

    const seen   = new Set();
    const events = [];

    for (const g of [...(defData.response || []), ...(ftData.response || [])]) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);

      const league = mapLeague(g.league?.name || '');
      if (!league) continue; // 国内リーグはスキップ

      const home  = g.teams?.home?.name || '';
      const away  = g.teams?.away?.name || '';
      const title = home && away ? `${home} vs ${away}` : '';
      if (!title) continue;

      events.push({ id: g.id, title, league, startUtc: g.date || null, dateStr: date });
    }

    const debugInfo = `ok-${events.length}(def:${(defData.response||[]).length},ft:${(ftData.response||[]).length})`;
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events, debug: debugInfo }) };
  } catch (e) {
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: `catch: ${e?.message || e}` }) };
  }
};
