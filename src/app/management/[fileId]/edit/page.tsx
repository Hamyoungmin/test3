'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useDragScroll } from '@/hooks/useDragScroll';

type CellValue = string | number | boolean | null;
type RowData = Record<string, CellValue> & { id: number };

interface EditingCell {
  rowId: number;
  column: string;
  value: CellValue;
}

// 숫자 전용 컬럼 목록
const NUMERIC_COLUMNS = ['현재_재고', '현재재고', '재고', '단가', '가격', 'price', 'quantity', 'stock', '수량', '금액'];

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
}: {
  value: CellValue;
  rowId: number;
  column: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (newValue: CellValue) => void;
  onCancel: () => void;
  onValidationError?: (message: string) => void;
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

  return (
    <div
      onClick={onStartEdit}
      className={`w-full h-full px-2 py-1.5 cursor-pointer hover:bg-[#0f3460] transition-colors truncate ${
        isNumeric ? 'text-right font-mono' : ''
      }`}
      title={String(value ?? '')}
    >
      {value !== null && value !== undefined ? (
        isNumeric && typeof value === 'number' ? value.toLocaleString() : String(value)
      ) : ''}
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#16213e] rounded-xl border border-[#0f3460] shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-[#0f3460]">
          <h3 className="text-lg font-semibold text-white">새 컬럼 추가</h3>
          <p className="text-xs text-gray-400 mt-1">DB 스키마에 새로운 컬럼을 추가합니다</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              컬럼 이름
            </label>
            <input
              ref={inputRef}
              type="text"
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              placeholder="예: 수량, price, 카테고리"
              className="w-full px-4 py-2.5 bg-[#0f3460] border border-[#1a1a2e] rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">영문, 숫자, 한글, 언더스코어 사용 가능</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              데이터 타입
            </label>
            <select
              value={columnType}
              onChange={(e) => setColumnType(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0f3460] border border-[#1a1a2e] rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
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
              className="flex-1 px-4 py-2.5 bg-[#0f3460] hover:bg-[#1a1a2e] text-gray-300 rounded-lg font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!columnName.trim() || isAdding}
              className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
  const fileId = params.fileId as string;

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
  // 검색 필터
  const [searchQuery, setSearchQuery] = useState('');

  const tableRef = useRef<HTMLDivElement>(null);
  
  // 드래그 스크롤 훅
  const { containerRef: dragScrollRef, isDragging } = useDragScroll({ sensitivity: 1.2, smoothness: 0.9 });
  
  // 가로 스크롤 끝 감지 상태
  const [showAddColumnButton, setShowAddColumnButton] = useState(false);

  // 저장되지 않은 변경사항 개수
  const unsavedChangesCount = modifiedRows.size + newRows.size;

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

  // 검색 필터링된 데이터
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    
    const query = searchQuery.toLowerCase().trim();
    return data.filter(row => {
      return headers.some(header => {
        const value = row[header];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(query);
      });
    });
  }, [data, headers, searchQuery]);

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

        // 헤더 구성: id + data 필드의 모든 키 (엑셀 컬럼 그대로)
        const dataHeaders = Array.from(allDataKeys);
        const sortedHeaders = ['id', ...dataHeaders];
        
        // 데이터 변환: data 필드 내용을 펼쳐서 평탄화 (엑셀처럼 보이도록)
        const flattenedData: RowData[] = uniqueData.map(item => {
          const flatRow: RowData = { id: item.id };
          
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
            file_name: fileId || 'unknown',
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
          // 삽입된 행을 data에 추가 (평탄화해서 추가)
          const flattenedInserted: RowData[] = insertedData.map(item => {
            const flatRow: RowData = { id: item.id };
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
          file_name: fileId || 'unknown',
          row_index: data.length,
          data: dataObj,
        }])
        .select()
        .single();

      if (error) throw error;

      if (inserted) {
        // 평탄화해서 추가
        const flatRow: RowData = { id: inserted.id };
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
    if (header === 'id') return 60;
    const maxLen = Math.max(
      header.length,
      ...data.slice(0, 50).map(row => String(row[header] ?? '').length)
    );
    return Math.min(Math.max(maxLen * 9 + 16, 80), 200);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#16213e] border-b border-[#0f3460] shadow-lg">
        <div className="w-full px-4">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-white truncate max-w-[400px]" title={decodeURIComponent(fileId)}>
                  {decodeURIComponent(fileId)}
                </h1>
                <p className="text-xs text-gray-400">
                  셀을 클릭하여 수정 • Enter로 저장 • Esc로 취소
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* 저장 상태 표시 */}
              {isSaving && (
                <span className="flex items-center gap-1 px-2 py-1 bg-indigo-500/20 text-indigo-400 text-xs rounded">
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
                    ? 'bg-emerald-500/20 text-emerald-400' 
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {message.text}
                </span>
              )}

              {/* 일괄 저장 버튼 */}
              <button
                onClick={handleBatchSave}
                disabled={unsavedChangesCount === 0 || isSaving}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-white text-xs font-medium rounded-lg transition-all ${
                  unsavedChangesCount > 0
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 shadow-lg shadow-orange-500/30 animate-pulse'
                    : 'bg-gray-600 cursor-not-allowed'
                } disabled:opacity-50 disabled:cursor-not-allowed disabled:animate-none`}
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
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                행 추가
              </button>

              {/* 새 컬럼 추가 */}
              <button
                onClick={() => setShowAddColumnModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                컬럼 추가
              </button>

              {/* 엑셀 내보내기 */}
              <button
                onClick={handleExportExcel}
                disabled={data.length === 0 || isSaving}
                className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:bg-teal-600/50 text-white text-xs font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                엑셀 내보내기
              </button>

              {/* 파일 상세 페이지로 */}
              <Link
                href={`/management/file/${encodeURIComponent(decodeURIComponent(fileId))}`}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
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

      {/* Stats Bar + Search */}
      <div className="bg-[#16213e] border-b border-[#0f3460] px-4 py-2">
        <div className="flex items-center justify-between">
          {/* 왼쪽: 통계 정보 */}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>총 <span className="text-white font-medium">{data.length}</span> 행</span>
            <span>•</span>
            <span><span className="text-white font-medium">{headers.length}</span> 컬럼</span>
            {searchQuery && (
              <>
                <span>•</span>
                <span className="text-cyan-400">
                  검색 결과: <span className="font-medium">{filteredData.length}</span>개
                </span>
              </>
            )}
            {sortConfig.column && (
              <>
                <span>•</span>
                <span className="text-violet-400">
                  정렬: {sortConfig.column} ({sortConfig.direction === 'asc' ? '오름차순' : '내림차순'})
                </span>
              </>
            )}
            {modifiedRows.size > 0 && (
              <>
                <span>•</span>
                <span className="text-orange-400">
                  <span className="font-medium">{modifiedRows.size}</span>개 수정됨
                </span>
              </>
            )}
            {newRows.size > 0 && (
              <>
                <span>•</span>
                <span className="text-emerald-400">
                  <span className="font-medium">{newRows.size}</span>개 새 행
                </span>
              </>
            )}
            {unsavedChangesCount > 0 && (
              <>
                <span>•</span>
                <span className="text-yellow-400 font-medium animate-pulse">
                  저장되지 않은 변경사항 {unsavedChangesCount}개
                </span>
              </>
            )}
          </div>

          {/* 오른쪽: 검색창 */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg 
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" 
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
                placeholder="검색어 입력..."
                className="w-64 pl-9 pr-8 py-1.5 bg-[#0f3460] border border-[#1a1a2e] rounded-lg text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {/* 정렬 초기화 버튼 */}
            {sortConfig.column && (
              <button
                onClick={() => setSortConfig({ column: null, direction: null })}
                className="px-2 py-1.5 text-xs bg-violet-600/30 text-violet-300 rounded-lg hover:bg-violet-600/50 transition-colors"
                title="정렬 초기화"
              >
                정렬 해제
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid Editor - LTR 정렬 + 드래그 스크롤 */}
      <div 
        className={`w-full overflow-x-auto overflow-y-auto ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        ref={(el) => {
          // 두 ref를 모두 연결
          (tableRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (dragScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        dir="ltr"
        style={{ maxHeight: 'calc(100vh - 200px)' }}
      >
        {data.length === 0 && headers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[500px]">
            <div className="w-16 h-16 bg-[#0f3460] rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-400 mb-4">데이터가 없습니다.</p>
            <Link href="/" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg">
              엑셀 업로드하러 가기
            </Link>
          </div>
        ) : (
          <table className="border-collapse text-left" style={{ minWidth: Math.max(headers.reduce((sum, h) => sum + getColumnWidth(h), 0) + 50, 800) }}>
            {/* Header */}
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0f3460]">
                {/* 액션 컬럼 */}
                <th className="w-10 px-1 py-2 text-center text-xs font-semibold text-gray-400 border border-[#1a1a2e] bg-[#0f3460] sticky left-0 z-20">
                  
                </th>
                {headers.map((header) => {
                  const isSorted = sortConfig.column === header;
                  const sortDirection = isSorted ? sortConfig.direction : null;
                  
                  return (
                    <th
                      key={header}
                      onClick={() => handleSort(header)}
                      style={{ width: getColumnWidth(header), minWidth: getColumnWidth(header) }}
                      className={`px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider border border-[#1a1a2e] cursor-pointer select-none transition-colors group ${
                        header === 'id' 
                          ? 'text-gray-500 bg-[#0a1628] hover:bg-[#0d1f38]' 
                          : isSorted 
                            ? 'text-violet-300 bg-violet-900/30' 
                            : 'text-gray-300 hover:bg-[#1a2540]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{header}</span>
                        <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            )
                          ) : (
                            <svg className="w-3.5 h-3.5 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
                {/* 컬럼 추가 버튼 - 항상 맨 오른쪽에 표시 */}
                <th 
                  className={`w-12 px-2 py-2 text-center border border-[#1a1a2e] bg-[#0f3460] sticky right-0 z-20 transition-all ${
                    showAddColumnButton ? 'opacity-100' : 'opacity-50 hover:opacity-100'
                  }`}
                >
                  <button
                    onClick={() => setShowAddColumnModal(true)}
                    className="w-8 h-8 flex items-center justify-center bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
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
                
                return (
                <tr
                  key={row.id}
                  className={`
                    ${rowIndex % 2 === 0 ? 'bg-[#16213e]' : 'bg-[#1a1a2e]'}
                    ${!isEmptyRow && modifiedRows.has(row.id) ? 'bg-orange-500/15 border-l-2 border-l-orange-500' : ''}
                    ${isNewRow ? 'bg-emerald-500/15 border-l-2 border-l-emerald-500' : ''}
                    ${isPureEmptyRow ? 'bg-[#12192e] hover:bg-[#1a2540]' : 'hover:bg-[#0f3460]/50'}
                    transition-colors
                  `}
                >
                  {/* 삭제 버튼 (빈 행에는 표시 안함) */}
                  <td className="w-10 px-1 py-0 text-center border border-[#0f3460]/50 bg-inherit sticky left-0">
                    {!isEmptyRow && (
                      <button
                        onClick={() => handleDeleteRow(row.id)}
                        className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
                        title="삭제"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </td>

                  {/* 데이터 셀 */}
                  {headers.map((header) => {
                    const isEditing = editingCell?.rowId === row.id && editingCell?.column === header;
                    const isIdColumn = header === 'id';

                    return (
                      <td
                        key={header}
                        style={{ width: getColumnWidth(header), minWidth: getColumnWidth(header) }}
                        className={`
                          p-0 border border-[#0f3460]/50 text-sm
                          ${isIdColumn ? 'text-gray-500 bg-[#0a1628]/50' : 'text-gray-200'}
                          ${isEditing ? 'p-0' : ''}
                          ${!isIdColumn && !isEditing ? 'cursor-pointer' : ''}
                          ${isEmptyRow && !isEditing ? 'opacity-50' : ''}
                        `}
                      >
                        {isIdColumn ? (
                          // ID 컬럼
                          <div className="px-2 py-1.5 text-center font-mono text-xs h-[30px]">
                            {isEmptyRow ? (
                              <span className="text-gray-600 italic">new</span>
                            ) : (
                              row.id
                            )}
                          </div>
                        ) : (
                          // 편집 가능한 셀 (빈 행 포함)
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
                          />
                        )}
                      </td>
                    );
                  })}
                  {/* 컬럼 추가 버튼 자리 (빈 셀) */}
                  <td className="w-12 border border-[#0f3460]/50 bg-inherit sticky right-0"></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer Help */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#16213e] border-t border-[#0f3460] px-4 py-2">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span><kbd className="px-1.5 py-0.5 bg-[#0f3460] rounded text-gray-400">Click</kbd> 셀 편집</span>
            <span><kbd className="px-1.5 py-0.5 bg-[#0f3460] rounded text-gray-400">Enter</kbd> 로컬 저장</span>
            <span><kbd className="px-1.5 py-0.5 bg-[#0f3460] rounded text-gray-400">Esc</kbd> 취소</span>
            <span><kbd className="px-1.5 py-0.5 bg-[#0f3460] rounded text-gray-400">Tab</kbd> 다음 셀</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
              <span className="text-orange-400">수정됨</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              <span className="text-emerald-400">새 행</span>
            </span>
            <span className="text-yellow-400">
              <kbd className="px-1.5 py-0.5 bg-orange-500/30 rounded text-orange-300">일괄 저장</kbd> 클릭 시 DB 반영
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
    </div>
  );
}

