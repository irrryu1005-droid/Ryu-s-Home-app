-- ============================================================
-- Task用 テーブル更新
-- Supabase → SQL Editor に貼り付けて実行してください
-- IF NOT EXISTS を使っているので何度実行しても安全です
-- ============================================================

ALTER TABLE todos ADD COLUMN IF NOT EXISTS category   TEXT    DEFAULT 'その他';
ALTER TABLE todos ADD COLUMN IF NOT EXISTS status     TEXT    DEFAULT 'will';
ALTER TABLE todos ADD COLUMN IF NOT EXISTS done_at    DATE;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS due_time   TEXT;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN DEFAULT TRUE;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS start_date DATE;   -- タイムライン開始日

-- 既存データの移行: completed=true → status='done'
UPDATE todos SET status = 'done' WHERE completed = TRUE AND status = 'will';
