'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import FileUpload from '@/components/FileUpload';
import FileList from '@/components/FileList';
import SheetTabs from '@/components/SheetTabs';
import { ExcelFile, ParsedExcelData, SheetData } from '@/types/excel';
import { supabase } from '@/lib/supabase';
import { useDragScroll } from '@/hooks/useDragScroll';
import { isNumericColumn, formatCellValue, getDisplayHeaders } from '@shared/excel-utils';

interface FileWithData {
  file: ExcelFile;
  data: ParsedExcelData;
}

// 무한 스크롤 가상화 테이블 컴포넌트
function VirtualizedTable({ data, sheetName, fileName }: { data: SheetData; sheetName: string; fileName: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // 드래그 스크롤 훅
  const { containerRef: dragScrollRef, isDragging } = useDragScroll({ sensitivity: 1.2, smoothness: 0.9 });

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

  // 가상화 설정 (Dense Table)
  const rowVirtualizer = useVirtualizer({
    count: filteredAndSortedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
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

  // Supabase '재고' 테이블에 일괄 저장
  // 각 행을 { "컬럼명": "값" } 형태의 JSON 객체로 만들어서 data 컬럼에 저장
  const handleSaveToSupabase = async () => {
    if (filteredAndSortedData.length === 0) {
      setSaveResult({ success: false, message: '저장할 데이터가 없습니다.' });
      return;
    }

    setIsSaving(true);
    setSaveResult(null);

    try {
      // 첫 번째 행(헤더)의 모든 내용을 컬럼명으로 사용하여 JSON 객체 생성
      const inventoryData = filteredAndSortedData.map((row, rowIndex) => {
        // 각 행을 { "헤더1": "값1", "헤더2": "값2", ... } 형태로 변환
        const rowData: Record<string, string | number | boolean | null> = {};
        
        data.headers.forEach((header, index) => {
          // 헤더 이름을 그대로 키로 사용 (빈 헤더는 Column_N 형식으로)
          const key = header.trim() || `Column_${index + 1}`;
          rowData[key] = row[index] ?? null;
        });

        // DB 컬럼명과 정확히 일치: file_name, row_index, data
        return {
          file_name: fileName,       // 실제 파일명
          row_index: rowIndex,       // 행 인덱스 (0부터 시작)
          data: rowData,             // JSONB 컬럼에 저장될 JSON 객체
        };
      });

      // Supabase에 일괄 삽입 (배치 처리)
      const batchSize = 1000; // 한 번에 삽입할 행 수
      let insertedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < inventoryData.length; i += batchSize) {
        const batch = inventoryData.slice(i, i + batchSize);
        
        const { data: insertedData, error } = await supabase
          .from('재고')
          .insert(batch)
          .select();

        if (error) {
          console.error('Supabase insert error:', error);
          errorCount += batch.length;
        } else {
          insertedCount += insertedData?.length ?? 0;
        }
      }

      if (errorCount === 0) {
        setSaveResult({
          success: true,
          message: `${insertedCount.toLocaleString()}개의 행이 성공적으로 저장되었습니다. (컬럼: ${data.headers.length}개)`,
        });
      } else if (insertedCount > 0) {
        setSaveResult({
          success: true,
          message: `${insertedCount.toLocaleString()}개 저장 완료, ${errorCount.toLocaleString()}개 실패`,
        });
      } else {
        setSaveResult({
          success: false,
          message: '저장에 실패했습니다. Supabase 테이블에 "data" (jsonb) 컬럼이 있는지 확인해주세요.',
        });
      }
    } catch (error) {
      console.error('Save to Supabase error:', error);
      setSaveResult({
        success: false,
        message: '저장 중 오류가 발생했습니다.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 컬럼 너비 계산 (Dense, ID 비노출)
  const displayHeaders = getDisplayHeaders(data.headers);
  const columnWidths = useMemo(() => {
    const minWidth = 80;
    const maxWidth = 220;
    
    return displayHeaders.map((header) => {
      let maxLength = header.length;
      const origIndex = data.headers.indexOf(header);
      const sampleRows = filteredAndSortedData.slice(0, 100);
      sampleRows.forEach(row => {
        const cellLength = String((origIndex >= 0 ? row[origIndex] : null) ?? '').length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      
      const calculatedWidth = Math.min(Math.max(maxLength * 10 + 32, minWidth), maxWidth);
      return calculatedWidth;
    });
  }, [displayHeaders, filteredAndSortedData]);

  const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + 80; // +80 for row number column

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden shadow-sm min-w-0" data-table-dense="true" data-excel-grid="true">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {sheetName}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              총 {filteredAndSortedData.length.toLocaleString()}개의 행 
              <span className="ml-2 text-green-600 font-medium">(무한 스크롤)</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
                className="pl-9 pr-4 py-1.5 w-full sm:w-52 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
              />
            </div>

            {/* Export Button */}
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              내보내기
            </button>

            {/* Save to Supabase Button */}
            <button
              onClick={handleSaveToSupabase}
              disabled={isSaving || filteredAndSortedData.length === 0}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isSaving
                  ? 'bg-green-800 cursor-not-allowed'
                  : 'bg-green-700 hover:bg-green-600'
              } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  저장 중...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                    />
                  </svg>
                  DB 저장
                </>
              )}
            </button>
          </div>
        </div>

        {/* Save Result Message */}
        {saveResult && (
          <div
            className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              saveResult.success
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {saveResult.success ? '✓' : '✕'} {saveResult.message}
          </div>
        )}
      </div>

      {/* Virtualized Table Container - LTR 정렬 + 드래그 스크롤, 모바일 가로 스크롤 */}
      <div 
        ref={dragScrollRef}
        className={`overflow-x-auto overflow-y-hidden select-none min-w-0 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        dir="ltr"
        style={{ direction: 'ltr', WebkitOverflowScrolling: 'touch' }}
      >
        <div style={{ minWidth: Math.max(totalWidth, 800) }} className="text-left">
          {/* Table Header - Fixed */}
          <div className="sticky top-0 z-10 bg-gray-100 dark:bg-slate-800 border-b border-gray-300 dark:border-slate-600">
            <div className="flex">
              {/* Row Number Header */}
              <div className="flex-shrink-0 w-16 px-3 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                #
              </div>
              {/* Column Headers */}
              {displayHeaders.map((header, index) => (
                <div
                  key={index}
                  onClick={() => handleSort(index)}
                  style={{ width: columnWidths[index] }}
                  className={`flex-shrink-0 table-excel-cell px-2 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors select-none border-l border-gray-300 dark:border-slate-500 ${isNumericColumn(header) ? 'text-right' : ''}`}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{header}</span>
                    {sortColumn === index && (
                      <svg
                        className={`w-3 h-3 flex-shrink-0 transition-transform text-green-600 ${
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
            style={{ height: 'calc(100vh - 280px)', minHeight: '350px' }}
          >
            {filteredAndSortedData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400">
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
                      className={`flex items-center border-b border-gray-100 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors ${
                        virtualRow.index % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-gray-50 dark:bg-slate-800/80'
                      }`}
                    >
                      {/* Row Number */}
                      <div className="flex-shrink-0 table-excel-cell w-14 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 font-mono font-semibold text-right border-r border-gray-200 dark:border-slate-600">
                        {(virtualRow.index + 1).toLocaleString()}
                      </div>
                      {/* Cells - Dense, 숫자 우측+굵게 */}
                      {displayHeaders.map((header, cellIndex) => {
                        const origIndex = data.headers.indexOf(header);
                        const cell = origIndex >= 0 ? row[origIndex] : null;
                        const isNum = isNumericColumn(header);
                        return (
                          <div
                            key={header}
                            style={{ width: columnWidths[cellIndex] }}
                            className={`flex-shrink-0 table-excel-cell px-2 py-1.5 text-sm border-l border-gray-200 dark:border-slate-600 ${isNum ? 'text-right font-bold text-gray-900 dark:text-gray-100 table-numeric-cell' : 'text-gray-900 dark:text-gray-100'}`}
                          >
                            <span className="block truncate" title={formatCellValue(cell)}>
                              {formatCellValue(cell)}
                            </span>
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

      {/* Scroll Progress Indicator */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900/50">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <>
                표시 중: {(rowVirtualizer.getVirtualItems()[0]?.index ?? 0) + 1} - {' '}
                {(rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.index ?? 0) + 1}
              </>
            )}
          </span>
          <span className="flex items-center gap-1 text-green-600">
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

export default function Home() {
  const [files, setFiles] = useState<FileWithData[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileWithData | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadSuccessMessage) return;
    const t = setTimeout(() => setUploadSuccessMessage(null), 4000);
    return () => clearTimeout(t);
  }, [uploadSuccessMessage]);

  const handleUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setUploadSuccessMessage(null);

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
        if (result.data?.sheets?.length > 0) {
          setActiveSheet(result.data.sheets[0].name);
        }

        const count = result.totalRowCount ?? result.data?.sheets?.reduce(
          (sum: number, s: { data?: { rows?: unknown[] } }) => sum + (s.data?.rows?.length ?? 0),
          0
        ) ?? 0;
        setUploadSuccessMessage(`${Number(count).toLocaleString()}건의 데이터가 성공적으로 반영되었습니다.`);
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
    <div className="min-h-screen bg-white dark:bg-[#0F172A] text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#F8F9FA] dark:bg-slate-900/95 border-b border-gray-200 dark:border-slate-700 shadow-sm">
        <div className="w-full px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 bg-gradient-to-br from-green-600 to-green-700 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                  Excel Manager
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium rounded-lg border border-green-200 dark:border-green-700">
                {files.length}개 파일
              </span>
              
              {/* Management 버튼 */}
              <Link
                href="/management"
                className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-all hover:shadow-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                관리
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* 업로드 성공 안내 */}
      {uploadSuccessMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 bg-green-600 text-white text-sm font-medium rounded-lg shadow-lg animate-fade-in flex items-center gap-2">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {uploadSuccessMessage}
        </div>
      )}

      {/* Main Content */}
      <main className="w-full px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Left Column - Upload & File List */}
          <div className="xl:col-span-1 space-y-4">
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

          {/* Right Column - Data View (Wider) - min-w-0으로 모바일 가로 스크롤 보장 */}
          <div className="xl:col-span-3 min-w-0">
            {selectedFile && currentSheetData ? (
              <>
                {/* File Info */}
                <div className="mb-4 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-200 dark:border-slate-600">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                        {selectedFile.file.name}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-gray-500 dark:text-gray-400">
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
                <VirtualizedTable data={currentSheetData} sheetName={activeSheet} fileName={selectedFile.file.name} />
              </>
            ) : (
              /* Empty State */
              <div className="flex flex-col items-center justify-center h-[600px] bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-200 dark:border-slate-600">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <svg
                    className="w-10 h-10 text-gray-400"
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
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  파일을 선택하세요
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-center text-sm max-w-sm">
                  왼쪽에서 엑셀 파일을 업로드하거나<br />목록에서 파일을 선택하여 데이터를 확인하세요.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
