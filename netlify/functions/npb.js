exports.handler = async (event) => {
  const { year, month } = event.queryStringParameters || {};

  if (!year || !month) {
    return { statusCode: 400, body: 'year と month が必要です' };
  }

  const mm  = String(month).padStart(2, '0');
  const url = `https://npb.jp/games/${year}/schedule_${mm}_detail.html`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.5',
      },
    });

    if (!res.ok) {
      return { statusCode: res.status, body: `npb.jp が ${res.status} を返しました` };
    }

    const html = await res.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: html,
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
