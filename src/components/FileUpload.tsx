'use client';

import { useCallback, useState } from 'react';

interface FileUploadProps {
  onUpload: (file: File) => void;
  isLoading?: boolean;
}

export default function FileUpload({ onUpload, isLoading }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        const validExtensions = ['.xlsx', '.xls', '.csv'];
        const isValid = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
        if (isValid) {
          onUpload(file);
        } else {
          alert('엑셀 파일(.xlsx, .xls, .csv)만 업로드 가능합니다.');
        }
      }
    },
    [onUpload]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onUpload(files[0]);
      }
      // Reset input
      e.target.value = '';
    },
    [onUpload]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-2xl p-12
        transition-all duration-300 ease-out
        ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 scale-[1.02]'
            : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
        }
        ${isLoading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}
      `}
    >
      <input
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        onChange={handleFileSelect}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isLoading}
      />

      <div className="flex flex-col items-center gap-4 text-center">
        {isLoading ? (
          <>
            <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-lg font-medium text-slate-700 dark:text-slate-200">
              파일 처리 중...
            </p>
          </>
        ) : (
          <>
            <div
              className={`
                p-4 rounded-2xl transition-colors duration-300
                ${isDragging ? 'bg-indigo-100 dark:bg-indigo-900/50' : 'bg-slate-100 dark:bg-slate-800'}
              `}
            >
              <svg
                className={`w-12 h-12 transition-colors duration-300 ${
                  isDragging ? 'text-indigo-500' : 'text-slate-400 dark:text-slate-500'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>

            <div>
              <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {isDragging ? '여기에 파일을 놓으세요' : '엑셀 파일을 드래그하거나 클릭하세요'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                .xlsx, .xls, .csv 파일 지원
              </p>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-medium transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              파일 선택
            </div>
          </>
        )}
      </div>
    </div>
  );
}

