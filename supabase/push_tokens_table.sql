-- Supabase SQL Editor에서 실행하세요

-- 1. push_tokens 테이블 생성
CREATE TABLE IF NOT EXISTS push_tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  platform TEXT DEFAULT 'unknown',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);

-- 3. RLS (Row Level Security) 설정
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- 4. 정책 생성 - 모든 사용자가 자신의 토큰을 삽입/업데이트 가능
CREATE POLICY "Allow insert for all" ON push_tokens
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update for all" ON push_tokens
  FOR UPDATE USING (true);

CREATE POLICY "Allow select for all" ON push_tokens
  FOR SELECT USING (true);

-- 5. 알림 로그 테이블 (선택사항)
CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGSERIAL PRIMARY KEY,
  push_token TEXT,
  title TEXT,
  body TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  success BOOLEAN DEFAULT false,
  error_message TEXT
);
