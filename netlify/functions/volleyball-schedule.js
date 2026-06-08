const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const LEAGUE_MAP = [
  { re: /vnl|nations league/i,                           name: 'VNL' },
  { re: /world champ|world championship|olympic/i,        name: 'World Champ / Olympics' },
  { re: /cev.*champions|champions.*league/i,              name: 'CEV Champions League' },
  { re: /superliga|super liga/i,                          name: 'Italian SuperLega' },
  { re: /sv.?league|v.?league/i,                         name: 'SV.League' },
];

function mapLeague(tournName, cat) {
  for (const { re, name } of LEAGUE_MAP) {
    if (re.test(tournName)) return name;
  }
  return tournName || cat || 'Volleyball';
}

export default async (req) => {
  const url  = new URL(req.url);
  const date = url.searchParams.get('date');
  if (!date) return new Response(JSON.stringify({ events: [] }), { headers: OK_HEADERS });

  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/sport/volleyball/scheduled-events/${date}`,
      {
        headers: {
          'Accept':     'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return new Response(JSON.stringify({ events: [] }), { headers: OK_HEADERS });

    const data = await res.json();
    const events = (data.events || []).map(ev => {
      const home       = ev.homeTeam?.name || '';
      const away       = ev.awayTeam?.name || '';
      const title      = home && away ? `${home} vs ${away}` : (ev.slug || '');
      const tournName  = ev.tournament?.name || '';
      const cat        = ev.tournament?.category?.name || '';
      const league     = mapLeague(tournName, cat);
      const startUtc   = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
      return { title, league, startUtc, dateStr: date };
    }).filter(ev => ev.title);

    return new Response(JSON.stringify({ events }), { headers: OK_HEADERS });
  } catch {
    return new Response(JSON.stringify({ events: [] }), { headers: OK_HEADERS });
  }
};

export const config = { path: '/api/volleyball-schedule' };
