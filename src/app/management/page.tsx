'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

type InventoryRow = Record<string, string | number | boolean | null>;

// DB 데이터 테이블 컴포넌트
function DBDataTable({ 
  data, 
  headers,
  onRefresh,
  isLoading 
}: { 
  data: InventoryRow[]; 
  headers: string[];
  onRefresh: () => void;
  isLoading: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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
              재고 데이터
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
            style={{ height: 'calc(100vh - 320px)', minHeight: '400px' }}
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
                      {headers.map((header, cellIndex) => (
                        <div
                          key={header}
                          style={{ width: columnWidths[cellIndex] }}
                          className="flex-shrink-0 px-3 py-2 text-sm text-gray-200 border-l border-[#0f3460]/30"
                        >
                          <span 
                            className="block truncate" 
                            title={String(row[header] ?? '')}
                          >
                            {row[header] !== null && row[header] !== undefined ? String(row[header]) : '-'}
                          </span>
                        </div>
                      ))}
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

export default function ManagementPage() {
  const [data, setData] = useState<InventoryRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    columns: 0,
  });

  // DB에서 데이터 불러오기 (파일명 기준 중복 제거)
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: inventoryData, error: fetchError } = await supabase
        .from('재고')
        .select('*')
        .order('id', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

      if (inventoryData && inventoryData.length > 0) {
        // 헤더 추출
        const allHeaders = Object.keys(inventoryData[0]).filter(key => key !== 'id');
        
        // 파일명 컬럼 찾기 (다양한 가능한 이름 확인)
        const fileNameColumns = ['파일명', 'file_name', 'filename', 'fileName', '품목명', '제품명', '상품명'];
        const fileNameColumn = allHeaders.find(h => 
          fileNameColumns.some(fn => h.toLowerCase().includes(fn.toLowerCase()))
        ) || allHeaders[0]; // 찾지 못하면 첫 번째 컬럼 사용
        
        // 파일명 기준 중복 제거 (DISTINCT 효과)
        const seenFileNames = new Set<string>();
        const uniqueData = inventoryData.filter((item) => {
          const fileName = String(item[fileNameColumn] ?? '');
          if (fileName && !seenFileNames.has(fileName)) {
            seenFileNames.add(fileName);
            return true;
          }
          // 파일명이 비어있으면 id로 구분
          if (!fileName) {
            const idKey = `__empty__${item.id}`;
            if (!seenFileNames.has(idKey)) {
              seenFileNames.add(idKey);
              return true;
            }
          }
          return false;
        });
        
        setHeaders(['id', ...allHeaders]);
        setData(uniqueData);
        setStats({
          total: uniqueData.length,
          columns: allHeaders.length + 1,
        });
      } else {
        setData([]);
        setHeaders([]);
        setStats({ total: 0, columns: 0 });
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 컴포넌트 마운트 시 데이터 불러오기
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 데이터 삭제 (전체)
  const handleDeleteAll = async () => {
    if (!confirm('정말로 모든 재고 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    setIsLoading(true);
    try {
      const { error: deleteError } = await supabase
        .from('재고')
        .delete()
        .neq('id', 0); // 모든 데이터 삭제

      if (deleteError) {
        throw deleteError;
      }

      setData([]);
      setHeaders([]);
      setStats({ total: 0, columns: 0 });
    } catch (err) {
      console.error('Delete error:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
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
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">
                  재고 관리
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* 셀 편집 버튼 */}
              {data.length > 0 && (
                <Link
                  href="/management/inventory/edit"
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  셀 편집
                </Link>
              )}

              {/* 전체 삭제 버튼 */}
              {data.length > 0 && (
                <button
                  onClick={handleDeleteAll}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white text-sm font-medium rounded-lg transition-all border border-red-600/30 hover:border-transparent"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  전체 삭제
                </button>
              )}

              {/* 홈으로 버튼 */}
              <Link
                href="/"
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-emerald-500/25"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                업로드
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">총 데이터 수</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {isLoading ? '-' : stats.total.toLocaleString()}
                </p>
              </div>
              <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">컬럼 수</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  {isLoading ? '-' : stats.columns}
                </p>
              </div>
              <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">테이블</p>
                <p className="text-2xl font-bold text-orange-400 mt-1">재고</p>
              </div>
              <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">상태</p>
                <p className={`text-2xl font-bold mt-1 ${error ? 'text-red-400' : 'text-emerald-400'}`}>
                  {isLoading ? '로딩...' : error ? '오류' : '정상'}
                </p>
              </div>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${error ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                {error ? (
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>

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

        {/* Data Table or Empty State */}
        {!isLoading && data.length === 0 && !error ? (
          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-8">
            <div className="flex flex-col items-center justify-center h-[400px]">
              <div className="w-20 h-20 bg-[#0f3460] rounded-full flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-300 mb-2">
                저장된 데이터가 없습니다
              </h3>
              <p className="text-gray-500 text-center text-sm max-w-md mb-6">
                엑셀 파일을 업로드하고 &quot;DB 저장&quot; 버튼을 클릭하여<br />데이터를 저장해주세요.
              </p>
              <Link
                href="/"
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                엑셀 업로드하러 가기
              </Link>
            </div>
          </div>
        ) : (
          <DBDataTable 
            data={data} 
            headers={headers} 
            onRefresh={fetchData}
            isLoading={isLoading}
          />
        )}
      </main>
    </div>
  );
}
