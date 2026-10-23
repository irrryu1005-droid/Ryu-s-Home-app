const SUPABASE_URL      = 'https://yryxcquijncczhclddxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeXhjcXVpam5jY3poY2xkZHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTEyNTIsImV4cCI6MjA5NDg2NzI1Mn0.MpRaoBNpB63LCzZeTW6KLHe3axRWXvAbmRShTvAXN-A';
const GC_CLIENT_ID      = '1053779234925-qc97npjce6q3avsssjkfl3jvldjv4sj1.apps.googleusercontent.com';
const GC_SCOPE          = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

// Supabase の鍵付きの場所（private_secrets）を、合言葉つきの関数で読み書きする
async function secretRpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: process.env.GCAL_FN_SECRET, ...args }),
  });
  if (!res.ok) throw new Error(`supabase ${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

function page(msg) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:sans-serif;padding:24px;line-height:1.7"><p>${msg}</p><p><a href="/home/home.html">HOME に戻る</a></p></body>`,
  };
}

// Googleカレンダーの接続（最初の1回だけ）
//   ?code なし → Google の許可画面へ
//   ?code あり → 合鍵（refresh token）をもらって保存し、元のページへ戻る
exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const redirectUri = `https://${event.headers.host}/.netlify/functions/gcal-auth`;
  if (!process.env.GOOGLE_CLIENT_SECRET || !process.env.GCAL_FN_SECRET) {
    return page('サーバーの設定（GOOGLE_CLIENT_SECRET / GCAL_FN_SECRET）がまだです。');
  }
  if (q.error) return page(`接続できませんでした（${q.error}）。`);

  if (!q.code) {
    const back = (q.back || '/home/home.html').startsWith('/') ? (q.back || '/home/home.html') : '/home/home.html';
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: GC_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: GC_SCOPE, access_type: 'offline', prompt: 'consent', state: back,
    });
    return { statusCode: 302, headers: { Location: url } };
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code, client_id: GC_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const tok = await res.json();
    if (!tok.refresh_token) return page(`接続できませんでした（${tok.error || 'refresh token なし'}）。`);

    // 最初に接続したアカウント以外では上書きしない（他人が自分のカレンダーにすり替えるのを防ぐ）
    const email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email;
    const owner = await secretRpc('gcal_secret_get', { p_key: 'google_owner_email' });
    if (owner && owner !== email) return page(`${email} では接続できません（最初に接続したアカウントだけ使えます）。`);

    if (!owner) await secretRpc('gcal_secret_set', { p_key: 'google_owner_email', p_value: email });
    await secretRpc('gcal_secret_set', { p_key: 'google_refresh_token', p_value: tok.refresh_token });

    const back = (q.state || '').startsWith('/') ? q.state : '/home/home.html';
    return { statusCode: 302, headers: { Location: back } };
  } catch (e) {
    return page(`エラー: ${String(e.message || e).replace(/</g, '&lt;')}`);
  }
};
