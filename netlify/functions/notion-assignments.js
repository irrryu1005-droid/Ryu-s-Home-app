// Notion「神戸大学 2026後期 学習ハブ」の課題・締切を取得する（読み取り専用）
// 必要な環境変数: NOTION_TOKEN（Notion のインテグレーションのシークレット）

const ASSIGNMENTS_DB = '6007487f24d24ec7a34c5d8e6ecdf685'; // 課題・締切
const SUBJECTS_DB    = '56b8b661ec2b456e872fab1ec71fb404'; // 科目
const NOTION_VERSION = '2022-06-28';

const STATUS_MAP = { 'Will': 'will', 'Doing': 'doing', 'Done': 'done' };

async function queryDb(token, dbId, body) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ ...body, start_cursor: cursor, page_size: 100 }),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    results.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

function titleOf(props) {
  const t = Object.values(props).find(p => p.type === 'title');
  return t ? t.title.map(x => x.plain_text).join('') : '';
}

exports.handler = async (event) => {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return { statusCode: 500, body: 'NOTION_TOKEN が設定されていません' };
  }

  // Done は直近14日分だけ返す（まだのものはすべて）
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const [assignments, subjects] = await Promise.all([
      queryDb(token, ASSIGNMENTS_DB, {
        filter: {
          or: [
            { property: '状態', select: { does_not_equal: 'Done' } },
            { property: '締切', date: { on_or_after: since } },
          ],
        },
        sorts: [{ property: '締切', direction: 'ascending' }],
      }),
      queryDb(token, SUBJECTS_DB, {}),
    ]);

    const subjectNames = {};
    subjects.forEach(s => { subjectNames[s.id] = titleOf(s.properties); });

    const plain = prop => (prop?.rich_text || []).map(x => x.plain_text).join('');

    const items = assignments.map(page => {
      const p = page.properties;
      const statusName = p['状態']?.select?.name || 'Will';
      return {
        id:       page.id,
        url:      page.url,
        title:    titleOf(p),
        due:      p['締切']?.date?.start || null,   // 'YYYY-MM-DD' または ISO日時
        prep:     p['準備開始']?.date?.start?.slice(0, 10) || null,  // 予習・復習を始める日
        status:   STATUS_MAP[statusName] || 'will',
        statusName,
        kind:     p['種類']?.select?.name || '',
        method:   plain(p['提出方法']),
        points:   plain(p['配点']),
        memo:     plain(p['メモ']),
        subjects: (p['科目']?.relation || []).map(r => subjectNames[r.id]).filter(Boolean),
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(items),
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
