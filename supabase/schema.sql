-- User links: maps Telegram users to browser sessions
CREATE TABLE user_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT UNIQUE NOT NULL,
  link_token TEXT UNIQUE NOT NULL,
  telegram_username TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions from Telegram bot
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  link_token TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(12,2) NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  notes TEXT,
  source TEXT DEFAULT 'telegram',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Policies: anyone with the link_token can read their own data
CREATE POLICY "Users can read own links" ON user_links
  FOR SELECT USING (true);

CREATE POLICY "Users can read own transactions" ON transactions
  FOR SELECT USING (true);

CREATE POLICY "Service can insert transactions" ON transactions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service can insert links" ON user_links
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can delete own transactions" ON transactions
  FOR DELETE USING (true);
