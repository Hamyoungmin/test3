'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface FileInfo {
  fileName: string;
  rowCount: number;
  createdAt: string;
}

interface FileSummary {
  fileName: string;
  totalRows: number;
  numericSummary: { key: string; sum: number; avg: number; count: number }[];
}

// 색상 팔레트 (Airtable 스타일)
const COLORS = [
  '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#6366f1', '#14b8a6', '#84cc16', '#f97316',
];

const GRADIENT_COLORS = [
  ['#8b5cf6', '#a78bfa'],
  ['#06b6d4', '#22d3ee'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#ef4444', '#f87171'],
];

export default function ManagementPage() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileSummary, setFileSummary] = useState<FileSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // DB에서 파일 목록 불러오기
  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
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

        if (fetchError) throw fetchError;

        if (batchData && batchData.length > 0) {
          allData = [...allData, ...batchData];
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      if (allData.length > 0) {
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

  // 선택된 파일의 숫자 데이터 합산
  const fetchFileSummary = useCallback(async (fileName: string) => {
    setSummaryLoading(true);
    try {
      let allData: { data: Record<string, unknown> }[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error } = await supabase
          .from('재고')
          .select('data')
          .eq('file_name', fileName)
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (batchData && batchData.length > 0) {
          allData = [...allData, ...batchData];
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      // 숫자 컬럼 찾기 및 합산
      const numericColumns: Map<string, { sum: number; count: number }> = new Map();

      allData.forEach((row) => {
        if (row.data && typeof row.data === 'object') {
          Object.entries(row.data).forEach(([key, value]) => {
            if (typeof value === 'number' && !isNaN(value)) {
              if (numericColumns.has(key)) {
                const existing = numericColumns.get(key)!;
                existing.sum += value;
                existing.count++;
              } else {
                numericColumns.set(key, { sum: value, count: 1 });
              }
            }
          });
        }
      });

      const numericSummary = Array.from(numericColumns.entries())
        .map(([key, { sum, count }]) => ({
          key,
          sum,
          avg: sum / count,
          count,
        }))
        .sort((a, b) => b.sum - a.sum)
        .slice(0, 6); // 상위 6개만

      setFileSummary({
        fileName,
        totalRows: allData.length,
        numericSummary,
      });
    } catch (err) {
      console.error('Summary fetch error:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (selectedFile) {
      fetchFileSummary(selectedFile);
    } else {
      setFileSummary(null);
    }
  }, [selectedFile, fetchFileSummary]);

  // 파일 삭제
  const handleDeleteFile = async (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`"${fileName}" 파일의 모든 데이터를 삭제하시겠습니까?`)) return;

    setIsLoading(true);
    try {
      const { error: deleteError } = await supabase
        .from('재고')
        .delete()
        .eq('file_name', fileName);

      if (deleteError) throw deleteError;

      setFiles((prev) => prev.filter((f) => f.fileName !== fileName));
      if (selectedFile === fileName) {
        setSelectedFile(null);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 전체 삭제
  const handleDeleteAll = async () => {
    if (!confirm('정말로 모든 데이터를 삭제하시겠습니까?')) return;

    setIsLoading(true);
    try {
      const { error: deleteError } = await supabase
        .from('재고')
        .delete()
        .neq('id', 0);

      if (deleteError) throw deleteError;

      setFiles([]);
      setSelectedFile(null);
    } catch (err) {
      console.error('Delete error:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const totalRows = files.reduce((sum, f) => sum + f.rowCount, 0);

  // 차트 데이터
  const pieChartData = useMemo(() => 
    files.map((f, i) => ({
      name: f.fileName.length > 15 ? f.fileName.slice(0, 15) + '...' : f.fileName,
      fullName: f.fileName,
      value: f.rowCount,
      color: COLORS[i % COLORS.length],
    })),
  [files]);

  const barChartData = useMemo(() => 
    files.slice(0, 8).map((f, i) => ({
      name: f.fileName.length > 12 ? f.fileName.slice(0, 12) + '...' : f.fileName,
      fullName: f.fileName,
      rows: f.rowCount,
      fill: COLORS[i % COLORS.length],
    })),
  [files]);

  // 숫자 포맷
  const formatNumber = (num: number) => {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header - Airtable Style */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-slate-900/80 border-b border-slate-700/50">
        <div className="max-w-[1920px] mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-slate-900 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  Data Dashboard
                </h1>
                <p className="text-xs text-slate-400 font-medium">재고 관리 시스템</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={fetchFiles}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl border border-slate-700 transition-all disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                새로고침
              </button>

              {files.length > 0 && (
                <button
                  onClick={handleDeleteAll}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-xl border border-red-500/30 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  전체 삭제
                </button>
              )}

              <Link
                href="/"
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-500/40 hover:scale-[1.02]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                파일 업로드
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto px-6 py-8">
        {/* Stats Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {/* Total Files */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-600/20 to-purple-600/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all" />
            <div className="relative bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6 hover:border-violet-500/50 transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400">전체 파일</p>
                  <p className="text-4xl font-bold text-white mt-2">
                    {isLoading ? '—' : files.length}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">저장된 데이터 소스</p>
                </div>
                <div className="w-14 h-14 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Total Rows */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-600/20 to-teal-600/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all" />
            <div className="relative bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6 hover:border-cyan-500/50 transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400">총 데이터 행</p>
                  <p className="text-4xl font-bold text-white mt-2">
                    {isLoading ? '—' : formatNumber(totalRows)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">전체 레코드 수</p>
                </div>
                <div className="w-14 h-14 bg-gradient-to-br from-cyan-500/20 to-teal-500/20 rounded-xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Average per File */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/20 to-green-600/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all" />
            <div className="relative bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6 hover:border-emerald-500/50 transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400">평균 행/파일</p>
                  <p className="text-4xl font-bold text-white mt-2">
                    {isLoading || files.length === 0 ? '—' : formatNumber(Math.round(totalRows / files.length))}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">파일당 평균 레코드</p>
                </div>
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500/20 to-green-500/20 rounded-xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="relative group">
            <div className={`absolute inset-0 rounded-2xl blur-xl group-hover:blur-2xl transition-all ${error ? 'bg-red-600/20' : 'bg-amber-600/20'}`} />
            <div className={`relative bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6 transition-all ${error ? 'hover:border-red-500/50' : 'hover:border-amber-500/50'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400">시스템 상태</p>
                  <p className={`text-4xl font-bold mt-2 ${error ? 'text-red-400' : 'text-emerald-400'}`}>
                    {isLoading ? '로딩...' : error ? '오류' : '정상'}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">데이터베이스 연결</p>
                </div>
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${error ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                  {error ? (
                    <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        {files.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Pie Chart */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                파일별 데이터 분포
              </h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 shadow-xl">
                              <p className="text-sm font-medium text-white">{data.fullName}</p>
                              <p className="text-xs text-slate-400">{data.value.toLocaleString()}개 행</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend
                      formatter={(value) => <span className="text-sm text-slate-300">{value}</span>}
                      wrapperStyle={{ paddingTop: '20px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bar Chart */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                파일별 행 수 비교
              </h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barChartData} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" stroke="#64748b" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={100} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 shadow-xl">
                              <p className="text-sm font-medium text-white">{data.fullName}</p>
                              <p className="text-xs text-slate-400">{data.rows.toLocaleString()}개 행</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="rows" radius={[0, 4, 4, 0]}>
                      {barChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* File Summary Panel (when file selected) */}
        {selectedFile && (
          <div className="mb-8 bg-gradient-to-r from-violet-500/10 to-purple-500/10 backdrop-blur-sm rounded-2xl border border-violet-500/30 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{selectedFile}</h3>
                  <p className="text-sm text-slate-400">숫자 데이터 요약</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {summaryLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : fileSummary && fileSummary.numericSummary.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {fileSummary.numericSummary.map((item, idx) => (
                  <div key={item.key} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                    <p className="text-xs text-slate-400 truncate mb-1" title={item.key}>{item.key}</p>
                    <p className="text-xl font-bold text-white">{formatNumber(item.sum)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-slate-500">평균: {formatNumber(item.avg)}</span>
                    </div>
                    <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full" 
                        style={{ 
                          width: `${Math.min((item.sum / fileSummary.numericSummary[0].sum) * 100, 100)}%`,
                          backgroundColor: GRADIENT_COLORS[idx % GRADIENT_COLORS.length][0]
                        }} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-slate-400 py-8">숫자 데이터가 없습니다.</p>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {error}
          </div>
        )}

        {/* File List Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            파일 목록
            {files.length > 0 && (
              <span className="text-sm font-normal text-slate-400 ml-2">
                ({files.length}개)
              </span>
            )}
          </h2>
          {selectedFile && (
            <span className="text-sm text-violet-400 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              카드 클릭 시 요약 정보 표시
            </span>
          )}
        </div>

        {/* File Cards */}
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 font-medium">파일 목록을 불러오는 중...</p>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-12">
            <div className="flex flex-col items-center justify-center">
              <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6">
                <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">저장된 파일이 없습니다</h3>
              <p className="text-slate-400 text-center text-sm max-w-md mb-8">
                엑셀 파일을 업로드하고 DB 저장 버튼을 클릭하여<br />데이터를 저장해주세요.
              </p>
              <Link
                href="/"
                className="flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-500/40 hover:scale-[1.02]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                엑셀 업로드하러 가기
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {files.map((file, index) => (
              <div
                key={file.fileName}
                onClick={() => setSelectedFile(selectedFile === file.fileName ? null : file.fileName)}
                className={`group relative bg-slate-800/50 backdrop-blur-sm rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl ${
                  selectedFile === file.fileName 
                    ? 'border-violet-500 shadow-lg shadow-violet-500/20' 
                    : 'border-slate-700/50 hover:border-slate-600'
                }`}
              >
                {/* Gradient accent */}
                <div 
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{ background: `linear-gradient(to right, ${GRADIENT_COLORS[index % GRADIENT_COLORS.length][0]}, ${GRADIENT_COLORS[index % GRADIENT_COLORS.length][1]})` }}
                />

                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                      style={{ background: `linear-gradient(135deg, ${GRADIENT_COLORS[index % GRADIENT_COLORS.length][0]}30, ${GRADIENT_COLORS[index % GRADIENT_COLORS.length][1]}30)` }}
                    >
                      <svg className="w-6 h-6" style={{ color: GRADIENT_COLORS[index % GRADIENT_COLORS.length][0] }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-white truncate group-hover:text-violet-300 transition-colors" title={file.fileName}>
                        {file.fileName}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xl font-bold" style={{ color: GRADIENT_COLORS[index % GRADIENT_COLORS.length][0] }}>
                          {formatNumber(file.rowCount)}
                        </span>
                        <span className="text-sm text-slate-400">행</span>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>데이터 비중</span>
                      <span>{((file.rowCount / totalRows) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-500"
                        style={{ 
                          width: `${(file.rowCount / totalRows) * 100}%`,
                          background: `linear-gradient(to right, ${GRADIENT_COLORS[index % GRADIENT_COLORS.length][0]}, ${GRADIENT_COLORS[index % GRADIENT_COLORS.length][1]})`
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="px-5 py-3 bg-slate-900/50 border-t border-slate-700/50 flex items-center justify-between">
                  <Link
                    href={`/management/file/${encodeURIComponent(file.fileName)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-medium flex items-center gap-1 transition-colors hover:text-violet-300"
                    style={{ color: GRADIENT_COLORS[index % GRADIENT_COLORS.length][0] }}
                  >
                    데이터 보기
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                  <button
                    onClick={(e) => handleDeleteFile(file.fileName, e)}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                {/* Selected indicator */}
                {selectedFile === file.fileName && (
                  <div className="absolute top-3 right-3">
                    <div className="w-6 h-6 bg-violet-500 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
