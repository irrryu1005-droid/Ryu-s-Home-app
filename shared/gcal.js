// ============================================================
// Google カレンダーの鍵（アクセストークン）をサーバーからもらう（HOME・Tasks・Betting 共通）
//   サーバー（netlify/functions/gcal-token.js）が、最初の1回の許可で保存した合鍵から作るので、ログイン画面は出ない
// ============================================================
const GCAL_CONNECT_URL = '/.netlify/functions/gcal-auth';

// 最初の1回の接続（Google の許可画面へ。終わるとこのページに戻る）
function gcalConnect() {
  location.href = `${GCAL_CONNECT_URL}?back=${encodeURIComponent(location.pathname + location.search)}`;
}

async function gcalServerToken() {
  try {
    const res = await fetch('/.netlify/functions/gcal-token', { cache: 'no-store' });
    const j = await res.json();
    return j.access_token ? j : null;
  } catch { return null; }
}

// 鍵をもらって onToken(鍵 or null) を呼ぶ。期限が切れる前に取り直して、また onToken を呼ぶ
function gcalAutoToken(onToken) {
  let timer = null;
  const get = async () => {
    clearTimeout(timer);
    const t = await gcalServerToken();
    onToken(t ? t.access_token : null);
    if (t) timer = setTimeout(get, Math.max(60, t.expires_in - 300) * 1000);
  };
  get();
  // スマホで長く裏にあったページに戻ってきたときも取り直す
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') get(); });
}
