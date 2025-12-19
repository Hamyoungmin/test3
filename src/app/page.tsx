'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import FileUpload from '@/components/FileUpload';
import FileList from '@/components/FileList';
import SheetTabs from '@/components/SheetTabs';
import { ExcelFile, ParsedExcelData, SheetData } from '@/types/excel';

interface FileWithData {
  file: ExcelFile;
  data: ParsedExcelData;
}

// 무한 스크롤 가상화 테이블 컴포넌트
function VirtualizedTable({ data, sheetName }: { data: SheetData; sheetName: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // 검색 및 정렬된 데이터
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
  }, [data.rows, searchTerm, sortColumn, sortDirection]);

  // 가상화 설정
  const rowVirtualizer = useVirtualizer({
    count: filteredAndSortedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // 각 행의 예상 높이
    overscan: 10, // 화면 밖에 미리 렌더링할 행 수
  });

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
          headers: data.headers,
          rows: filteredAndSortedData,
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

  // 컬럼 너비 계산
  const columnWidths = useMemo(() => {
    const minWidth = 120;
    const maxWidth = 250;
    
    return data.headers.map((header, index) => {
      let maxLength = header.length;
      
      // 처음 100개 행만 샘플링하여 최대 길이 계산
      const sampleRows = filteredAndSortedData.slice(0, 100);
      sampleRows.forEach(row => {
        const cellLength = String(row[index] ?? '').length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      
      const calculatedWidth = Math.min(Math.max(maxLength * 10 + 32, minWidth), maxWidth);
      return calculatedWidth;
    });
  }, [data.headers, filteredAndSortedData]);

  const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + 80; // +80 for row number column

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
              총 {filteredAndSortedData.length.toLocaleString()}개의 행 
              <span className="ml-2 text-xs text-indigo-500">(무한 스크롤)</span>
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
                onChange={(e) => setSearchTerm(e.target.value)}
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

      {/* Virtualized Table Container */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: totalWidth }}>
          {/* Table Header - Fixed */}
          <div className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
            <div className="flex">
              {/* Row Number Header */}
              <div className="flex-shrink-0 w-20 px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                #
              </div>
              {/* Column Headers */}
              {data.headers.map((header, index) => (
                <div
                  key={index}
                  onClick={() => handleSort(index)}
                  style={{ width: columnWidths[index] }}
                  className="flex-shrink-0 px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors select-none"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate">{header}</span>
                    {sortColumn === index && (
                      <svg
                        className={`w-4 h-4 flex-shrink-0 transition-transform ${
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
                </div>
              ))}
            </div>
          </div>

          {/* Virtualized Rows Container */}
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ height: 'calc(100vh - 420px)', minHeight: '400px' }}
          >
            {filteredAndSortedData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                데이터가 없습니다.
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
                      className={`flex items-center border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${
                        virtualRow.index % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/50 dark:bg-slate-800/50'
                      }`}
                    >
                      {/* Row Number */}
                      <div className="flex-shrink-0 w-20 px-4 py-3 text-sm text-slate-400 dark:text-slate-500 font-mono">
                        {(virtualRow.index + 1).toLocaleString()}
                      </div>
                      {/* Cells */}
                      {row.map((cell, cellIndex) => (
                        <div
                          key={cellIndex}
                          style={{ width: columnWidths[cellIndex] }}
                          className="flex-shrink-0 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
                        >
                          <span 
                            className="block truncate" 
                            title={String(cell ?? '')}
                          >
                            {cell !== null && cell !== undefined ? String(cell) : '-'}
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

      {/* Scroll Progress Indicator */}
      <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <>
                표시 중: {(rowVirtualizer.getVirtualItems()[0]?.index ?? 0) + 1} - {' '}
                {(rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.index ?? 0) + 1}
              </>
            )}
          </span>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            스크롤하여 더 보기
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [files, setFiles] = useState<FileWithData[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileWithData | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/excel/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success && result.file && result.data) {
        const newFileWithData: FileWithData = {
          file: result.file,
          data: result.data,
        };

        setFiles((prev) => [newFileWithData, ...prev]);
        setSelectedFile(newFileWithData);
        if (result.data.sheets.length > 0) {
          setActiveSheet(result.data.sheets[0].name);
        }
      } else {
        alert(result.error || '파일 업로드에 실패했습니다.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectFile = useCallback((file: ExcelFile) => {
    const fileWithData = files.find((f) => f.file.id === file.id);
    if (fileWithData) {
      setSelectedFile(fileWithData);
      if (fileWithData.data.sheets.length > 0) {
        setActiveSheet(fileWithData.data.sheets[0].name);
      }
    }
  }, [files]);

  const handleDeleteFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.file.id !== fileId));
    if (selectedFile?.file.id === fileId) {
      setSelectedFile(null);
      setActiveSheet('');
    }
  }, [selectedFile]);

  const currentSheetData: SheetData | null = selectedFile
    ? selectedFile.data.sheets.find((s) => s.name === activeSheet)?.data ?? null
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800 dark:text-white">
                  Excel Manager
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  엑셀 파일 업로드 및 관리
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium rounded-full">
                {files.length}개 파일
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Upload & File List */}
          <div className="lg:col-span-1 space-y-6">
            {/* Upload Section */}
            <FileUpload onUpload={handleUpload} isLoading={isLoading} />

            {/* File List */}
            <FileList
              files={files.map((f) => f.file)}
              selectedFile={selectedFile?.file ?? null}
              onSelect={handleSelectFile}
              onDelete={handleDeleteFile}
            />
          </div>

          {/* Right Column - Data View */}
          <div className="lg:col-span-2">
            {selectedFile && currentSheetData ? (
              <>
                {/* File Info */}
                <div className="mb-6 p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-lg">
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-bold text-slate-800 dark:text-white truncate">
                        {selectedFile.file.name}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-slate-500 dark:text-slate-400">
                        <span>{selectedFile.data.sheets.length}개 시트</span>
                        <span>•</span>
                        <span>{currentSheetData.headers.length}개 컬럼</span>
                        <span>•</span>
                        <span>{currentSheetData.rows.length.toLocaleString()}개 행</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sheet Tabs */}
                <SheetTabs
                  sheets={selectedFile.data.sheets.map((s) => s.name)}
                  activeSheet={activeSheet}
                  onSelect={setActiveSheet}
                />

                {/* Virtualized Data Table */}
                <VirtualizedTable data={currentSheetData} sheetName={activeSheet} />
              </>
            ) : (
              /* Empty State */
              <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">
                <div className="w-24 h-24 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-6">
                  <svg
                    className="w-12 h-12 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  파일을 선택하세요
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-center max-w-sm">
                  왼쪽에서 엑셀 파일을 업로드하거나 목록에서 파일을 선택하여 데이터를 확인하세요.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Built with{' '}
            <a
              href="https://nextjs.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:text-indigo-600 font-medium"
            >
              Next.js
            </a>
            {' '}and{' '}
            <a
              href="https://tailwindcss.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:text-indigo-600 font-medium"
            >
              Tailwind CSS
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
