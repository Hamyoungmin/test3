'use client';

import { useState, useCallback, useEffect } from 'react';

interface AIBriefingProps {
  data: Array<Record<string, unknown>>;
  headers: string[];
  fileName: string;
  onRefreshTrigger?: number;
}

interface LowStockItem {
  id: number;
  itemName: string;
  currentStock: number;
  baseStock: number;
  shortage: number;
  shortagePercent: number;
}

interface AnalysisResult {
  success: boolean;
  analysis?: string;
  insights?: {
    totalRows?: number;
    confirmedItems?: number;
    lowStockCount?: number;
    totalShortage?: number;
    criticalCount?: number;
    warningCount?: number;
    lowStockItems?: LowStockItem[];
    numericStats?: Record<string, {
      min: number;
      max: number;
      avg: number;
      sum: number;
      count: number;
    }>;
  };
  generatedAt?: string;
  error?: string;
}

// 안전하게 숫자를 포맷하는 헬퍼 함수
const safeNumber = (value: number | undefined | null, defaultValue: number = 0): number => {
  return typeof value === 'number' && !isNaN(value) ? value : defaultValue;
};

const formatNumber = (value: number | undefined | null, defaultValue: number = 0): string => {
  return safeNumber(value, defaultValue).toLocaleString();
};

export default function AIBriefing({ data, headers, fileName, onRefreshTrigger }: AIBriefingProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<Date | null>(null);

  // AI 분석 요청
  const analyzeData = useCallback(async () => {
    if (data.length === 0) {
      setResult({ success: false, error: '분석할 데이터가 없습니다.' });
      return;
    }

    setIsAnalyzing(true);
    setResult(null);

    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: data.slice(0, 500),
          headers,
          fileName,
        }),
      });

      const analysisResult = await response.json();
      setResult(analysisResult);
      setLastAnalyzedAt(new Date());
    } catch (error) {
      console.error('AI Analysis error:', error);
      setResult({
        success: false,
        error: 'AI 분석 중 네트워크 오류가 발생했습니다.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [data, headers, fileName]);

  // 외부 트리거로 분석 재요청
  useEffect(() => {
    if (onRefreshTrigger && onRefreshTrigger > 0) {
      analyzeData();
    }
  }, [onRefreshTrigger, analyzeData]);

  // 초기 자동 분석
  useEffect(() => {
    if (data.length > 0 && !result && !isAnalyzing) {
      analyzeData();
    }
  }, [data.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 마크다운 스타일 텍스트를 HTML로 변환
  const formatAnalysisText = (text: string) => {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      .replace(/📊|🚨|📦|💡|🔴|🟡|🟢|✅|⚠️/g, '<span class="mr-1">$&</span>');
  };

  // insights 안전하게 접근
  const insights = result?.insights;
  const totalRows = safeNumber(insights?.totalRows, 0);
  const confirmedItems = safeNumber(insights?.confirmedItems, 0);
  const lowStockCount = safeNumber(insights?.lowStockCount, 0);
  const totalShortage = safeNumber(insights?.totalShortage, 0);
  const criticalCount = safeNumber(insights?.criticalCount, 0);
  const lowStockItems = insights?.lowStockItems ?? [];

  return (
    <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-violet-100/50 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              AI 경영 브리핑
              {isAnalyzing && (
                <span className="flex items-center gap-1 text-xs text-violet-600 font-normal">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  분석 중...
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-500">
              {lastAnalyzedAt 
                ? `마지막 분석: ${lastAnalyzedAt.toLocaleTimeString()}`
                : 'AI가 재고 데이터를 분석합니다'
              }
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 새로고침 버튼 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              analyzeData();
            }}
            disabled={isAnalyzing}
            className="p-2 bg-violet-100 hover:bg-violet-200 text-violet-600 hover:text-violet-700 rounded-lg transition-all disabled:opacity-50"
            title="다시 분석"
          >
            <svg className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* 접기/펼치기 */}
          <svg 
            className={`w-5 h-5 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="px-5 pb-5">
          {/* Loading State */}
          {isAnalyzing && !result && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-violet-200 rounded-full" />
                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="mt-4 text-gray-600 text-sm">AI가 데이터를 분석하고 있습니다...</p>
              <p className="text-xs text-gray-500 mt-1">잠시만 기다려주세요</p>
            </div>
          )}

          {/* Error State */}
          {result && !result.success && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-red-700 font-medium">분석 오류</p>
                  <p className="text-red-600 text-sm mt-1">{result.error || '알 수 없는 오류가 발생했습니다.'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Success State */}
          {result?.success && (
            <div className="space-y-4">
              {/* 상단 요약 카드 */}
              {insights && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* 총 품목 */}
                  <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {formatNumber(totalRows)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">총 품목</div>
                  </div>
                  
                  {/* 재고 부족 */}
                  <div className={`rounded-xl border p-3 text-center ${
                    lowStockCount > 0 
                      ? 'bg-red-50 border-red-200' 
                      : 'bg-green-50 border-green-200'
                  }`}>
                    <div className={`text-2xl font-bold ${
                      lowStockCount > 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {formatNumber(lowStockCount)}
                    </div>
                    <div className={`text-xs mt-1 ${
                      lowStockCount > 0 ? 'text-red-500' : 'text-green-500'
                    }`}>
                      재고 부족
                    </div>
                  </div>
                  
                  {/* 긴급 발주 */}
                  <div className={`rounded-xl border p-3 text-center ${
                    criticalCount > 0 
                      ? 'bg-orange-50 border-orange-200' 
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`text-2xl font-bold ${
                      criticalCount > 0 ? 'text-orange-600' : 'text-gray-600'
                    }`}>
                      {formatNumber(criticalCount)}
                    </div>
                    <div className={`text-xs mt-1 ${
                      criticalCount > 0 ? 'text-orange-500' : 'text-gray-500'
                    }`}>
                      긴급 발주
                    </div>
                  </div>
                  
                  {/* 필요 수량 */}
                  <div className="bg-violet-50 rounded-xl border border-violet-200 p-3 text-center">
                    <div className="text-2xl font-bold text-violet-600">
                      {formatNumber(totalShortage)}
                    </div>
                    <div className="text-xs text-violet-500 mt-1">필요 수량</div>
                  </div>
                </div>
              )}

              {/* AI 브리핑 메시지 */}
              {result.analysis && (
                <div className="p-5 bg-white border border-violet-200 rounded-xl shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">🤖</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div 
                        className="text-gray-800 leading-relaxed whitespace-pre-wrap text-sm"
                        dangerouslySetInnerHTML={{ __html: formatAnalysisText(result.analysis) }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 재고 부족 품목 상세 테이블 */}
              {lowStockItems.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gradient-to-r from-red-50 to-orange-50 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="font-semibold text-gray-900">재고 부족 품목 ({formatNumber(lowStockCount)}개)</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">품목명</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">현재</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">기준</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">부족</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {lowStockItems.slice(0, 10).map((item, idx) => {
                          const itemCurrentStock = safeNumber(item?.currentStock);
                          const itemBaseStock = safeNumber(item?.baseStock);
                          const itemShortage = safeNumber(item?.shortage);
                          const itemShortagePercent = safeNumber(item?.shortagePercent);
                          
                          return (
                            <tr key={item?.id ?? idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-4 py-3 text-gray-900 font-medium truncate max-w-[200px]">
                                {item?.itemName || `품목 #${idx + 1}`}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700 font-mono">
                                {formatNumber(itemCurrentStock)}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-500 font-mono">
                                {formatNumber(itemBaseStock)}
                              </td>
                              <td className="px-4 py-3 text-right text-red-600 font-mono font-semibold">
                                -{formatNumber(itemShortage)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {itemShortagePercent >= 50 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                    🔴 긴급
                                  </span>
                                ) : itemShortagePercent >= 20 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                                    🟡 주의
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                    🔵 경미
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {lowStockItems.length > 10 && (
                    <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-center text-xs text-gray-500">
                      +{lowStockItems.length - 10}개 더 있음
                    </div>
                  )}
                </div>
              )}

              {/* 통계 요약 Footer */}
              {insights && (
                <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-violet-200 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                    총 {formatNumber(totalRows)}개 품목
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    {formatNumber(confirmedItems)}개 기준 설정
                  </span>
                  {lowStockCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      {formatNumber(lowStockCount)}개 부족
                    </span>
                  )}
                  {result.generatedAt && (
                    <span className="ml-auto text-gray-400">
                      {new Date(result.generatedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!isAnalyzing && !result && data.length === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-gray-600">분석할 데이터가 없습니다</p>
              <p className="text-gray-500 text-xs mt-1">데이터를 추가하면 AI가 자동으로 분석합니다</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
