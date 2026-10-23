const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';
const GC_CLIENT_ID      = '1053779234925-qc97npjce6q3avsssjkfl3jvldjv4sj1.apps.googleusercontent.com';
const OK_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

// 同じ関数が温まっている間は、作った鍵を使い回す（期限の5分前まで）
let cache = null;

// Googleカレンダーの鍵（1時間用のアクセストークン）を、保存してある合鍵（refresh token）から作って返す
//   → { access_token, expires_in } ／ まだ接続していなければ { connected: false }
exports.handler = async () => {
  if (cache && cache.exp - Date.now() > 5 * 60 * 1000) {
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ access_token: cache.token, expires_in: Math.floor((cache.exp - Date.now()) / 1000) }) };
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gcal_secret_get`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: process.env.GCAL_FN_SECRET, p_key: 'google_refresh_token' }),
    });
    const refresh = r.ok ? await r.json() : null;
    if (!refresh) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ connected: false }) };

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GC_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refresh, grant_type: 'refresh_token',
      }),
    });
    const tok = await res.json();
    // 合鍵が取り消された・期限切れ（invalid_grant）なら、もう一度接続してもらう
    if (!tok.access_token) return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ connected: false, error: tok.error }) };

    cache = { token: tok.access_token, exp: Date.now() + tok.expires_in * 1000 };
    return { statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ access_token: tok.access_token, expires_in: tok.expires_in }) };
  } catch (e) {
    return { statusCode: 500, headers: OK_HEADERS, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
