/**
 * 웹/앱 공통 엑셀·테이블 타입 정의
 * 엑셀 원본의 행·열 순서를 그대로 유지
 */

export type CellValue = string | number | boolean | null;

export interface SheetData {
  headers: string[];
  rows: (CellValue)[][];
}

/** DB 재고 테이블의 data 컬럼 (JSONB) - key = 컬럼명, value = 셀값 */
export type InventoryRowData = Record<string, CellValue>;

/** DB에서 가져온 행 (id, row_index + data 펼침) */
export interface InventoryRow extends Record<string, string | number | boolean | null | undefined> {
  id?: number;
  row_index?: number;
}

/**
 * Excel 원본의 열 순서 추출
 * 첫 번째 행의 data 키 순서 = Excel 헤더 순서
 */
export function getHeadersInOrder(rows: { data?: Record<string, unknown> | null }[]): string[] {
  if (!rows?.length) return [];
  const first = rows[0];
  const data = first?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.keys(data);
}

/** 인덱스 기반 행을 Record로 변환 (헤더 순서 유지) */
export function rowToRecord(headers: string[], row: (string | number | boolean | null)[]): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  headers.forEach((h, i) => {
    out[h] = row[i] ?? null;
  });
  return out;
}
