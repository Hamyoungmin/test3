'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AlertModal from '@/components/AlertModal';

interface Alert {
  id: number;
  file_name: string;
  column_name: string;
  condition_type: 'below' | 'above' | 'equals';
  threshold_value: number;
  notification_type: string[];
  email?: string;
  is_active: boolean;
}

interface TriggeredAlert {
  alert: Alert;
  triggeredRows: Array<{
    rowIndex: number;
    currentValue: number;
  }>;
}

type InventoryRow = Record<string, string | number | boolean | null>;

// DB 데이터 테이블 컴포넌트
function DBDataTable({ 
  data, 
  headers,
  onRefresh,
  isLoading,
  triggeredAlerts = [],
}: { 
  data: InventoryRow[]; 
  headers: string[];
  onRefresh: () => void;
  isLoading: boolean;
  triggeredAlerts?: TriggeredAlert[];
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // 경고 행 인덱스 맵 생성
  const alertRowMap = useMemo(() => {
    const map = new Map<number, { column: string; value: number; threshold: number; type: string }[]>();
    triggeredAlerts.forEach(triggered => {
      triggered.triggeredRows.forEach(row => {
        const existing = map.get(row.rowIndex) || [];
        existing.push({
          column: triggered.alert.column_name,
          value: row.currentValue,
          threshold: triggered.alert.threshold_value,
          type: triggered.alert.condition_type,
        });
        map.set(row.rowIndex, existing);
      });
    });
    return map;
  }, [triggeredAlerts]);

  // 검색 및 정렬된 데이터
  const filteredAndSortedData = useMemo(() => {
    let result = [...data];

    // 검색 필터
    if (searchTerm) {
      result = result.filter((row) =>
        Object.values(row).some((cell) =>
          String(cell ?? '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    // 정렬
    if (sortColumn !== null) {
      result.sort((a, b) => {
        const aVal = a[sortColumn] ?? '';
        const bVal = b[sortColumn] ?? '';

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }

        const aStr = String(aVal);
        const bStr = String(bVal);
        return sortDirection === 'asc'
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      });
    }

    return result;
  }, [data, searchTerm, sortColumn, sortDirection]);

  // 가상화 설정
  const rowVirtualizer = useVirtualizer({
    count: filteredAndSortedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  // 컬럼 너비 계산
  const columnWidths = useMemo(() => {
    const minWidth = 100;
    const maxWidth = 200;
    
    return headers.map((header) => {
      let maxLength = header.length;
      
      const sampleRows = filteredAndSortedData.slice(0, 100);
      sampleRows.forEach(row => {
        const cellLength = String(row[header] ?? '').length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      
      const calculatedWidth = Math.min(Math.max(maxLength * 9 + 24, minWidth), maxWidth);
      return calculatedWidth;
    });
  }, [headers, filteredAndSortedData]);

  const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + 60;

  return (
    <div className="bg-[#16213e] rounded-lg border border-[#0f3460] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#0f3460] bg-[#1a1a2e]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              파일 데이터
            </h3>
            <p className="text-xs text-gray-400">
              총 {filteredAndSortedData.length.toLocaleString()}개의 행
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-1.5 w-full sm:w-52 bg-[#0f3460] border border-[#1a1a2e] rounded-lg text-sm text-white placeholder-gray-500 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <svg 
                className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              새로고침
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" dir="ltr">
        <div style={{ minWidth: totalWidth }} className="text-left">
          {/* Table Header */}
          <div className="sticky top-0 z-10 bg-[#0f3460] border-b border-[#1a1a2e]">
            <div className="flex">
              {/* Row Number Header */}
              <div className="flex-shrink-0 w-14 px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                #
              </div>
              {/* Column Headers */}
              {headers.map((header, index) => (
                <div
                  key={header}
                  onClick={() => handleSort(header)}
                  style={{ width: columnWidths[index] }}
                  className="flex-shrink-0 px-3 py-2 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#1a1a2e] transition-colors select-none border-l border-[#1a1a2e]"
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{header}</span>
                    {sortColumn === header && (
                      <svg
                        className={`w-3 h-3 flex-shrink-0 transition-transform text-emerald-400 ${
                          sortDirection === 'desc' ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Virtualized Rows */}
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}
          >
            {filteredAndSortedData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                {data.length === 0 ? '저장된 데이터가 없습니다.' : '검색 결과가 없습니다.'}
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = filteredAndSortedData[virtualRow.index];
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className={`flex items-center border-b border-[#0f3460]/50 hover:bg-[#0f3460]/50 transition-colors ${
                        virtualRow.index % 2 === 0 ? 'bg-[#16213e]' : 'bg-[#1a1a2e]'
                      }`}
                    >
                      {/* Row Number */}
                      <div className="flex-shrink-0 w-14 px-3 py-2 text-xs text-gray-500 font-mono">
                        {(virtualRow.index + 1).toLocaleString()}
                      </div>
                      {/* Cells */}
                      {headers.map((header, cellIndex) => {
                        const rowIndex = row.row_index as number | undefined;
                        const alertInfo = rowIndex !== undefined ? alertRowMap.get(rowIndex) : undefined;
                        const cellAlert = alertInfo?.find(a => a.column === header);
                        
                        return (
                          <div
                            key={header}
                            style={{ width: columnWidths[cellIndex] }}
                            className={`flex-shrink-0 px-3 py-2 text-sm border-l border-[#0f3460]/30 ${
                              cellAlert 
                                ? 'bg-red-500/20 text-red-300' 
                                : 'text-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              {cellAlert && (
                                <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                              )}
                              <span 
                                className="block truncate" 
                                title={cellAlert 
                                  ? `⚠️ 경고: ${cellAlert.value} (기준: ${cellAlert.threshold} ${cellAlert.type === 'below' ? '미만' : cellAlert.type === 'above' ? '초과' : '동일'})`
                                  : String(row[header] ?? '')
                                }
                              >
                                {row[header] !== null && row[header] !== undefined ? String(row[header]) : '-'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#0f3460] bg-[#1a1a2e]">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <>
                표시 중: {(rowVirtualizer.getVirtualItems()[0]?.index ?? 0) + 1} - {' '}
                {(rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.index ?? 0) + 1}
              </>
            )}
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <svg className="w-3 h-3 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            스크롤
          </span>
        </div>
      </div>
    </div>
  );
}

export default function FileDetailPage() {
  const params = useParams();
  const router = useRouter();
  const fileName = decodeURIComponent(params.fileName as string);
  
  const [data, setData] = useState<InventoryRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 알림 관련 상태
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([]);
  const [alertCount, setAlertCount] = useState(0);

  // DB에서 해당 파일 데이터 불러오기 (pagination으로 모든 데이터)
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 모든 데이터를 가져오기 위해 pagination 사용
      let allData: InventoryRow[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: fetchError } = await supabase
          .from('재고')
          .select('*')
          .eq('file_name', fileName)
          .range(from, from + batchSize - 1)
          .order('id', { ascending: true });

        if (fetchError) {
          throw fetchError;
        }

        if (batchData && batchData.length > 0) {
          allData = [...allData, ...batchData];
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      if (allData.length > 0) {
        // data 컬럼의 JSON을 풀어서 flat한 데이터로 변환
        const flattenedData: InventoryRow[] = allData.map((item) => {
          const { id, data: jsonData, file_name, row_index, created_at, ...rest } = item;
          // data 컬럼이 JSON 객체인 경우 풀어서 합침
          if (jsonData && typeof jsonData === 'object' && !Array.isArray(jsonData)) {
            const jsonObj = jsonData as Record<string, string | number | boolean | null>;
            return { id, row_index, ...jsonObj, ...rest };
          }
          return { id, row_index, ...rest };
        });

        // 헤더 추출 (첫 번째 행의 data JSON 키들 사용)
        const firstItem = allData[0];
        let dataHeaders: string[] = [];
        if (firstItem.data && typeof firstItem.data === 'object') {
          dataHeaders = Object.keys(firstItem.data as Record<string, unknown>);
        }
        
        setHeaders(['id', ...dataHeaders]);
        setData(flattenedData);
      } else {
        setData([]);
        setHeaders([]);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [fileName]);

  // 알림 조건 체크
  const checkAlerts = useCallback(async () => {
    try {
      const response = await fetch('/api/alerts/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: fileName }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setTriggeredAlerts(result.triggered || []);
        setAlertCount(result.totalTriggered || 0);
      }
    } catch (err) {
      console.error('Check alerts error:', err);
    }
  }, [fileName]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  // 데이터 로드 후 알림 체크
  useEffect(() => {
    if (data.length > 0) {
      checkAlerts();
    }
  }, [data, checkAlerts]);

  // 파일 삭제
  const handleDelete = async () => {
    if (!confirm(`"${fileName}" 파일의 모든 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    setIsLoading(true);
    try {
      const { error: deleteError } = await supabase
        .from('재고')
        .delete()
        .eq('file_name', fileName);

      if (deleteError) {
        throw deleteError;
      }

      // 목록 페이지로 이동
      router.push('/management');
    } catch (err) {
      console.error('Delete error:', err);
      alert('삭제 중 오류가 발생했습니다.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#16213e] border-b border-[#0f3460] shadow-lg">
        <div className="w-full px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              {/* Back Button */}
              <Link
                href="/management"
                className="w-9 h-9 bg-[#0f3460] hover:bg-[#1a1a2e] rounded-lg flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white truncate max-w-[300px]" title={fileName}>
                    {fileName}
                  </h1>
                  <p className="text-xs text-gray-400">
                    {isLoading ? '로딩 중...' : `${data.length.toLocaleString()}개 행`}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* 알림 설정 버튼 */}
              <button
                onClick={() => setIsAlertModalOpen(true)}
                className={`relative flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                  alertCount > 0
                    ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                알림 설정
                {alertCount > 0 && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center text-white font-bold">
                    {alertCount > 99 ? '99+' : alertCount}
                  </span>
                )}
              </button>
              
              {/* 셀 편집 버튼 */}
              {data.length > 0 && (
                <Link
                  href={`/management/${encodeURIComponent(fileName)}/edit`}
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  셀 편집
                </Link>
              )}

              {/* 삭제 버튼 */}
              <button
                onClick={handleDelete}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white text-sm font-medium rounded-lg transition-all border border-red-600/30 hover:border-transparent"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                파일 삭제
              </button>

              {/* 목록으로 */}
              <Link
                href="/management"
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                파일 목록
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-6">
        {/* 알림 경고 배너 */}
        {alertCount > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-500/30 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-400 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-red-300 font-semibold">경고: 조건 충족 데이터 발견!</h3>
                  <p className="text-red-400/80 text-sm">
                    {triggeredAlerts.length}개의 알림 조건에서 총 {alertCount}개의 행이 조건을 충족합니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAlertModalOpen(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-all"
              >
                알림 상세 보기
              </button>
            </div>
            {/* 트리거된 알림 상세 */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {triggeredAlerts.map((triggered, idx) => (
                <div key={idx} className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      triggered.alert.condition_type === 'below'
                        ? 'bg-red-500/30 text-red-300'
                        : triggered.alert.condition_type === 'above'
                        ? 'bg-blue-500/30 text-blue-300'
                        : 'bg-purple-500/30 text-purple-300'
                    }`}>
                      {triggered.alert.condition_type === 'below' ? '미만' : 
                       triggered.alert.condition_type === 'above' ? '초과' : '동일'}
                    </span>
                    <span className="text-amber-400 font-medium text-sm">{triggered.alert.column_name}</span>
                  </div>
                  <p className="text-gray-300 text-xs">
                    기준값 <span className="text-emerald-400">{triggered.alert.threshold_value.toLocaleString()}</span>
                    {triggered.alert.condition_type === 'below' ? ' 미만' : 
                     triggered.alert.condition_type === 'above' ? ' 초과' : '과 동일'}
                  </p>
                  <p className="text-red-400 text-xs mt-1">
                    <span className="font-bold">{triggered.triggeredRows.length}</span>개 행 해당
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="flex items-center justify-center h-[500px]">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">데이터를 불러오는 중...</p>
            </div>
          </div>
        ) : data.length === 0 && !error ? (
          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-8">
            <div className="flex flex-col items-center justify-center h-[400px]">
              <div className="w-20 h-20 bg-[#0f3460] rounded-full flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-300 mb-2">데이터가 없습니다</h3>
              <p className="text-gray-500 text-center text-sm max-w-md mb-6">
                이 파일에는 저장된 데이터가 없습니다.
              </p>
              <Link
                href="/management"
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-all"
              >
                파일 목록으로 돌아가기
              </Link>
            </div>
          </div>
        ) : (
          <DBDataTable 
            data={data} 
            headers={headers} 
            onRefresh={fetchData}
            isLoading={isLoading}
            triggeredAlerts={triggeredAlerts}
          />
        )}
      </main>
      
      {/* 알림 설정 모달 */}
      <AlertModal
        isOpen={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        fileName={fileName}
        columns={headers}
        onAlertCreated={() => {
          checkAlerts();
        }}
      />
    </div>
  );
}

