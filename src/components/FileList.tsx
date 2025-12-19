'use client';

import { ExcelFile } from '@/types/excel';

interface FileListProps {
  files: ExcelFile[];
  selectedFile: ExcelFile | null;
  onSelect: (file: ExcelFile) => void;
  onDelete: (fileId: string) => void;
}

export default function FileList({ files, selectedFile, onSelect, onDelete }: FileListProps) {
  if (files.length === 0) return null;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
          업로드된 파일
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {files.length}개의 파일
        </p>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[400px] overflow-y-auto">
        {files.map((file, index) => (
          <div
            key={file.id}
            onClick={() => onSelect(file)}
            className={`
              flex items-center gap-4 px-6 py-4 cursor-pointer transition-all duration-200
              animate-slide-in
              ${
                selectedFile?.id === file.id
                  ? 'bg-indigo-50 dark:bg-indigo-900/30'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }
            `}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {/* Icon */}
            <div
              className={`
                flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center
                ${
                  selectedFile?.id === file.id
                    ? 'bg-indigo-500 text-white'
                    : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                }
              `}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800 dark:text-white truncate">
                {file.name}
              </p>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 dark:text-slate-400">
                <span>{formatFileSize(file.size)}</span>
                <span>•</span>
                <span>{file.sheets.length}개 시트</span>
                <span>•</span>
                <span>{formatDate(file.uploadedAt)}</span>
              </div>
            </div>

            {/* Delete Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(file.id);
              }}
              className="flex-shrink-0 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

