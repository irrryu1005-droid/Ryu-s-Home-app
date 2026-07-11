const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const EXCLUDE_RE = /women|u20|under.?20|super league|aupiki/i;

exports.handler = async (event) => {
  const date = (event.queryStringParameters || {}).date;
  if (!date) return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ error: 'date required' }) };

  try {
    const compact = date.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/rugby-union/scoreboard?dates=${compact}`;
    const res = await fetch(url);

    if (!res.ok) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: { apiStatus: res.status, source: 'espn' } }) };

    const data = await res.json();
    const allEvents = data.events || [];

    const matches = allEvents
      .filter(ev => !EXCLUDE_RE.test(ev.name || ''))
      .map(ev => {
        const comp = (ev.competitions || [])[0] || {};
        const competitors = comp.competitors || [];
        const home = competitors.find(c => c.homeAway === 'home');
        const away = competitors.find(c => c.homeAway === 'away');
        const homeTeam = home?.team?.displayName || '';
        const awayTeam = away?.team?.displayName || '';
        const league = (comp.notes || []).map(n => n.headline || '').filter(Boolean).join(' / ')
                    || ev.season?.slug || 'Rugby Union';
        return {
          title:    `${homeTeam} vs ${awayTeam}`,
          league,
          startUtc: comp.date || null,
          dateStr:  date,
        };
      });

    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: matches, debug: { total: allEvents.length, source: 'espn' } }) };
  } catch (e) {
    return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ events: [], error: e.message }) };
  }
};
