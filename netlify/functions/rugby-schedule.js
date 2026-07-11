const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// 含めるコンペティション（部分一致）
const INCLUDE_RE = /nations championship|nations cup|rugby championship|six nations|world rugby/i;
// 除外するコンペティション
const EXCLUDE_RE = /women|u20|under.?20|super rugby|aupiki/i;

exports.handler = async (event) => {
  const date = (event.queryStringParameters || {}).date;
  if (!date) return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ error: 'date required' }) };

  try {
    const url = `https://api.wr-rims-prod.pulselive.com/rugby/v3/match?language=ja&startDate=${date}&endDate=${date}`;
    const res = await fetch(url, {
      headers: {
        'Origin': 'https://www.world.rugby',
        'Referer': 'https://www.world.rugby/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!res.ok) return { statusCode: res.status, headers: OK_HEADERS, body: JSON.stringify({ events: [] }) };

    const data = await res.json();
    const allContent = data.content || [];
    const allCompNames = allContent.map(m => (m.events || []).map(e => e.label || '').join(' / '));
    const matches = allContent.filter(m => {
      const compName = (m.events || []).map(e => e.label || '').join(' ');
      return INCLUDE_RE.test(compName) && !EXCLUDE_RE.test(compName);
    }).map(m => {
      const teams = (m.teams || []).map(t => t.name || '').filter(Boolean);
      const compName = (m.events || []).map(e => e.label || '').join(' / ');
      const millis = m.time?.millis;
      return {
        title:    teams.join(' vs '),
        league:   compName,
        startUtc: millis ? new Date(millis).toISOString() : null,
        dateStr:  date,
      };
    });

    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: matches, debug: { total: allContent.length, compNames: allCompNames } }) };
  } catch (e) {
    return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ events: [], error: e.message }) };
  }
};
