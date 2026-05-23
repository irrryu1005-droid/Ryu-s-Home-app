-- ============================================================
-- Google Calendar連携用 テーブル追加
-- Supabase → SQL Editor に貼り付けて実行してください
-- ============================================================

-- 実行予定日テーブル
CREATE TABLE IF NOT EXISTS task_schedules (
  id            BIGSERIAL PRIMARY KEY,
  todo_id       UUID REFERENCES todos(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  gcal_event_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE task_schedules DISABLE ROW LEVEL SECURITY;

-- todosにGoogleカレンダーのイベントIDカラムを追加
ALTER TABLE todos ADD COLUMN IF NOT EXISTS gcal_due_event_id TEXT;
