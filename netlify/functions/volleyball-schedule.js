const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const LEAGUE_MAP = [
  { re: /vnl|nations league/i,                     name: 'VNL' },
  { re: /world champ|world championship|olympic/i,  name: 'World Champ / Olympics' },
  { re: /cev.*champions|champions.*league/i,         name: 'CEV Champions League' },
  { re: /superliga|super liga/i,                    name: 'Italian SuperLega' },
  { re: /sv.?league|v.?league/i,                   name: 'SV.League' },
];

function mapLeague(tournName, cat) {
  for (const { re, name } of LEAGUE_MAP) {
    if (re.test(tournName)) return name;
  }
  return tournName || cat || 'Volleyball';
}

exports.handler = async (event) => {
  const date = (event.queryStringParameters || {}).date;
  if (!date) return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ events: [] }) };

  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/sport/volleyball/scheduled-events/${date}`,
      {
        headers: {
          'Accept':           'application/json, text/plain, */*',
          'Accept-Language':  'en-US,en;q=0.9',
          'Accept-Encoding':  'gzip, deflate, br',
          'User-Agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Referer':          'https://www.sofascore.com/',
          'Origin':           'https://www.sofascore.com',
          'sec-fetch-site':   'same-site',
          'sec-fetch-mode':   'cors',
          'sec-fetch-dest':   'empty',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [], debug: `sofascore ${res.status}` }) };

    const data   = await res.json();
    const events = (data.events || []).map(ev => {
      const home      = ev.homeTeam?.name || '';
      const away      = ev.awayTeam?.name || '';
      const title     = home && away ? `${home} vs ${away}` : (ev.slug || '');
      const tournName = ev.tournament?.name || '';
      const cat       = ev.tournament?.category?.name || '';
      const league    = mapLeague(tournName, cat);
      const startUtc  = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
      return { title, league, startUtc, dateStr: date };
    }).filter(ev => ev.title);

    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events }) };
  } catch {
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ events: [] }) };
  }
};
