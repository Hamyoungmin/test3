/**
 * 웹/앱 공통 엑셀·테이블 유틸
 * 숫자 판별, 컬럼 매핑 등
 */

import type { CellValue } from './excel-types';

/**
 * UI에서 숨길 컬럼 (DB는 유지, 프론트엔드에만 표시 안 함)
 * 새 리스트/테이블 화면을 만들 때 반드시 getDisplayHeaders()로 필터 후 렌더링할 것
 */
export const HIDDEN_DISPLAY_COLUMNS = ['id'] as const;

/** 화면 표시용 헤더 (ID 등 숨김 컬럼 제외) - 모든 테이블/리스트에서 사용 */
export function getDisplayHeaders(headers: string[]): string[] {
  return headers.filter((h) => !HIDDEN_DISPLAY_COLUMNS.some((hidden) => h.toLowerCase() === hidden));
}

/** 고정 열 순서 (기존/신규 데이터 공통) */
export const FIXED_INVENTORY_COLUMNS = ['순번', '품목명', '규격', '단위', '현재재고', '기준재고', '상태'] as const;

/** data 객체에서 키워드로 값 찾기 */
export function findColumnValue(
  data: Record<string, unknown> | null | undefined,
  keywords: string[]
): unknown {
  if (!data || typeof data !== 'object') return null;
  for (const key of Object.keys(data)) {
    const normalizedKey = key.toLowerCase().replace(/\s/g, '');
    for (const keyword of keywords) {
      if (normalizedKey.includes(keyword.toLowerCase())) {
        return data[key];
      }
    }
  }
  return null;
}

/** 품목명 추출 */
export function findItemName(data: Record<string, unknown> | null | undefined, rowIndex: number): string {
  if (!data || typeof data !== 'object') return `품목 ${rowIndex + 1}`;
  const kw = ['품목', '품목명', '상품명', '제품명', '이름', '항목', 'name', 'item', 'product'];
  const v = findColumnValue(data, kw);
  if (v != null && String(v).trim()) return String(v);
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().startsWith('column') || key.toLowerCase() === 'id') continue;
    const val = data[key];
    if (typeof val === 'string' && val.trim() && isNaN(Number(val.replace(/,/g, '')))) return val;
  }
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().startsWith('column')) continue;
    const val = data[key];
    if (val != null && String(val).trim()) return String(val);
  }
  return `품목 ${rowIndex + 1}`;
}

/** 규격 추출 */
export function findSpec(data: Record<string, unknown> | null | undefined): string {
  const v = findColumnValue(data, ['규격', '스펙', 'spec', '규격사항']);
  return v != null && String(v).trim() ? String(v).trim() : '-';
}

/** 단위 추출 */
export function findUnit(data: Record<string, unknown> | null | undefined): string {
  const v = findColumnValue(data, ['단위', 'unit', 'uom']);
  return v != null && String(v).trim() ? String(v).trim() : '-';
}

/** 원본 컬럼명이 고정 컬럼 중 어느 것에 해당하는지 반환 */
export function getFixedColumnForOriginal(original: string): string | null {
  const lower = String(original ?? '').toLowerCase().replace(/\s/g, '');
  if (['품목', '품목명', '상품명', '제품명', '이름', 'name', 'item'].some(k => lower.includes(k))) return '품목명';
  if (['규격', '스펙', 'spec'].some(k => lower.includes(k))) return '규격';
  if (['단위', 'unit', 'uom'].some(k => lower.includes(k))) return '단위';
  if (['현재재고', '현재', '재고', '수량', 'stock', 'quantity', 'qty'].some(k => lower.includes(k))) return '현재재고';
  if (['기준재고', '기준', 'base'].some(k => lower.includes(k))) return '기준재고';
  return null;
}

/** 행을 고정 열 순서 값으로 매핑 */
export function mapRowToFixedColumns(
  row: Record<string, unknown>,
  rowIndex: number
): Record<string, CellValue> {
  const data = row as Record<string, unknown>;
  const currentStock = Number(
    findColumnValue(data, ['현재재고', '현재 재고', '재고', '수량', 'stock', 'quantity', 'qty']) ?? 0
  );
  const baseStock = (row.base_stock ?? findColumnValue(data, ['기준재고', '기준 재고', '기준'])) as number | null | undefined;
  const baseNum = baseStock != null ? Number(baseStock) : 0;
  const isLowStock = baseNum > 0 && currentStock < baseNum;
  const isExpired = !!row.expiry_date && new Date(String(row.expiry_date)) <= new Date();
  const daysUntil = row.expiry_date
    ? Math.ceil((new Date(String(row.expiry_date)).getTime() - Date.now()) / 86400000)
    : null;
  const isExpiringSoon = daysUntil != null && daysUntil > 0 && daysUntil <= 7;

  let status: string = '정상';
  if (isExpired) status = '폐기';
  else if (isExpiringSoon) status = '임박';
  else if (isLowStock) status = '부족';

  return {
    row_index: (row.row_index as number) ?? rowIndex,
    순번: rowIndex + 1,
    품목명: findItemName(data, rowIndex),
    규격: findSpec(data),
    단위: findUnit(data),
    현재재고: currentStock,
    기준재고: baseNum,
    상태: status,
  };
}

/** 숫자형 컬럼 키워드 (우측 정렬 + 굵게 적용 대상) */
const NUMERIC_KEYWORDS = [
  '재고', '현재', '기준', '수량', '단가', '가격', '금액', '금액',
  'stock', 'quantity', 'qty', 'price', 'amount', '합계', '총',
  'column', '번호', 'no', 'id', 'row',
];

/** 숫자형인지 판별 (키워드 기반) */
export function isNumericColumn(columnName: string): boolean {
  const lower = String(columnName ?? '').toLowerCase().replace(/[\s_]/g, '');
  return NUMERIC_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/** 셀 값이 숫자형인지 판별 */
export function isNumericValue(val: CellValue): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') return !isNaN(val);
  if (typeof val === 'string') {
    const n = Number(String(val).replace(/,/g, ''));
    return !isNaN(n) && String(val).trim() !== '';
  }
  return false;
}

/** 셀 값을 안전하게 문자열로 */
export function formatCellValue(val: CellValue): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'boolean') return val ? 'Y' : 'N';
  return String(val).trim() || '-';
}
