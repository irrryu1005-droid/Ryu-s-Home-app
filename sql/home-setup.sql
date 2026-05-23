-- ============================================================
-- HOME用 追加テーブル
-- Supabase → SQL Editor に貼り付けて実行してください
-- ============================================================

-- ToDoリスト
CREATE TABLE todos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  text TEXT NOT NULL,
  due_date DATE,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ルーティン日次記録（1日1レコード）
CREATE TABLE routine_logs (
  date DATE PRIMARY KEY,
  ielts BOOLEAN DEFAULT FALSE,
  reading BOOLEAN DEFAULT FALSE,
  training BOOLEAN DEFAULT FALSE
);

ALTER TABLE todos DISABLE ROW LEVEL SECURITY;
ALTER TABLE routine_logs DISABLE ROW LEVEL SECURITY;
