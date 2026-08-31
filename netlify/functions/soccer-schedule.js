// ESPN（国内リーグ・カップ・国際大会）をメインに、FotMob XML API → UEFA API → TheSportsDB で補完してサッカー試合を取得
// サーバーサイド(Netlify Function)経由にすることで、ブラウザから直接ESPNへアクセスしてブロックされる問題を回避する
const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const MAJOR = /conference league|champions league|europa league|world cup|friendl|nations league|asian cup|copa america|euro\b|concacaf|asian champions|wc qual|world cup qual/i;

// ---- ESPN: 国内リーグ・カップ・国際大会 ----
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
const UEFA_CUPS = new Set(['uefa.champions', 'uefa.europa', 'uefa.ecl']);

// 同時実行数を制限（サーバー間通信とはいえ一斉アクセスは避ける）
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseESPNEvents(data, league) {
  return (data.events || []).map(ev => {
    const comp  = ev.competitions?.[0];
    const home  = comp?.competitors?.find(c => c.homeAway === 'home');
    const away  = comp?.competitors?.find(c => c.homeAway === 'away');
    const title = (home && away)
      ? `${away.team.displayName} vs ${home.team.displayName}`
      : (ev.name || ev.shortName || '');
    return { title, league, startUtc: ev.date || null };
  });
}

async function fetchESPNLeague(id, label, date) {
  try {
    const d    = date.replace(/-/g, '');
    const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${id}`;
    const res  = await fetch(`${base}/scoreboard?dates=${d}`);
    let evs = [];
    if (res.ok) {
      evs = parseESPNEvents(await res.json(), label);
    } else {
      const res2 = await fetch(`${base}/events?dates=${d}`);
      if (res2.ok) evs = parseESPNEvents(await res2.json(), label);
    }
    // UEFAカップ戦はノックアウト段階を追加で試す
    if (evs.length === 0 && UEFA_CUPS.has(id)) {
      try {
        const r = await fetch(`${base}/scoreboard?dates=${d}&seasontype=3`);
        if (r.ok) evs = parseESPNEvents(await r.json(), label);
      } catch {}
    }
    return evs;
  } catch { return []; }
}

async function tryESPNAll(date) {
  const results = await mapLimited(ESPN_SOCCER_LEAGUES, 5, ({ id, label }) => fetchESPNLeague(id, label, date));
  return results.flat();
}

// ---- FotMob XML API（apigw.fotmob.com）: ESPNで拾えない国際大会の補完用 ----
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

// ---- UEFA公式Match API（UCL/UEL/UECL）: 補完用 ----
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

// ---- TheSportsDB: 補完用 ----
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

  // ESPN（国内リーグ・カップ・国際大会）をメインで取得
  const espnEvents = await tryESPNAll(date);

  // ESPNで拾えなかった国際大会をFotMob → UEFA → TSDBの順で補完
  const espnTitles = new Set(espnEvents.map(e => e.title?.toLowerCase()));
  let supplement = await tryFotMob(date);
  if (supplement.length === 0) supplement = await tryUEFA(date);
  if (supplement.length === 0) supplement = await tryTSDB(date);
  const uniqueSupplement = supplement.filter(e => !espnTitles.has(e.title?.toLowerCase()));

  return {
    statusCode: 200,
    headers: OK_HEADERS,
    body: JSON.stringify({ events: [...espnEvents, ...uniqueSupplement] }),
  };
};
