'use client';

import { useState, useMemo } from 'react';
import { SheetData } from '@/types/excel';
import { isNumericColumn, formatCellValue, getDisplayHeaders } from '@shared/excel-utils';

interface DataTableProps {
  data: SheetData;
  sheetName: string;
}

export default function DataTable({ data, sheetName }: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const rowsPerPage = 10;
  const displayHeaders = getDisplayHeaders(data.headers);

  // 검색 및 정렬된 데이터 (ID 컬럼 비노출)
  const filteredAndSortedData = useMemo(() => {
    let result = [...data.rows];

    // 검색 필터
    if (searchTerm) {
      result = result.filter((row) =>
        row.some((cell) =>
          String(cell ?? '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    // 정렬 (displayHeaders 기준 인덱스 → 원본 컬럼 인덱스 매핑)
    if (sortColumn !== null) {
      const header = displayHeaders[sortColumn];
      const origIndex = header != null ? data.headers.indexOf(header) : -1;
      if (origIndex >= 0) {
        result.sort((a, b) => {
          const aVal = a[origIndex] ?? '';
          const bVal = b[origIndex] ?? '';

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
    }

    return result;
  }, [data.rows, data.headers, searchTerm, sortColumn, sortDirection, displayHeaders]);

  // 페이지네이션
  const totalPages = Math.ceil(filteredAndSortedData.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedData = filteredAndSortedData.slice(
    startIndex,
    startIndex + rowsPerPage
  );

  const handleSort = (columnIndex: number) => {
    if (sortColumn === columnIndex) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnIndex);
      setSortDirection('asc');
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/excel/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers: displayHeaders,
          rows: filteredAndSortedData.map((row) =>
            displayHeaders.map((h) => row[data.headers.indexOf(h)] ?? null)
          ),
          fileName: `${sheetName}_export`,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sheetName}_export.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('파일 내보내기 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
              {sheetName}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              총 {filteredAndSortedData.length}개의 행
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
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
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10 pr-4 py-2 w-full sm:w-64 bg-slate-100 dark:bg-slate-700 border-0 rounded-xl text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              />
            </div>

            {/* Export Button */}
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              내보내기
            </button>
          </div>
        </div>
      </div>

      {/* Table - Dense, overflow-x for 반응형, 엑셀 스타일 격자 */}
      <div className="overflow-x-auto min-w-0" data-table-dense="true" data-excel-grid="true">
        <table className="w-full min-w-[600px] border-collapse">
          <thead className="sticky top-0 z-10 table-excel-header">
            <tr>
              <th className="px-2 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-11">
                #
              </th>
              {displayHeaders.map((header, index) => (
                <th
                  key={index}
                  onClick={() => handleSort(index)}
                  className={`px-2 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${isNumericColumn(header) ? 'text-right' : 'text-left'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate max-w-[150px]">{header}</span>
                    {sortColumn === index && (
                      <svg
                        className={`w-4 h-4 transition-transform ${
                          sortDirection === 'desc' ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 15l7-7 7 7"
                        />
                      </svg>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={displayHeaders.length + 1}
                  className="px-4 py-12 text-center text-slate-500 dark:text-slate-400"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <td className="px-2 py-2 text-xs text-slate-400 dark:text-slate-500 font-mono font-semibold text-right">
                    {startIndex + rowIndex + 1}
                  </td>
                  {displayHeaders.map((header, cellIndex) => {
                    const origIndex = data.headers.indexOf(header);
                    const cell = origIndex >= 0 ? row[origIndex] : null;
                    const isNum = isNumericColumn(header);
                    return (
                      <td
                        key={header}
                        className={`px-2 py-2 text-sm text-slate-700 dark:text-slate-200 ${isNum ? 'text-right font-bold table-numeric-cell' : ''}`}
                      >
                        <span className="block truncate max-w-[200px]" title={formatCellValue(cell)}>
                          {formatCellValue(cell)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {startIndex + 1} - {Math.min(startIndex + rowsPerPage, filteredAndSortedData.length)} / {filteredAndSortedData.length}
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === pageNum
                        ? 'bg-indigo-500 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

