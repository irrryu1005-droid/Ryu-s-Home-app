// FotMob XML API → UEFA API → TheSportsDB の順でサッカー試合を取得
const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const MAJOR = /conference league|champions league|europa league|world cup|friendl|nations league|asian cup|copa america|euro\b|concacaf|asian champions|wc qual|world cup qual/i;

// 1) FotMob XML API（apigw.fotmob.com）
async function tryFotMob(date) {
  const d = date.replace(/-/g, '');
  try {
    const res = await fetch(`https://apigw.fotmob.com/matches?date=${d}`, {
      headers: { 'User-Agent': 'FotMob/iOS' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const events = [];
    const leagueRe = /<league\b([^>]+)>([\s\S]*?)<\/league>/g;
    let lm;
    while ((lm = leagueRe.exec(xml)) !== null) {
      const attrs = lm[1];
      const content = lm[2];
      const nameMatch = attrs.match(/\bname="([^"]+)"/);
      if (!nameMatch) continue;
      const league = nameMatch[1];
      const ccodeMatch = attrs.match(/\bccode="([^"]+)"/);
      const ccode = ccodeMatch ? ccodeMatch[1] : '';
      // 国際大会(INT)のみ、またはメジャーリーグ名に一致するものを対象
      if (ccode !== 'INT' && !MAJOR.test(league)) continue;
      if (!MAJOR.test(league)) continue;

      const matchRe = /<match\b([^>]+)\/>/g;
      let mm;
      while ((mm = matchRe.exec(content)) !== null) {
        const ma = mm[1];
        const home = (ma.match(/\bhTeam="([^"]+)"/) || [])[1] || '';
        const away = (ma.match(/\baTeam="([^"]+)"/) || [])[1] || '';
        const timeStr = (ma.match(/\btime="([^"]+)"/) || [])[1] || '';
        // time format: "DD.MM.YYYY HH:MM"
        let startUtc = null;
        const tp = timeStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})/);
        if (tp) startUtc = `${tp[3]}-${tp[2]}-${tp[1]}T${tp[4]}:00Z`;
        if (home && away) events.push({ title: `${away} vs ${home}`, league, startUtc });
      }
    }
    return events;
  } catch { return []; }
}

// 2) UEFA公式Match API（UCL/UEL/UECL）
async function tryUEFA(date) {
  const ids = ['UECL', 'UCL', 'UEL'];
  const events = [];
  for (const id of ids) {
    try {
      const res = await fetch(
        `https://match.uefa.com/v5/matches?competitionId=${id}&fromDate=${date}&toDate=${date}&language=EN&limit=20&offset=0`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const m of (Array.isArray(data) ? data : [])) {
        const home = m.homeTeam?.translations?.nameTranslations?.EN || m.homeTeam?.internationalName || '';
        const away = m.awayTeam?.translations?.nameTranslations?.EN || m.awayTeam?.internationalName || '';
        const league = m.competition?.translations?.nameTranslations?.EN
          || m.competition?.metaData?.titleEN || id;
        const startUtc = m.kickOffTime?.dateTime
          ? new Date(m.kickOffTime.dateTime).toISOString() : null;
        if (home && away) events.push({ title: `${away} vs ${home}`, league, startUtc });
      }
    } catch { continue; }
  }
  return events;
}

// 3) TheSportsDB
async function tryTSDB(date) {
  for (const sport of ['Soccer', 'Football']) {
    try {
      const res = await fetch(
        `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=${sport}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const evs = (data.events || [])
        .filter(ev => MAJOR.test(ev.strLeague || ''))
        .map(ev => ({
          title:    ev.strEvent || `${ev.strHomeTeam || ''} vs ${ev.strAwayTeam || ''}`,
          league:   ev.strLeague || '',
          startUtc: (ev.strTime && ev.strTime !== '00:00:00')
            ? `${ev.dateEvent}T${ev.strTime}Z` : null,
        }));
      if (evs.length > 0) return evs;
    } catch { continue; }
  }
  return [];
}

exports.handler = async (event) => {
  const { date } = event.queryStringParameters || {};
  if (!date) return { statusCode: 400, body: 'date required' };

  // FotMob → UEFA → TSDB の順で試す
  let events = await tryFotMob(date);
  if (events.length === 0) events = await tryUEFA(date);
  if (events.length === 0) events = await tryTSDB(date);

  return {
    statusCode: 200,
    headers: OK_HEADERS,
    body: JSON.stringify({ events }),
  };
};
