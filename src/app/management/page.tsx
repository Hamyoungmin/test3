'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface FileInfo {
  fileName: string;
  rowCount: number;
  createdAt: string;
}

export default function ManagementPage() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // DB에서 파일 목록 불러오기 (RPC 사용하여 파일별 통계)
  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 모든 데이터를 가져오기 위해 pagination 사용
      let allData: { file_name: string; created_at: string }[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: fetchError } = await supabase
          .from('재고')
          .select('file_name, created_at')
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
        // 파일명별로 그룹화하여 통계 계산
        const fileMap = new Map<string, { count: number; createdAt: string }>();
        
        allData.forEach((item) => {
          const fileName = String(item.file_name ?? '알 수 없는 파일');
          if (fileMap.has(fileName)) {
            fileMap.get(fileName)!.count++;
          } else {
            fileMap.set(fileName, { 
              count: 1, 
              createdAt: item.created_at || new Date().toISOString() 
            });
          }
        });

        const fileList: FileInfo[] = Array.from(fileMap.entries()).map(([fileName, info]) => ({
          fileName,
          rowCount: info.count,
          createdAt: info.createdAt,
        }));

        setFiles(fileList);
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // 특정 파일 삭제
  const handleDeleteFile = async (fileName: string) => {
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

      // 목록에서 제거
      setFiles((prev) => prev.filter((f) => f.fileName !== fileName));
    } catch (err) {
      console.error('Delete error:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 전체 삭제
  const handleDeleteAll = async () => {
    if (!confirm('정말로 모든 재고 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    setIsLoading(true);
    try {
      const { error: deleteError } = await supabase
        .from('재고')
        .delete()
        .neq('id', 0);

      if (deleteError) {
        throw deleteError;
      }

      setFiles([]);
    } catch (err) {
      console.error('Delete error:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const totalRows = files.reduce((sum, f) => sum + f.rowCount, 0);

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
                <h1 className="text-lg font-bold text-white">재고 관리</h1>
                <p className="text-xs text-gray-400">저장된 파일 목록</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* 새로고침 */}
              <button
                onClick={fetchFiles}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                새로고침
              </button>

              {/* 전체 삭제 */}
              {files.length > 0 && (
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

              {/* 업로드 페이지 */}
              <Link
                href="/"
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-indigo-500/25"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                파일 업로드
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">저장된 파일</p>
                <p className="text-2xl font-bold text-purple-400 mt-1">
                  {isLoading ? '-' : files.length}
                </p>
              </div>
              <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">총 데이터 행</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  {isLoading ? '-' : totalRows.toLocaleString()}
                </p>
              </div>
              <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
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

        {/* File Cards */}
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">파일 목록을 불러오는 중...</p>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="bg-[#16213e] rounded-lg border border-[#0f3460] p-8">
            <div className="flex flex-col items-center justify-center h-[400px]">
              <div className="w-20 h-20 bg-[#0f3460] rounded-full flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-300 mb-2">저장된 파일이 없습니다</h3>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {files.map((file) => (
              <div
                key={file.fileName}
                className="group bg-[#16213e] rounded-xl border border-[#0f3460] overflow-hidden hover:border-indigo-500/50 transition-all hover:shadow-lg hover:shadow-indigo-500/10"
              >
                {/* File Card Header */}
                <Link href={`/management/file/${encodeURIComponent(file.fileName)}`}>
                  <div className="p-5 cursor-pointer">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-white truncate group-hover:text-indigo-400 transition-colors" title={file.fileName}>
                          {file.fileName}
                        </h3>
                        <p className="text-sm text-gray-400 mt-1">
                          {file.rowCount.toLocaleString()}개 행
                        </p>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                        </svg>
                        재고 테이블
                      </span>
                    </div>
                  </div>
                </Link>

                {/* Actions */}
                <div className="px-5 py-3 bg-[#0f3460]/50 border-t border-[#0f3460] flex items-center justify-between">
                  <Link
                    href={`/management/file/${encodeURIComponent(file.fileName)}`}
                    className="text-sm text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
                  >
                    데이터 보기
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleDeleteFile(file.fileName);
                    }}
                    className="text-sm text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
