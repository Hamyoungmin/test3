'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Package, AlertTriangle, CheckCircle, Banknote, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDragScroll } from '@/hooks/useDragScroll';
import AIBriefing from '@/components/AIBriefing';
import { getDisplayHeaders } from '@shared/excel-utils';

type CellValue = string | number | boolean | null;
type RowData = Record<string, CellValue> & { 
  id: number; 
  base_stock?: number | null;  // 기준 재고 (최종 확정된 재고)
  alarm_status?: boolean; 
};

interface EditingCell {
  rowId: number;
  column: string;
  value: CellValue;
}

// 숫자 전용 컬럼 목록
const NUMERIC_COLUMNS = ['현재_재고', '현재재고', '재고', '단가', '가격', 'price', 'quantity', 'stock', '수량', '금액'];

// 재고 컬럼 키워드 (현재 재고 추출용)
const STOCK_KEYWORDS = ['현재_재고', '현재재고', '재고', '재고량', '수량', 'stock', 'quantity', '잔량'];

// 품목명 컬럼 키워드 (검색용)
const ITEM_NAME_KEYWORDS = ['품목', '품목명', '상품명', '제품명', '이름', 'name', 'item', 'product', '세목', '항목'];

// 단가 컬럼 키워드 (발주 예산 계산용)
const PRICE_KEYWORDS = ['단가', '가격', 'price', 'unit_price', '금액', '원가'];

const DEFAULT_UNIT_PRICE = 1000;

const LAST_CONFIRM_KEY = (fileId: string) => `lastBulkConfirm_${fileId}`;
function formatConfirmTimestamp(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

function getUnitPriceFromRow(row: RowData, headers: string[]): number | null {
  for (const h of headers) {
    if (h === 'id') continue;
    const lower = h.toLowerCase().replace(/[\s_]/g, '');
    if (PRICE_KEYWORDS.some(k => lower.includes(k.toLowerCase().replace(/[\s_]/g, '')))) {
      const val = row[h];
      if (typeof val === 'number' && !isNaN(val) && val >= 0) return val;
      if (typeof val === 'string') {
        const num = parseFloat(val.replace(/,/g, ''));
        if (!isNaN(num) && num >= 0) return num;
      }
    }
  }
  return null;
}

function findItemNameColumn(headers: string[]): string | null {
  for (const h of headers) {
    if (h === 'id') continue;
    const lower = h.toLowerCase().replace(/[\s_]/g, '');
    if (ITEM_NAME_KEYWORDS.some(k => lower.includes(k.toLowerCase().replace(/[\s_]/g, '')))) {
      return h;
    }
  }
  return null;
}

function getItemNameFromRow(row: RowData, headers: string[]): string {
  const col = findItemNameColumn(headers);
  if (col && row[col] != null) return String(row[col]);
  for (const h of headers) {
    if (h === 'id') continue;
    const v = row[h];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

// 현재 재고 컬럼 찾기 (배지 표시용)
function findCurrentStockColumn(headers: string[]): string | null {
  for (const h of headers) {
    if (h === 'id') continue;
    const lower = h.toLowerCase().replace(/[\s_]/g, '');
    if (STOCK_KEYWORDS.some(sk => lower.includes(sk.toLowerCase().replace(/[\s_]/g, '')))) {
      return h;
    }
  }
  return null;
}

function getCurrentStockFromRow(row: RowData, headers: string[]): number | null {
  for (const h of headers) {
    if (h === 'id') continue;
    const lower = h.toLowerCase().replace(/[\s_]/g, '');
    if (STOCK_KEYWORDS.some(sk => lower.includes(sk.toLowerCase().replace(/[\s_]/g, '')))) {
      const val = row[h];
      if (typeof val === 'number' && !isNaN(val) && val >= 0) return val;
      if (typeof val === 'string') {
        const num = parseFloat(val.replace(/,/g, ''));
        if (!isNaN(num) && num >= 0) return num;
      }
    }
  }
  for (const h of headers) {
    if (h === 'id') continue;
    const val = row[h];
    if (typeof val === 'number' && !isNaN(val) && val >= 0) return val;
  }
  return null;
}

// 재고 상태 배지 계산 (현재 vs 기준)
function getStockStatusBadge(
  row: RowData,
  headers: string[],
  currentStockCol: string | null
): StockStatusBadge | null {
  if (!currentStockCol || row.base_stock == null || row.base_stock === undefined) return null;
  const base = Number(row.base_stock);
  if (isNaN(base)) return null;
  const curVal = row[currentStockCol];
  const cur = curVal != null ? Number(curVal) : null;
  if (cur === null || isNaN(cur)) return null;
  if (cur < base) return { label: '재고 부족', bgClass: 'bg-[#FEE2E2] dark:bg-red-900/50', textClass: 'text-[#EF4444] dark:text-red-400' };
  if (Math.abs(cur - base) < 0.01) return { label: '주의', bgClass: 'bg-[#FFEDD5] dark:bg-amber-900/40', textClass: 'text-[#F97316] dark:text-amber-400' };
  return { label: '여유', bgClass: 'bg-[#DCFCE7] dark:bg-green-900/40', textClass: 'text-[#22C55E] dark:text-green-400' };
}

// 숫자 전용 컬럼인지 확인
function isNumericColumn(column: string): boolean {
  const lowerColumn = column.toLowerCase();
  return NUMERIC_COLUMNS.some(nc => lowerColumn.includes(nc.toLowerCase()));
}

// 숫자 유효성 검사
function validateNumericValue(value: string): { isValid: boolean; numValue: number | null } {
  if (value.trim() === '') {
    return { isValid: true, numValue: null }; // 빈 값 허용
  }
  const num = Number(value);
  if (isNaN(num)) {
    return { isValid: false, numValue: null };
  }
  return { isValid: true, numValue: num };
}

// 재고 상태 배지 타입
type StockStatusBadge = { label: string; bgClass: string; textClass: string };

// 개별 셀 컴포넌트
function EditableCell({
  value,
  rowId,
  column,
  isEditing,
  onStartEdit,
  onSave,
  onCancel,
  onValidationError,
  stockStatusBadge,
}: {
  value: CellValue;
  rowId: number;
  column: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (newValue: CellValue) => void;
  onCancel: () => void;
  onValidationError?: (message: string) => void;
  stockStatusBadge?: StockStatusBadge | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState<string>(String(value ?? ''));
  const [hasError, setHasError] = useState(false);

  const isNumeric = isNumericColumn(column);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(String(value ?? ''));
    setHasError(false);
  }, [value]);

  // 입력 값 변경 시 실시간 유효성 검사
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);

    if (isNumeric && newValue.trim() !== '') {
      const { isValid } = validateNumericValue(newValue);
      setHasError(!isValid);
    } else {
      setHasError(false);
    }
  };

  const handleSaveWithValidation = () => {
    if (isNumeric) {
      const { isValid, numValue } = validateNumericValue(editValue);
      if (!isValid) {
        setHasError(true);
        onValidationError?.(`'${column}' 컬럼에는 숫자만 입력할 수 있습니다.`);
        return false;
      }
      onSave(numValue);
      setHasError(false);
      return true;
    }

    // 일반 컬럼
    const numValue = Number(editValue);
    const finalValue = !isNaN(numValue) && editValue.trim() !== '' ? numValue : editValue;
    onSave(finalValue);
    return true;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveWithValidation();
    } else if (e.key === 'Escape') {
      setHasError(false);
      onCancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleSaveWithValidation();
    }
  };

  const handleBlur = () => {
    handleSaveWithValidation();
  };

  if (isEditing) {
    return (
      <div className="relative">
        <input
          ref={inputRef}
          type={isNumeric ? 'text' : 'text'}
          inputMode={isNumeric ? 'numeric' : 'text'}
          value={editValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`w-full h-full px-2 py-1 bg-white text-gray-900 text-sm border-2 outline-none transition-colors ${
            hasError 
              ? 'border-red-500 bg-red-50 text-red-700' 
              : 'border-indigo-500'
          }`}
          style={{ minWidth: '100%' }}
          placeholder={isNumeric ? '숫자 입력' : ''}
        />
        {hasError && (
          <div className="absolute -bottom-5 left-0 text-[10px] text-red-400 whitespace-nowrap z-50">
            숫자만 입력 가능
          </div>
        )}
      </div>
    );
  }

  const displayValue = value !== null && value !== undefined
    ? (isNumeric && typeof value === 'number' ? value.toLocaleString() : String(value))
    : '';

  return (
    <div
      onClick={onStartEdit}
      className={`w-full h-full px-2 py-1.5 cursor-pointer hover:bg-green-50 transition-colors min-h-[30px] ${
        stockStatusBadge
          ? 'flex items-center justify-end gap-1.5 font-mono'
          : isNumeric
            ? 'text-right font-mono truncate'
            : 'truncate'
      }`}
      title={String(value ?? '')}
    >
      <span className={isNumeric ? 'tabular-nums' : ''}>{displayValue}</span>
      {stockStatusBadge && !isEditing && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${stockStatusBadge.bgClass} ${stockStatusBadge.textClass}`}
        >
          {stockStatusBadge.label}
        </span>
      )}
    </div>
  );
}

// 최종 확정 모달 컴포넌트
function ConfirmBaseStockModal({
  isOpen,
  onClose,
  rowId,
  currentStock,
  itemName,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  rowId: number;
  currentStock: number;
  itemName: string;
  onConfirm: (rowId: number, baseStock: number) => Promise<void>;
}) {
  const [baseStock, setBaseStock] = useState(currentStock);
  const [isConfirming, setIsConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setBaseStock(currentStock);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, currentStock]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConfirming(true);
    await onConfirm(rowId, baseStock);
    setIsConfirming(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            기준 재고 확정
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            이 수치를 기준으로 재고가 부족해지면 알람이 발생합니다
          </p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-sm text-gray-600">
              품목: <span className="text-gray-900 font-medium">{itemName || `행 #${rowId}`}</span>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              기준 재고 수량
            </label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              value={baseStock}
              onChange={(e) => setBaseStock(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 text-lg font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              현재 재고가 이 수치 아래로 떨어지면 빨간색 알림이 표시됩니다
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isConfirming}
              className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isConfirming ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  확정 중...
                </>
              ) : (
                '최종 확정'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 컬럼 추가 모달 컴포넌트
function AddColumnModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (columnName: string, columnType: string) => void;
}) {
  const [columnName, setColumnName] = useState('');
  const [columnType, setColumnType] = useState('text');
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnName.trim()) return;

    setIsAdding(true);
    await onAdd(columnName.trim(), columnType);
    setIsAdding(false);
    setColumnName('');
    setColumnType('text');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">새 컬럼 추가</h3>
          <p className="text-xs text-gray-500 mt-1">DB 스키마에 새로운 컬럼을 추가합니다</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              컬럼 이름
            </label>
            <input
              ref={inputRef}
              type="text"
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              placeholder="예: 수량, price, 카테고리"
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">영문, 숫자, 한글, 언더스코어 사용 가능</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              데이터 타입
            </label>
            <select
              value={columnType}
              onChange={(e) => setColumnType(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
            >
              <option value="text">텍스트 (TEXT)</option>
              <option value="number">숫자 (NUMERIC)</option>
              <option value="integer">정수 (INTEGER)</option>
              <option value="boolean">불리언 (BOOLEAN)</option>
              <option value="date">날짜 (DATE)</option>
              <option value="timestamp">타임스탬프 (TIMESTAMPTZ)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!columnName.trim() || isAdding}
              className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isAdding ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  추가 중...
                </>
              ) : (
                '컬럼 추가'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 초기 빈 행 개수 및 추가 단위
const INITIAL_EMPTY_ROWS = 20;  // 최소 20행 보장
const EMPTY_ROWS_INCREMENT = 10;

// 정렬 타입
type SortDirection = 'asc' | 'desc' | null;
interface SortConfig {
  column: string | null;
  direction: SortDirection;
}

export default function EditPage() {
  const params = useParams();
  const router = useRouter();
  const fileId = (params?.fileId as string) ?? '';

  const [data, setData] = useState<RowData[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [modifiedRows, setModifiedRows] = useState<Set<number>>(new Set()); // 수정된 기존 행
  const [newRows, setNewRows] = useState<Map<number, RowData>>(new Map());   // 새로 추가된 행 (임시 음수 ID → 데이터)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [emptyRowCount, setEmptyRowCount] = useState(INITIAL_EMPTY_ROWS);
  
  // 정렬 상태
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  
  // AI 분석 재요청 트리거
  const [aiRefreshTrigger, setAiRefreshTrigger] = useState(0);
  // 검색 필터 (품목명)
  const [searchQuery, setSearchQuery] = useState('');
  // 재고 부족 품목만 보기 토글
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  // 단가 수동 오버라이드 (rowId -> 단가) - 데이터에 단가가 없을 때 기본 1000원 대신 사용
  const [unitPriceOverrides, setUnitPriceOverrides] = useState<Map<number, number>>(new Map());
  // 단가 편집 중인 행 ID
  const [editingUnitPriceRowId, setEditingUnitPriceRowId] = useState<number | null>(null);
  
  // 최종 확정 모달 상태
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    rowId: number;
    currentStock: number;
    itemName: string;
  }>({ isOpen: false, rowId: 0, currentStock: 0, itemName: '' });

  const tableRef = useRef<HTMLDivElement>(null);
  
  // 드래그 스크롤 훅
  const { containerRef: dragScrollRef, isDragging } = useDragScroll({ sensitivity: 1.2, smoothness: 0.9 });
  
  // 가로 스크롤 끝 감지 상태
  const [showAddColumnButton, setShowAddColumnButton] = useState(false);

  // 저장되지 않은 변경사항 개수
  const unsavedChangesCount = modifiedRows.size + newRows.size;

  // 현재 재고 컬럼 (배지 표시용)
  const currentStockColumn = useMemo(() => findCurrentStockColumn(headers), [headers]);

  // 빈 행 생성 (음수 id로 구분)
  const emptyRows = useMemo(() => {
    if (headers.length === 0) return [];
    return Array.from({ length: emptyRowCount }, (_, index) => {
      const emptyRow: RowData = { id: -(index + 1) };
      headers.forEach(h => {
        if (h !== 'id') emptyRow[h] = null;
      });
      return emptyRow;
    });
  }, [headers, emptyRowCount]);

  // 정렬 핸들러
  const handleSort = (column: string) => {
    setSortConfig(prev => {
      if (prev.column === column) {
        // 같은 컬럼 클릭: asc → desc → null 순환
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        if (prev.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  // 검색 및 필터링된 데이터 (품목명 검색 + 재고 부족 필터)
  const filteredData = useMemo(() => {
    let result = data;

    // 1. 품목명 검색
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(row => {
        const itemName = getItemNameFromRow(row, headers);
        return itemName.toLowerCase().includes(query);
      });
    }

    // 2. 재고 부족 품목만 보기
    if (filterLowStockOnly) {
      result = result.filter(row => {
        const base = row.base_stock;
        if (base == null || base === undefined) return false;
        const cur = getCurrentStockFromRow(row, headers);
        return cur !== null && cur < base;
      });
    }

    return result;
  }, [data, headers, searchQuery, filterLowStockOnly]);

  // 정렬된 데이터
  const sortedData = useMemo(() => {
    if (!sortConfig.column || !sortConfig.direction) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortConfig.column!];
      const bVal = b[sortConfig.column!];

      // null 값 처리
      if (aVal === null || aVal === undefined) return sortConfig.direction === 'asc' ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortConfig.direction === 'asc' ? -1 : 1;

      // 숫자 비교
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // 문자열 비교
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  // 실제 데이터 + 새로 추가된 행 + 빈 행
  const displayData = useMemo(() => {
    // 빈 행 중 newRows에 있는 것은 해당 데이터로 대체
    const mergedEmptyRows = emptyRows.map(emptyRow => {
      const newRowData = newRows.get(emptyRow.id);
      return newRowData || emptyRow;
    });
    return [...sortedData, ...mergedEmptyRows];
  }, [sortedData, emptyRows, newRows]);

  // 요약 대시보드 통계 (검색/필터 결과에 따라 실시간 반영)
  const summaryStats = useMemo(() => {
    const total = filteredData.length;
    const confirmed = filteredData.filter(row => row.base_stock != null && row.base_stock !== undefined).length;
    const lowStock = filteredData.filter(row => {
      const base = row.base_stock;
      if (base == null || base === undefined) return false;
      const cur = getCurrentStockFromRow(row, headers);
      return cur !== null && cur < base;
    }).length;
    return { total, confirmed, lowStock };
  }, [filteredData, headers]);

  // 품목별 단가 (오버라이드 > 데이터 > 기본값 1000)
  const getEffectiveUnitPrice = useCallback((row: RowData) => {
    const override = unitPriceOverrides.get(row.id);
    if (override !== undefined && override >= 0) return override;
    const fromData = getUnitPriceFromRow(row, headers);
    return fromData ?? DEFAULT_UNIT_PRICE;
  }, [unitPriceOverrides, headers]);

  // 품목별 예상 발주 비용 (부족 수량 × 단가)
  const getRowOrderCost = useCallback((row: RowData): number => {
    const base = row.base_stock;
    if (base == null || base === undefined) return 0;
    const cur = getCurrentStockFromRow(row, headers);
    if (cur === null || cur >= base) return 0;
    const shortage = base - cur;
    return shortage * getEffectiveUnitPrice(row);
  }, [headers, getEffectiveUnitPrice]);

  // 총 예상 발주 비용
  const totalOrderBudget = useMemo(() => {
    return filteredData.reduce((sum, row) => sum + getRowOrderCost(row), 0);
  }, [filteredData, getRowOrderCost]);

  const formatCurrency = (n: number) => `₩${(typeof n === 'number' && !isNaN(n) ? n : 0).toLocaleString()}`;

  // 스크롤 감지: 세로 바닥 → 빈 행 추가, 가로 끝 → 컬럼 추가 버튼 표시
  useEffect(() => {
    const container = tableRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = container;
      
      // 세로 스크롤: 바닥에서 100px 이내에 도달하면 빈 행 10개 추가
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      if (isNearBottom) {
        setEmptyRowCount(prev => prev + EMPTY_ROWS_INCREMENT);
      }
      
      // 가로 스크롤: 오른쪽 끝에서 50px 이내에 도달하면 컬럼 추가 버튼 표시
      const isNearRight = scrollWidth - scrollLeft - clientWidth < 50;
      setShowAddColumnButton(isNearRight);
    };

    // 초기 상태 체크
    handleScroll();

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [headers.length]); // headers가 변경되면 다시 체크

  // 데이터 불러오기 - 해당 파일의 data 필드(JSONB)의 모든 키를 자동 추출하여 헤더로 사용
  const fetchData = useCallback(async () => {
    if (!fileId || typeof fileId !== 'string') {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // 해당 파일명의 데이터만 가져오기 (pagination 적용)
      const decodedFileId = decodeURIComponent(fileId);
      let allData: RowData[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error } = await supabase
          .from('재고')
          .select('*')
          .eq('file_name', decodedFileId)
          .range(from, from + batchSize - 1)
          .order('id', { ascending: true });

        if (error) throw error;

        if (batchData && batchData.length > 0) {
          allData = [...allData, ...batchData];
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      if (allData.length > 0) {
        // 중복 제거 (id 기준)
        const uniqueData = allData.filter(
          (item, index, self) => index === self.findIndex((t) => t.id === item.id)
        );
        
        // 모든 행의 data 필드(JSONB)에서 키를 수집하여 헤더로 사용
        const allDataKeys = new Set<string>();
        uniqueData.forEach(item => {
          if (item.data && typeof item.data === 'object') {
            Object.keys(item.data as object).forEach(key => allDataKeys.add(key));
          }
        });

        // 헤더 구성: data 필드의 모든 키 (엑셀 컬럼 그대로, id는 DB용으로만 유지·UI 비노출)
        const dataHeaders = Array.from(allDataKeys);
        const sortedHeaders = [...dataHeaders];
        
        // 데이터 변환: data 필드 내용을 펼쳐서 평탄화 (엑셀처럼 보이도록)
        const flattenedData: RowData[] = uniqueData.map(item => {
          const flatRow: RowData = { 
            id: item.id,
            base_stock: item.base_stock ?? null,  // 기준 재고 (null이면 아직 확정 안됨)
            alarm_status: item.alarm_status ?? false,
          };
          
          // data 필드의 내용을 펼침
          if (item.data && typeof item.data === 'object') {
            Object.entries(item.data as object).forEach(([key, value]) => {
              flatRow[key] = value as CellValue;
            });
          }
          
          // 모든 헤더에 대해 값이 없으면 null로 채움
          dataHeaders.forEach(key => {
            if (!(key in flatRow)) {
              flatRow[key] = null;
            }
          });
          
          return flatRow;
        });
        
        setHeaders(sortedHeaders);
        setData(flattenedData);
      } else {
        setData([]);
        setHeaders([]);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setMessage({ type: 'error', text: '데이터를 불러오는 중 오류가 발생했습니다.' });
    } finally {
      setIsLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // localStorage에서 최종 확정 일시 복원
  useEffect(() => {
    if (typeof window === 'undefined' || !fileId) return;
    try {
      const stored = localStorage.getItem(LAST_CONFIRM_KEY(fileId));
      if (stored) setLastConfirmedAt(stored);
    } catch {
      // ignore
    }
  }, [fileId]);

  // 셀 편집 시작
  const handleStartEdit = (rowId: number, column: string, value: CellValue) => {
    if (column === 'id') return; // id는 편집 불가
    setEditingCell({ rowId, column, value });
  };

  // 셀 저장 - 기존 행은 즉시 DB 업데이트, 새 행은 로컬 저장 후 일괄 저장
  const handleSaveCell = async (rowId: number, column: string, newValue: CellValue) => {
    setEditingCell(null);

    // 숫자 컬럼 유효성 재검사
    if (isNumericColumn(column) && newValue !== null && newValue !== undefined) {
      const strValue = String(newValue);
      if (strValue.trim() !== '' && isNaN(Number(strValue))) {
        setMessage({ type: 'error', text: `'${column}' 컬럼에는 숫자만 입력할 수 있습니다.` });
        setTimeout(() => setMessage(null), 3000);
        return;
      }
    }

    const isEmptyRow = rowId < 0; // 빈 행 여부

    if (isEmptyRow) {
      // 빈 행에 데이터 입력 → 새 행으로 추적 (로컬)
      setNewRows(prev => {
        const updated = new Map(prev);
        const existingNewRow = updated.get(rowId);
        
        if (existingNewRow) {
          // 이미 편집 중인 새 행 업데이트
          updated.set(rowId, { ...existingNewRow, [column]: newValue });
        } else {
          // 새로운 행 생성
          const firstColumn = headers.find(h => h !== 'id');
          const newRow: RowData = { id: rowId };
          headers.forEach(h => {
            if (h !== 'id') {
              if (h === column) {
                newRow[h] = newValue;
              } else if (h === firstColumn && column !== firstColumn) {
                newRow[h] = ' '; // 첫 번째 컬럼에 공백
              } else {
                newRow[h] = null;
              }
            }
          });
          updated.set(rowId, newRow);
        }
        return updated;
      });
      return;
    }

    // 기존 행 - 값이 변경되지 않았으면 스킵
    const currentRow = data.find(r => r.id === rowId);
    if (currentRow && currentRow[column] === newValue) return;

    // 로컬 데이터 즉시 업데이트 (UI 반영)
    setData(prev => prev.map(row => 
      row.id === rowId ? { ...row, [column]: newValue } : row
    ));

    // 기존 행: 즉시 DB에 업데이트 (data JSON 객체 전체를 업데이트)
    try {
      // 현재 행의 모든 데이터를 data 필드용 JSON 객체로 변환
      const updatedRow = currentRow ? { ...currentRow, [column]: newValue } : { [column]: newValue };
      const dataObj: Record<string, CellValue> = {};
      headers.forEach(h => {
        if (h !== 'id') {
          dataObj[h] = updatedRow[h] ?? null;
        }
      });

      const { error } = await supabase
        .from('재고')
        .update({ data: dataObj })
        .eq('id', rowId);

      if (error) {
        console.error('Cell update error:', error);
        setMessage({ type: 'error', text: '저장 실패. 다시 시도해주세요.' });
        // 실패 시 로컬 데이터 롤백
        setData(prev => prev.map(row => 
          row.id === rowId ? { ...row, [column]: currentRow?.[column] ?? null } : row
        ));
        setTimeout(() => setMessage(null), 3000);
        return;
      }

      // 성공 - 수정된 행 표시 해제 (이미 DB에 저장됨)
      setModifiedRows(prev => {
        const updated = new Set(prev);
        updated.delete(rowId);
        return updated;
      });
      
      // AI 분석 재요청 트리거 (디바운스용 - 여러 셀 수정 시 마지막에만)
      setAiRefreshTrigger(prev => prev + 1);
      
      // 모든 셀 수정 시 알람 체크 (컬럼명과 무관하게)
      await checkAlarmAfterUpdate(rowId, dataObj);

    } catch (err) {
      console.error('Save cell error:', err);
      setMessage({ type: 'error', text: '네트워크 오류. 다시 시도해주세요.' });
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // 일괄 저장 (Upsert) - data 필드(JSONB)에 JSON 객체로 저장
  const handleBatchSave = async () => {
    if (unsavedChangesCount === 0) {
      setMessage({ type: 'error', text: '저장할 변경사항이 없습니다.' });
      setTimeout(() => setMessage(null), 2000);
      return;
    }

    setIsSaving(true);
    setMessage({ type: 'success', text: '일괄 저장 중...' });

    try {
      let savedCount = 0;
      let insertedCount = 0;

      // 행 데이터를 data 필드(JSONB)로 변환하는 헬퍼 함수
      const rowToDataField = (row: RowData, includeMetadata = false, rowIdx = 0) => {
        const dataObj: Record<string, CellValue> = {};
        headers.forEach(h => {
          if (h !== 'id' && h !== 'file_name' && h !== 'row_index') {
            dataObj[h] = row[h];
          }
        });
        
        // 새 행 삽입 시 file_name, row_index 포함
        if (includeMetadata) {
          return {
            file_name: fileId ? decodeURIComponent(fileId) : 'unknown',
            row_index: rowIdx,
            data: dataObj,
          };
        }
        return { data: dataObj };
      };

      // 1. 수정된 기존 행 업데이트 (data 필드만 업데이트)
      if (modifiedRows.size > 0) {
        const rowsToUpdate = data.filter(row => modifiedRows.has(row.id));
        
        for (const row of rowsToUpdate) {
          const updatePayload = rowToDataField(row);
          const { error } = await supabase
            .from('재고')
            .update(updatePayload)
            .eq('id', row.id);

          if (error) {
            console.error(`Update error for row ${row.id}:`, error);
            throw error;
          }
          savedCount++;
        }
      }

      // 2. 새로 추가된 행 삽입 (file_name, row_index, data 포함)
      if (newRows.size > 0) {
        const currentMaxIndex = data.length;
        const rowsToInsert = Array.from(newRows.values()).map((row, idx) => {
          return rowToDataField(row, true, currentMaxIndex + idx);
        });

        const { data: insertedData, error } = await supabase
          .from('재고')
          .insert(rowsToInsert)
          .select();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }

        if (insertedData) {
          // 삽입된 행을 data에 추가 (평탄화 + base_stock/alarm_status 포함)
          const flattenedInserted: RowData[] = insertedData.map(item => {
            const flatRow: RowData = {
              id: item.id,
              base_stock: item.base_stock ?? null,
              alarm_status: item.alarm_status ?? false,
            };
            if (item.data && typeof item.data === 'object') {
              Object.entries(item.data as object).forEach(([key, value]) => {
                flatRow[key] = value as CellValue;
              });
            }
            return flatRow;
          });
          setData(prev => [...prev, ...flattenedInserted]);
          insertedCount = insertedData.length;
        }
      }

      // 상태 초기화
      setModifiedRows(new Set());
      setNewRows(new Map());

      setMessage({ 
        type: 'success', 
        text: `저장 완료! (수정: ${savedCount}개, 추가: ${insertedCount}개)` 
      });
      setTimeout(() => setMessage(null), 3000);
      
      // AI 분석 재요청 트리거
      setAiRefreshTrigger(prev => prev + 1);

    } catch (err) {
      console.error('Batch save error:', err);
      setMessage({ type: 'error', text: '일괄 저장 중 오류가 발생했습니다.' });
    } finally {
      setIsSaving(false);
    }
  };

  // 행 삭제
  const handleDeleteRow = async (rowId: number) => {
    if (!confirm('이 행을 삭제하시겠습니까?')) return;

    try {
      const { error } = await supabase
        .from('재고')
        .delete()
        .eq('id', rowId);

      if (error) throw error;

      setData(prev => prev.filter(row => row.id !== rowId));
      setMessage({ type: 'success', text: '삭제되었습니다.' });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error('Delete error:', err);
      setMessage({ type: 'error', text: '삭제 중 오류가 발생했습니다.' });
    }
  };

  // 기준 재고 확정 저장 (개별)
  const handleConfirmBaseStock = async (rowId: number, baseStock: number) => {
    try {
      // ✅ 먼저 로컬 상태를 즉시 업데이트 (UI가 바로 초록색으로 변경)
      setData(prev => prev.map(row => 
        row.id === rowId 
          ? { ...row, base_stock: baseStock, alarm_status: false }
          : row
      ));
      
      const response = await fetch('/api/inventory/check-alarm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, baseStock }),
      });

      const result = await response.json();

      if (!result.success) {
        // 실패 시 롤백
        setData(prev => prev.map(row => 
          row.id === rowId 
            ? { ...row, base_stock: null, alarm_status: false }
            : row
        ));
        setMessage({ type: 'error', text: result.error || '기준 재고 확정 실패' });
        return;
      }

      // 서버 응답에 따라 알람 상태 갱신
      setData(prev => prev.map(row => 
        row.id === rowId 
          ? { ...row, base_stock: baseStock, alarm_status: result.alarmStatus ?? false }
          : row
      ));

      setMessage({ 
        type: 'success', 
        text: `✅ 기준 재고가 ${baseStock.toLocaleString()}으로 확정되었습니다.`
      });
      setTimeout(() => setMessage(null), 3000);
      
      // AI 분석 재요청 트리거
      setAiRefreshTrigger(prev => prev + 1);

    } catch (err) {
      console.error('Save base_stock error:', err);
      setMessage({ type: 'error', text: '기준 재고 확정 중 오류가 발생했습니다.' });
    }
  };

  // 재고 업데이트 후 알람 체크 (기준 재고가 있을 때만)
  const checkAlarmAfterUpdate = async (rowId: number, updatedData: Record<string, CellValue>) => {
    try {
      const row = data.find(r => r.id === rowId);
      // base_stock이 null이면 (아직 최종 확정 안함) 알람 체크 안함
      if (!row || row.base_stock === null || row.base_stock === undefined) return;

      const response = await fetch('/api/inventory/check-alarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, data: updatedData }),
      });

      const result = await response.json();

      if (result.success) {
        // 로컬 알람 상태 업데이트
        setData(prev => prev.map(r => 
          r.id === rowId ? { ...r, alarm_status: result.alarmStatus } : r
        ));

        // 알람 상태가 변경되면 알림
        if (result.alarmStatus && !row.alarm_status) {
          setMessage({ type: 'error', text: result.message || '⚠️ 재고가 부족합니다!' });
          setTimeout(() => setMessage(null), 4000);
        }
      }
    } catch (err) {
      console.error('Check alarm error:', err);
    }
  };

  // 최종 확정 모달 열기
  const openConfirmModal = (row: RowData) => {
    // 품목명 찾기
    const nameKeys = ['품목', '품목명', '상품명', '제품명', '이름', 'name', 'item', 'product'];
    let itemName = '';
    for (const key of nameKeys) {
      const found = headers.find(h => h.toLowerCase().includes(key.toLowerCase()));
      if (found && row[found]) {
        itemName = String(row[found]);
        break;
      }
    }

    // 현재 재고 값 찾기
    const stockKeys = ['현재재고', '현재_재고', '재고', '재고량', '수량', 'stock', 'quantity'];
    let currentStock = 0;
    for (const key of stockKeys) {
      const found = headers.find(h => h.toLowerCase().replace(/\s/g, '').includes(key.toLowerCase()));
      if (found && row[found] !== null && row[found] !== undefined) {
        currentStock = Number(row[found]) || 0;
        break;
      }
    }

    setConfirmModal({
      isOpen: true,
      rowId: row.id,
      currentStock,
      itemName,
    });
  };

  // 전체 최종 확정 - 모든 행의 현재 재고를 기준 재고로 설정
  const [isBulkConfirming, setIsBulkConfirming] = useState(false);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null);
  
  // 재고 컬럼에서 현재 재고 값 찾기 (헬퍼 함수)
  const findCurrentStockValue = (row: RowData): number => {
    const stockKeys = ['현재재고', '현재_재고', '재고', '재고량', '수량', 'stock', 'quantity'];
    for (const key of stockKeys) {
      const found = headers.find(h => h.toLowerCase().replace(/[\s_]/g, '').includes(key.toLowerCase().replace(/[\s_]/g, '')));
      if (found && row[found] !== null && row[found] !== undefined) {
        return Number(row[found]) || 0;
      }
    }
    // 키워드 매칭 실패 시 첫 번째 숫자 컬럼 사용
    for (const h of headers) {
      if (h === 'id') continue;
      const val = row[h];
      if (typeof val === 'number' && val >= 0) return val;
    }
    return 0;
  };
  
  const handleBulkConfirm = async () => {
    // 확인 다이얼로그
    const confirmed = window.confirm(
      `모든 행(${data.length}개)의 현재 재고를 기준 재고로 확정하시겠습니까?\n\n` +
      `확정 후 재고가 이 수치 아래로 떨어지면 알람이 표시됩니다.`
    );
    
    if (!confirmed) return;

    try {
      setIsBulkConfirming(true);
      setMessage({ type: 'success', text: '전체 최종 확정 중...' });

      const response = await fetch('/api/inventory/check-alarm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileName: fileId ? decodeURIComponent(fileId) : '',
        }),
      });

      const result = await response.json();

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '전체 확정 실패' });
        setTimeout(() => setMessage(null), 5000);
        return;
      }

      // ✅ 즉시 로컬 상태 업데이트 (UI가 바로 반영되도록)
      setData(prev => prev.map(row => {
        const currentStock = findCurrentStockValue(row);
        return {
          ...row,
          base_stock: currentStock,
          alarm_status: false, // 확정 시점에서는 알람 없음
        };
      }));

      // 최종 확정 일시 즉시 갱신 + localStorage에 저장
      const now = new Date().toISOString();
      setLastConfirmedAt(now);
      try {
        if (fileId) localStorage.setItem(LAST_CONFIRM_KEY(fileId), now);
      } catch {
        // ignore
      }

      setMessage({ 
        type: 'success', 
        text: result.message || `✅ ${result.successCount}개 행이 최종 확정되었습니다.`
      });
      setTimeout(() => setMessage(null), 4000);
      
      // AI 분석 재요청 트리거
      setAiRefreshTrigger(prev => prev + 1);

    } catch (err) {
      console.error('Bulk confirm error:', err);
      setMessage({ type: 'error', text: '전체 확정 중 오류가 발생했습니다.' });
    } finally {
      setIsBulkConfirming(false);
    }
  };

  // 새 행 추가 - file_name, row_index, data 포함
  const handleAddRow = async () => {
    try {
      // data 필드에 저장할 빈 JSON 객체 생성
      const dataObj: Record<string, CellValue> = {};
      headers.forEach(h => {
        if (h !== 'id' && h !== 'file_name' && h !== 'row_index') {
          dataObj[h] = null;
        }
      });

      const { data: inserted, error } = await supabase
        .from('재고')
        .insert([{
          file_name: fileId ? decodeURIComponent(fileId) : 'unknown',
          row_index: data.length,
          data: dataObj,
        }])
        .select()
        .single();

      if (error) throw error;

      if (inserted) {
        // 평탄화해서 추가 (base_stock, alarm_status 포함)
        const flatRow: RowData = {
          id: inserted.id,
          base_stock: inserted.base_stock ?? null,
          alarm_status: inserted.alarm_status ?? false,
        };
        if (inserted.data && typeof inserted.data === 'object') {
          Object.entries(inserted.data as object).forEach(([key, value]) => {
            flatRow[key] = value as CellValue;
          });
        }
        // 모든 헤더에 대해 값이 없으면 null
        headers.forEach(h => {
          if (h !== 'id' && !(h in flatRow)) {
            flatRow[h] = null;
          }
        });
        
        setData(prev => [...prev, flatRow]);
        setMessage({ type: 'success', text: '새 행이 추가되었습니다.' });
        setTimeout(() => setMessage(null), 2000);
      }
    } catch (err) {
      console.error('Insert error:', err);
      setMessage({ type: 'error', text: '행 추가 중 오류가 발생했습니다.' });
    }
  };

  // 새 컬럼 추가 - JSONB 사용으로 DB 스키마 변경 불필요, 로컬에서 바로 추가
  const handleAddColumn = async (columnName: string, _columnType: string) => {
    try {
      // 이미 존재하는 컬럼인지 확인
      if (headers.includes(columnName)) {
        setMessage({ type: 'error', text: `'${columnName}' 컬럼이 이미 존재합니다.` });
        return;
      }

      // JSONB 사용으로 실제 DB 스키마 변경 없이 로컬에서 바로 추가
      // 헤더에 새 컬럼 추가
      setHeaders(prev => [...prev, columnName]);

      // 기존 데이터에 새 컬럼 추가 (null 값으로)
      setData(prev => prev.map(row => ({
        ...row,
        [columnName]: null,
      })));

      // 기존 행들에 새 컬럼 추가를 위해 수정됨으로 표시
      if (data.length > 0) {
        setModifiedRows(prev => {
          const updated = new Set(prev);
          data.forEach(row => updated.add(row.id));
          return updated;
        });
      }

      setMessage({ type: 'success', text: `'${columnName}' 컬럼이 추가되었습니다. 일괄 저장을 클릭하여 DB에 반영하세요.` });
      setTimeout(() => setMessage(null), 4000);
      setShowAddColumnModal(false);
    } catch (err) {
      console.error('Add column error:', err);
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '컬럼 추가 중 오류가 발생했습니다.' });
    }
  };

  // 엑셀 내보내기
  const handleExportExcel = async () => {
    if (data.length === 0) {
      setMessage({ type: 'error', text: '내보낼 데이터가 없습니다.' });
      return;
    }

    try {
      setIsSaving(true);
      setMessage({ type: 'success', text: '엑셀 파일 생성 중...' });

      // 데이터 행 변환 (빈 값도 구조 유지)
      const rows = data.map(row => 
        headers.map(header => {
          const value = row[header];
          // null/undefined는 빈 문자열로, 나머지는 그대로
          return value === null || value === undefined ? '' : value;
        })
      );

      const response = await fetch('/api/excel/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers,
          rows,
          fileName: `재고_데이터_${new Date().toISOString().split('T')[0]}`,
          includeEmptyRows: true,
        }),
      });

      if (!response.ok) {
        throw new Error('엑셀 파일 생성 실패');
      }

      // 파일 다운로드
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `재고_데이터_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMessage({ type: 'success', text: '엑셀 파일이 다운로드되었습니다.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setMessage({ type: 'error', text: '엑셀 내보내기 중 오류가 발생했습니다.' });
    } finally {
      setIsSaving(false);
    }
  };

  // 컬럼 너비 계산
  const getColumnWidth = (header: string) => {
    if (header.toLowerCase() === 'id') return 0;
    const maxLen = Math.max(
      header.length,
      ...data.slice(0, 50).map(row => String(row[header] ?? '').length)
    );
    return Math.min(Math.max(maxLen * 9 + 16, 80), 200);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0F172A] relative">
      {/* 전체 최종 확정 진행 오버레이 */}
      {isBulkConfirming && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-600 p-8 max-w-md mx-4 flex flex-col items-center">
            <div className="w-16 h-16 border-4 border-green-200 rounded-full flex items-center justify-center mb-4">
              <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">전체 최종 확정 중</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{data.length}개 행 처리 중...</p>
            <div className="mt-6 w-full max-w-xs">
              <div className="h-2 bg-green-100 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full animate-progress-slide" />
              </div>
              <p className="text-xs text-green-600 mt-2 text-center">약 10~30초 소요될 수 있습니다</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white dark:bg-slate-900/95 border-b border-gray-200 dark:border-slate-700 shadow-sm">
        <div className="w-full px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[400px]" title={fileId ? decodeURIComponent(fileId) : '파일'}>
                  {fileId ? decodeURIComponent(fileId) : '파일'}
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  셀을 클릭하여 수정 • Enter로 저장 • Esc로 취소
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* 저장 상태 표시 */}
              {isSaving && (
                <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  저장 중...
                </span>
              )}

              {/* 메시지 표시 */}
              {message && (
                <span className={`px-2 py-1 text-xs rounded ${
                  message.type === 'success' 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-red-100 text-red-700'
                }`}>
                  {message.text}
                </span>
              )}

              {/* 일괄 저장 버튼 */}
              <button
                onClick={handleBatchSave}
                disabled={unsavedChangesCount === 0 || isSaving}
                className={`flex items-center gap-1.5 px-4 py-2 text-white text-xs font-medium rounded-lg transition-all shadow-sm ${
                  unsavedChangesCount > 0
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600'
                    : 'bg-gray-400 cursor-not-allowed'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isSaving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                )}
                {isSaving ? '저장 중...' : `일괄 저장 ${unsavedChangesCount > 0 ? `(${unsavedChangesCount})` : ''}`}
              </button>

              {/* 새 행 추가 */}
              <button
                onClick={handleAddRow}
                className="flex items-center gap-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                행 추가
              </button>

              {/* 새 컬럼 추가 */}
              <button
                onClick={() => setShowAddColumnModal(true)}
                className="flex items-center gap-1 px-3 py-2 bg-violet-500 hover:bg-violet-600 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                컬럼 추가
              </button>

              {/* 전체 최종 확정 버튼 */}
              <button
                onClick={handleBulkConfirm}
                disabled={data.length === 0 || isBulkConfirming}
                className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-xs font-medium rounded-lg transition-colors disabled:cursor-not-allowed shadow-sm"
              >
                {isBulkConfirming ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {isBulkConfirming ? '확정 중...' : '전체 최종 확정'}
              </button>

              {lastConfirmedAt && (
                <span className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  최종 확정 일시: {formatConfirmTimestamp(lastConfirmedAt)}
                </span>
              )}

              {/* 엑셀 내보내기 */}
              <button
                onClick={handleExportExcel}
                disabled={data.length === 0 || isSaving}
                className="flex items-center gap-1 px-3 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white text-xs font-medium rounded-lg transition-colors disabled:cursor-not-allowed shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                엑셀 내보내기
              </button>

              {/* 파일 상세 페이지로 */}
              <Link
                href={`/management/file/${encodeURIComponent(fileId ? decodeURIComponent(fileId) : '')}`}
                className="flex items-center gap-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                뒤로
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* AI 경영 브리핑 섹션 */}
      <div className="px-4 py-4 bg-gray-50 dark:bg-slate-800/50">
        <AIBriefing 
          data={data}
          headers={headers}
          fileName={fileId ? decodeURIComponent(fileId) : ''}
          onRefreshTrigger={aiRefreshTrigger}
          totalOrderBudget={totalOrderBudget}
        />
      </div>

      {/* Stats Bar */}
      <div className="bg-white dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700 px-4 py-2">
        <div className="flex items-center justify-between">
          {/* 왼쪽: 통계 정보 */}
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>총 <span className="text-gray-900 dark:text-white font-medium">{data.length}</span> 행</span>
            <span>•</span>
            <span><span className="text-gray-900 dark:text-white font-medium">{headers.length}</span> 컬럼</span>
            {(searchQuery || filterLowStockOnly) && (
              <>
                <span>•</span>
                <span className="text-cyan-600">
                  표시: <span className="font-medium">{filteredData.length}</span>개
                </span>
              </>
            )}
            {sortConfig.column && (
              <>
                <span>•</span>
                <span className="text-violet-600">
                  정렬: {sortConfig.column} ({sortConfig.direction === 'asc' ? '오름차순' : '내림차순'})
                </span>
              </>
            )}
            {modifiedRows.size > 0 && (
              <>
                <span>•</span>
                <span className="text-orange-600">
                  <span className="font-medium">{modifiedRows.size}</span>개 수정됨
                </span>
              </>
            )}
            {newRows.size > 0 && (
              <>
                <span>•</span>
                <span className="text-emerald-600">
                  <span className="font-medium">{newRows.size}</span>개 새 행
                </span>
              </>
            )}
            {unsavedChangesCount > 0 && (
              <>
                <span>•</span>
                <span className="text-yellow-600 font-medium">
                  저장되지 않은 변경사항 {unsavedChangesCount}개
                </span>
              </>
            )}
            {data.filter(row => row.alarm_status && row.base_stock !== null).length > 0 && (
              <>
                <span>•</span>
                <span className="text-red-600 font-medium">
                  🚨 재고부족 {data.filter(row => row.alarm_status && row.base_stock !== null).length}개
                </span>
              </>
            )}
          </div>

          {/* 오른쪽: 정렬 초기화 */}
          {sortConfig.column && (
            <button
              onClick={() => setSortConfig({ column: null, direction: null })}
              className="px-2 py-1.5 text-xs bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors"
              title="정렬 초기화"
            >
              정렬 해제
            </button>
          )}
        </div>
      </div>

      {/* 요약 대시보드 */}
      {data.length > 0 && headers.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-[#E5E7EB]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* 전체 품목 */}
            <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[#E5E7EB] dark:border-slate-600 rounded-xl shadow-sm">
              <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">전체 품목</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{summaryStats.total.toLocaleString()}</p>
              </div>
            </div>
            {/* 재고 부족 */}
            <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[#E5E7EB] dark:border-slate-600 rounded-xl shadow-sm">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">재고 부족</p>
                <p className="text-xl font-bold text-red-600">{summaryStats.lowStock.toLocaleString()}</p>
              </div>
            </div>
            {/* 최종 확정 */}
            <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[#E5E7EB] dark:border-slate-600 rounded-xl shadow-sm">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">최종 확정</p>
                <p className="text-xl font-bold text-green-600">{summaryStats.confirmed.toLocaleString()}</p>
              </div>
            </div>
            {/* 총 예상 발주 비용 */}
            <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-[#E5E7EB] dark:border-slate-600 rounded-xl shadow-sm">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Banknote className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">총 예상 발주 비용</p>
                <p className="text-xl font-bold text-amber-700">{formatCurrency(totalOrderBudget)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 검색 및 필터링 (대시보드와 테이블 사이) */}
      {data.length > 0 && headers.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            {/* 품목명 검색창 */}
            <div className="relative flex-1">
              <svg 
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="품목명 검색..."
                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-[#E5E7EB] rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {/* 재고 부족 품목만 보기 토글 */}
            <button
              onClick={() => setFilterLowStockOnly(prev => !prev)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                filterLowStockOnly 
                  ? 'bg-red-50 border-red-200 text-red-700' 
                  : 'bg-gray-50 border-[#E5E7EB] text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg 
                className="w-4 h-4" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              재고 부족만
            </button>
          </div>
        </div>
      )}

      {/* Grid Editor - LTR 정렬 + 드래그 스크롤, 모바일 가로 스크롤 */}
      <div 
        className={`w-full min-w-0 overflow-x-auto overflow-y-auto bg-white ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ WebkitOverflowScrolling: 'touch', maxHeight: 'calc(100vh - 200px)' }}
        ref={(el) => {
          // 두 ref를 모두 연결
          (tableRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (dragScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        dir="ltr"
      >
        {data.length === 0 && headers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[500px]">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-600 mb-4">데이터가 없습니다.</p>
            <Link href="/" className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg shadow-sm">
              엑셀 업로드하러 가기
            </Link>
          </div>
        ) : (
          <table className="border-collapse text-left" data-excel-grid="true" style={{ minWidth: Math.max(getDisplayHeaders(headers).reduce((sum, h) => sum + getColumnWidth(h), 0) + 50 + 112 + 128, 800) }}>
            {/* Header (ID 컬럼 UI 비노출) - 엑셀 스타일 제목줄 */}
            <thead className="sticky top-0 z-10">
              <tr>
                {/* 액션 컬럼 */}
                <th className="w-14 px-1 py-3 text-center text-xs font-semibold text-gray-500 border border-gray-200 bg-gray-50 sticky left-0 z-20">
                  
                </th>
                {getDisplayHeaders(headers).map((header) => {
                  const isSorted = sortConfig.column === header;
                  const sortDirection = isSorted ? sortConfig.direction : null;
                  
                  return (
                    <th
                      key={header}
                      onClick={() => handleSort(header)}
                      style={{ width: getColumnWidth(header), minWidth: getColumnWidth(header) }}
                      className={`px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider border border-gray-200 cursor-pointer select-none transition-colors group ${
                        isSorted 
                          ? 'text-violet-700 bg-violet-50' 
                          : 'text-gray-600 bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{header}</span>
                        <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <svg className="w-3.5 h-3.5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            )
                          ) : (
                            <svg className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
                {/* 단가 (편집 가능) */}
                <th className="w-28 px-2 py-3 text-right text-xs font-semibold text-gray-600 border border-gray-200 bg-amber-50">
                  단가
                </th>
                {/* 예상 비용 */}
                <th className="w-32 px-2 py-3 text-right text-xs font-semibold text-gray-600 border border-gray-200 bg-amber-50">
                  예상 비용
                </th>
                {/* 컬럼 추가 버튼 - 항상 맨 오른쪽에 표시 */}
                <th 
                  className={`w-12 px-2 py-3 text-center border border-gray-200 bg-gray-50 sticky right-0 z-20 transition-all ${
                    showAddColumnButton ? 'opacity-100' : 'opacity-50 hover:opacity-100'
                  }`}
                >
                  <button
                    onClick={() => setShowAddColumnModal(true)}
                    className="w-8 h-8 flex items-center justify-center bg-violet-500 hover:bg-violet-600 text-white rounded-lg transition-colors shadow-sm"
                    title="새 컬럼 추가"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </th>
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {displayData.map((row, rowIndex) => {
                const isEmptyRow = row.id < 0; // 빈 행 판별
                const isNewRow = newRows.has(row.id); // 새로 추가된 행 (저장 대기)
                const isPureEmptyRow = isEmptyRow && !isNewRow; // 순수 빈 행
                const isConfirmed = !isEmptyRow && row.base_stock !== null && row.base_stock !== undefined; // 확정된 행
                const hasAlarm = !isEmptyRow && row.alarm_status && isConfirmed; // 재고 부족 알람
                const isModified = !isEmptyRow && modifiedRows.has(row.id) && !hasAlarm;
                
                // 행 배경색 결정 (우선순위: 알람 > 수정됨 > 새행 > 확정됨 > 기본)
                let rowBgClass = rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                let borderClass = '';
                
                if (hasAlarm) {
                  rowBgClass = 'bg-red-50';
                  borderClass = 'border-l-4 border-l-red-500';
                } else if (isModified) {
                  rowBgClass = 'bg-orange-50';
                  borderClass = 'border-l-4 border-l-orange-400';
                } else if (isNewRow) {
                  rowBgClass = 'bg-emerald-50';
                  borderClass = 'border-l-4 border-l-emerald-500';
                } else if (isConfirmed) {
                  // ✅ 확정된 행: 연한 초록색 배경 + 초록색 왼쪽 테두리
                  rowBgClass = 'bg-green-50/70';
                  borderClass = 'border-l-4 border-l-green-500';
                } else if (isPureEmptyRow) {
                  rowBgClass = 'bg-gray-50/50';
                }
                
                return (
                <tr
                  key={row.id}
                  className={`
                    ${rowBgClass}
                    ${borderClass}
                    ${isPureEmptyRow ? 'hover:bg-gray-100' : 'hover:bg-green-100/50'}
                    transition-colors
                  `}
                >
                  {/* 액션 버튼 (빈 행에는 표시 안함) */}
                  <td className="w-20 px-1 py-0 text-center border border-gray-100 bg-inherit sticky left-0">
                    {!isEmptyRow && (
                      <div className="flex items-center justify-center gap-0.5">
                        {/* 최종 확정 버튼 */}
                        <button
                          onClick={() => openConfirmModal(row)}
                          className={`p-1.5 rounded-lg transition-all ${
                            hasAlarm 
                              ? 'text-white bg-red-500 hover:bg-red-600 shadow-sm' 
                              : isConfirmed
                                ? 'text-white bg-green-500 hover:bg-green-600 shadow-sm'
                                : 'text-gray-400 bg-gray-100 hover:text-green-600 hover:bg-green-100'
                          }`}
                          title={hasAlarm 
                            ? `⚠️ 재고 부족! (기준재고: ${row.base_stock?.toLocaleString()})` 
                            : isConfirmed
                              ? `✅ 확정됨 (기준재고: ${row.base_stock?.toLocaleString()})`
                              : '⭕ 미확정 - 클릭하여 기준재고 설정'
                          }
                        >
                          {hasAlarm ? (
                            // 재고 부족 시 경고 아이콘
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          ) : isConfirmed ? (
                            // 확정 완료 시 체크 아이콘 (채워진 스타일)
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            // 미확정 시 - 빈 원 아이콘
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="9" strokeWidth={2} />
                            </svg>
                          )}
                        </button>
                        {/* 삭제 버튼 */}
                        <button
                          onClick={() => handleDeleteRow(row.id)}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-100 rounded transition-colors"
                          title="삭제"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </td>

                  {/* 데이터 셀 */}
                  {getDisplayHeaders(headers).map((header) => {
                    const isEditing = editingCell?.rowId === row.id && editingCell?.column === header;

                    return (
                      <td
                        key={header}
                        style={{ width: getColumnWidth(header), minWidth: getColumnWidth(header) }}
                        className={`
                          p-0 border border-gray-100 text-sm text-gray-700
                          ${isEditing ? 'p-0' : ''}
                          ${!isEditing ? 'cursor-pointer' : ''}
                          ${isEmptyRow && !isEditing ? 'opacity-50' : ''}
                        `}
                      >
                        <EditableCell
                            value={row[header]}
                            rowId={row.id}
                            column={header}
                            isEditing={isEditing}
                            onStartEdit={() => handleStartEdit(row.id, header, row[header])}
                            onSave={(newValue) => handleSaveCell(row.id, header, newValue)}
                            onCancel={() => setEditingCell(null)}
                            onValidationError={(msg) => {
                              setMessage({ type: 'error', text: msg });
                              setTimeout(() => setMessage(null), 3000);
                            }}
                            stockStatusBadge={header === currentStockColumn && !isEmptyRow ? getStockStatusBadge(row, headers, currentStockColumn) : null}
                          />
                      </td>
                    );
                  })}
                  {/* 단가 (편집 가능) */}
                  <td className="w-28 px-2 py-1.5 text-right border border-gray-100 bg-amber-50/50">
                    {isEmptyRow ? (
                      <span className="text-gray-400 text-xs">-</span>
                    ) : editingUnitPriceRowId === row.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={getEffectiveUnitPrice(row)}
                          onBlur={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v) && v >= 0) {
                              setUnitPriceOverrides(prev => new Map(prev).set(row.id, v));
                            }
                            setEditingUnitPriceRowId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = parseInt((e.target as HTMLInputElement).value, 10);
                              if (!isNaN(v) && v >= 0) {
                                setUnitPriceOverrides(prev => new Map(prev).set(row.id, v));
                              }
                              setEditingUnitPriceRowId(null);
                            } else if (e.key === 'Escape') {
                              setEditingUnitPriceRowId(null);
                            }
                          }}
                          className="w-20 px-1 py-0.5 text-xs font-mono border border-amber-300 rounded focus:ring-1 focus:ring-amber-500 outline-none"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingUnitPriceRowId(row.id)}
                        className="text-xs font-mono text-amber-800 hover:bg-amber-100 px-1 py-0.5 rounded cursor-pointer w-full text-right"
                        title="클릭하여 단가 수정"
                      >
                        {getEffectiveUnitPrice(row).toLocaleString()}원
                      </button>
                    )}
                  </td>
                  {/* 예상 비용 */}
                  <td className="w-32 px-2 py-1.5 text-right border border-gray-100 bg-amber-50/50 font-mono text-sm">
                    {isEmptyRow ? (
                      <span className="text-gray-400 text-xs">-</span>
                    ) : (
                      <span className={getRowOrderCost(row) > 0 ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
                        {getRowOrderCost(row) > 0 ? formatCurrency(getRowOrderCost(row)) : '-'}
                      </span>
                    )}
                  </td>
                  {/* 컬럼 추가 버튼 자리 (빈 셀) */}
                  <td className="w-12 border border-gray-100 bg-inherit sticky right-0"></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer Help */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 shadow-lg">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span><kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">Click</kbd> 셀 편집</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">Enter</kbd> 로컬 저장</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">Esc</kbd> 취소</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">Tab</kbd> 다음 셀</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
              <span className="text-red-600">재고부족</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span className="text-green-600">기준재고 확정</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
              <span className="text-orange-600">수정됨</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              <span className="text-emerald-600">새 행</span>
            </span>
          </div>
        </div>
      </div>

      {/* 컬럼 추가 모달 */}
      <AddColumnModal
        isOpen={showAddColumnModal}
        onClose={() => setShowAddColumnModal(false)}
        onAdd={handleAddColumn}
      />

      {/* 최종 확정 모달 */}
      <ConfirmBaseStockModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        rowId={confirmModal.rowId}
        currentStock={confirmModal.currentStock}
        itemName={confirmModal.itemName}
        onConfirm={handleConfirmBaseStock}
      />
    </div>
  );
}

