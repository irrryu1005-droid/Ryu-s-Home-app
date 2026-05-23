-- ============================================================
-- Supabase セットアップSQL
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください
-- ============================================================

-- 1. 収支明細テーブル
CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  memo TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 口座残高テーブル
CREATE TABLE accounts (
  account_name TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- デフォルト口座を挿入
INSERT INTO accounts (account_name, balance, sort_order) VALUES
  ('deposit（銀行）',         0, 1),
  ('cash（現金）',            0, 2),
  ('PayPay',                  0, 3),
  ('Rakuten Pay',             0, 4),
  ('non-trade payables',      0, 5),
  ('credit trade payable',    0, 6);

-- ============================================================
-- RLS (Row Level Security) を無効化 → 個人利用なので不要
-- ============================================================
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
