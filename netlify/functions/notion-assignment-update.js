// Notion「課題・締切」の1件を書き換える
// 必要な環境変数: NOTION_TOKEN（Notion の接続で「Update content」をオンにしておく）
// 書き換えられるのは「課題・締切」DB の中のページと、下の項目だけ（科目のつながりは対象外）

const ASSIGNMENTS_DB = '6007487f24d24ec7a34c5d8e6ecdf685'; // 課題・締切
const NOTION_VERSION = '2022-06-28';

const STATUS_NAMES = ['Will', 'Doing', 'Done'];
const KIND_NAMES   = ['小テスト', 'レポート', 'ミニレポート', 'アンケート', 'その他'];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const richText = str => [{ type: 'text', text: { content: String(str || '').slice(0, 2000) } }];

function notionFetch(token, path, method = 'GET', body) {
  return fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      'Authorization':  `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type':   'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'POST だけ使えます' };

  const token = process.env.NOTION_TOKEN;
  if (!token) return { statusCode: 500, headers: CORS, body: 'NOTION_TOKEN が設定されていません' };

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: 'JSON が読めません' }; }
  const { id, title, status, due, prep, kind, method, points, memo } = input;
  if (!id) return { statusCode: 400, headers: CORS, body: 'id が必要です' };

  try {
    // 「課題・締切」の中のページか確かめる（ほかのページは書き換えない）
    const pageRes = await notionFetch(token, `pages/${id}`);
    if (!pageRes.ok) return { statusCode: pageRes.status, headers: CORS, body: await pageRes.text() };
    const page = await pageRes.json();
    if ((page.parent?.database_id || '').replace(/-/g, '') !== ASSIGNMENTS_DB) {
      return { statusCode: 403, headers: CORS, body: '課題・締切のページではありません' };
    }

    const properties = {};
    if (title  !== undefined) properties['課題名']   = { title: richText(title) };
    if (status !== undefined) {
      if (!STATUS_NAMES.includes(status)) return { statusCode: 400, headers: CORS, body: '状態が正しくありません' };
      properties['状態'] = { select: { name: status } };
    }
    if (kind !== undefined) {
      if (kind && !KIND_NAMES.includes(kind)) return { statusCode: 400, headers: CORS, body: '種類が正しくありません' };
      properties['種類'] = { select: kind ? { name: kind } : null };
    }
    // due: 'YYYY-MM-DD'（終日）/ 'YYYY-MM-DDTHH:mm:00+09:00'（時刻あり）/ null（消す）
    if (due    !== undefined) properties['締切']     = { date: due ? { start: due } : null };
    // prep: 準備開始（'YYYY-MM-DD' / null で消す）
    if (prep   !== undefined) properties['準備開始'] = { date: prep ? { start: prep } : null };
    if (method !== undefined) properties['提出方法'] = { rich_text: richText(method) };
    if (points !== undefined) properties['配点']     = { rich_text: richText(points) };
    if (memo   !== undefined) properties['メモ']     = { rich_text: richText(memo) };

    const res = await notionFetch(token, `pages/${id}`, 'PATCH', { properties });
    if (!res.ok) return { statusCode: res.status, headers: CORS, body: await res.text() };

    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: '{"ok":true}' };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: e.message };
  }
};
