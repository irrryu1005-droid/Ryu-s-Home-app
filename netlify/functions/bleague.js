exports.handler = async (event) => {
  const { date } = event.queryStringParameters || {};
  if (!date) return { statusCode: 400, body: 'date が必要です（例: date=2026-05-23）' };

  const [calYear, month, day] = date.split('-').map(Number);
  // シーズン年: 10月〜12月は当年、1月〜9月は前年（例: 2026-05 → 2025）
  const seasonYear = month >= 10 ? calYear : calYear - 1;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  const url = `https://www.bleague.jp/schedule/?data_format=json&year=${seasonYear}&mon=${mm}&day=${dd}&event=2&club=&tab=1&ha=&fb=&index=0`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
        'Accept':            'application/json, text/javascript, */*; q=0.01',
        'Accept-Language':   'ja',
        'Referer':           'https://www.bleague.jp/schedule/',
        'X-Requested-With':  'XMLHttpRequest',
      },
    });

    if (!res.ok) return { statusCode: res.status, body: `B.League API returned ${res.status}` };

    const data = await res.json();

    const events = [];
    for (const html of (data.topics || [])) {

      const liMatches = [...html.matchAll(/<li class="list-item"[^>]*id="\d+">([\s\S]*?)<\/li>/g)];
      for (const [, gameHtml] of liMatches) {
        // チケットURLから実際の試合日付を取得（YYYYMMDD形式）
        const ticketMatch = gameHtml.match(/bleague-ticket\.psrv\.jp\/sales\/BL\/(\d{4})(\d{2})(\d{2})/);
        const gameDate = ticketMatch
          ? `${ticketMatch[1]}-${ticketMatch[2]}-${ticketMatch[3]}`
          : null;
        if (gameDate && gameDate !== date) continue;

        const homeMatch = gameHtml.match(/class="team home"[\s\S]*?<span class="team-name">(.*?)<\/span>/);
        const awayMatch = gameHtml.match(/class="team away"[\s\S]*?<span class="team-name">(.*?)<\/span>/);
        const timeMatch = gameHtml.match(/<div class="info-arena">(?:<span>[^<]*<\/span>){2}<span>(\d{2}:\d{2})<\/span>/);
        const home = homeMatch?.[1] || '?';
        const away = awayMatch?.[1] || '?';
        const time = timeMatch?.[1];
        events.push({
          title:    `${away} vs ${home}`,
          startUtc: time ? `${gameDate || date}T${time}:00+09:00` : null,
          league:   'B.League',
        });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ events }),
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
