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
        relative border-2 border-dashed rounded-2xl p-12 bg-white
        transition-all duration-300 ease-out
        ${
          isDragging
            ? 'border-green-500 bg-green-50 scale-[1.02]'
            : 'border-gray-300 hover:border-green-400 hover:bg-gray-50'
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
            <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-lg font-medium text-gray-700">
              파일 처리 중...
            </p>
          </>
        ) : (
          <>
            <div
              className={`
                p-4 rounded-2xl transition-colors duration-300
                ${isDragging ? 'bg-green-100' : 'bg-gray-100'}
              `}
            >
              <svg
                className={`w-12 h-12 transition-colors duration-300 ${
                  isDragging ? 'text-green-600' : 'text-gray-400'
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
              <p className="text-lg font-semibold text-gray-700">
                {isDragging ? '여기에 파일을 놓으세요' : '엑셀 파일을 드래그하거나 클릭하세요'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                .xlsx, .xls, .csv 파일 지원
              </p>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-xl font-medium transition-colors">
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

