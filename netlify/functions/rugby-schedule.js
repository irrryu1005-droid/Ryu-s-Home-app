const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// Rugby League系は除外
const EXCLUDE_RE = /super league|nrl|state of origin|league cup|women|u20|under.?20|aupiki/i;

exports.handler = async (event) => {
  const date = (event.queryStringParameters || {}).date;
  if (!date) return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ error: 'date required' }) };

  const apiKey = process.env.VOLLEYBALL_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ events: [], error: 'API key not set' }) };

  try {
    const url = `https://v1.rugby.api-sports.io/games?date=${date}`;
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });

    if (!res.ok) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: { apiStatus: res.status, source: 'api-sports-rugby' } }) };

    const data = await res.json();
    const allGames = data.response || [];

    const matches = allGames
      .filter(g => {
        const league = g.league?.name || '';
        return !EXCLUDE_RE.test(league);
      })
      .map(g => ({
        title:    `${g.teams?.home?.name || ''} vs ${g.teams?.away?.name || ''}`,
        league:   g.league?.name || 'Rugby',
        startUtc: g.date || null,
        dateStr:  date,
      }));

    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: matches, debug: { total: allGames.length, filtered: matches.length, source: 'api-sports-rugby' } }) };
  } catch (e) {
    return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ events: [], error: e.message }) };
  }
};
