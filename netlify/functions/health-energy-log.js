const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';
const OK_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// iOSショートカットからApple Fitnessのアクティブカロリーを受け取るWebhook
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: OK_HEADERS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const { date, active_kcal, resting_kcal, token } = body;

  if (!process.env.HEALTH_WEBHOOK_TOKEN || token !== process.env.HEALTH_WEBHOOK_TOKEN) {
    return { statusCode: 401, headers: OK_HEADERS, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  if (!date) {
    return { statusCode: 400, headers: OK_HEADERS, body: JSON.stringify({ error: 'date is required' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/health_energy_logs?on_conflict=date`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([{
        date,
        active_kcal:  active_kcal  != null ? Math.round(active_kcal)  : null,
        resting_kcal: resting_kcal != null ? Math.round(resting_kcal) : null,
        source: 'shortcuts',
        updated_at: new Date().toISOString(),
      }]),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ error: errText }) };
    }
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
