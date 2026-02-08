-- Supabase SQL Editor에서 실행하세요
-- 재고 테이블에 유통기한 필드 추가

-- 1. expiry_date 컬럼 추가
ALTER TABLE 재고 
ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- 2. 유통기한 알림 상태 컬럼 추가 (선택)
ALTER TABLE 재고 
ADD COLUMN IF NOT EXISTS expiry_alert_sent BOOLEAN DEFAULT false;

-- 3. 인덱스 생성 (유통기한 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_재고_expiry_date ON 재고(expiry_date);

-- 4. 유통기한 임박 품목 조회 뷰 (선택)
CREATE OR REPLACE VIEW 유통기한_임박_품목 AS
SELECT 
  *,
  expiry_date - CURRENT_DATE AS days_until_expiry
FROM 재고
WHERE expiry_date IS NOT NULL
  AND expiry_date <= CURRENT_DATE + INTERVAL '7 days'
ORDER BY expiry_date ASC;
