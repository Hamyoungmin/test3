'use client';

import { useState, useCallback, useEffect } from 'react';

interface AIBriefingProps {
  data: Array<Record<string, unknown>>;
  headers: string[];
  fileName: string;
  onRefreshTrigger?: number; // 외부에서 분석 재요청 트리거
}

interface AnalysisResult {
  success: boolean;
  analysis?: string;
  insights?: {
    totalRows: number;
    numericColumnsCount: number;
    lowStockAlerts: Array<{
      column: string;
      count: number;
      items: Array<{ name: string; value: number }>;
    }>;
    columnStats: Record<string, {
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
          data: data.slice(0, 500), // 최대 500행만 분석
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

  // 초기 자동 분석 (데이터가 있을 때)
  useEffect(() => {
    if (data.length > 0 && !result && !isAnalyzing) {
      analyzeData();
    }
  }, [data.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-gradient-to-br from-[#1e3a5f] to-[#16213e] rounded-2xl border border-[#0f3460] shadow-xl overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[#0f3460]/30 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              AI 경영 브리핑
              {isAnalyzing && (
                <span className="flex items-center gap-1 text-xs text-violet-400 font-normal">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  분석 중...
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400">
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
            className="p-2 bg-violet-600/30 hover:bg-violet-600 text-violet-300 hover:text-white rounded-lg transition-all disabled:opacity-50"
            title="다시 분석"
          >
            <svg className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* 접기/펼치기 */}
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} 
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
                <div className="w-16 h-16 border-4 border-violet-500/30 rounded-full" />
                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="mt-4 text-gray-400 text-sm">AI가 데이터를 분석하고 있습니다...</p>
              <p className="text-xs text-gray-500 mt-1">잠시만 기다려주세요</p>
            </div>
          )}

          {/* Error State */}
          {result && !result.success && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-red-400 font-medium">분석 오류</p>
                  <p className="text-red-300/80 text-sm mt-1">{result.error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Success State */}
          {result && result.success && result.analysis && (
            <div className="space-y-4">
              {/* AI 브리핑 메시지 */}
              <div className="p-4 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/30 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">🤖</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white leading-relaxed whitespace-pre-wrap">
                      {result.analysis}
                    </p>
                  </div>
                </div>
              </div>

              {/* 재고 부족 경고 카드 */}
              {result.insights && result.insights.lowStockAlerts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {result.insights.lowStockAlerts.map((alert, idx) => (
                    <div 
                      key={idx}
                      className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-orange-400 font-medium text-sm">{alert.column}</span>
                        <span className="text-orange-300/60 text-xs">({alert.count}개 부족)</span>
                      </div>
                      <div className="space-y-1">
                        {alert.items.slice(0, 3).map((item, itemIdx) => (
                          <div key={itemIdx} className="flex justify-between text-xs">
                            <span className="text-gray-300 truncate max-w-[120px]">{item.name}</span>
                            <span className="text-red-400 font-mono">{item.value}</span>
                          </div>
                        ))}
                        {alert.items.length > 3 && (
                          <div className="text-xs text-gray-500">
                            +{alert.items.length - 3}개 더...
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 통계 요약 */}
              {result.insights && (
                <div className="flex items-center gap-4 pt-2 border-t border-[#0f3460] text-xs text-gray-500">
                  <span>📊 총 {result.insights.totalRows}개 행 분석</span>
                  <span>📈 {result.insights.numericColumnsCount}개 숫자 컬럼</span>
                  {result.generatedAt && (
                    <span className="ml-auto">
                      🕐 {new Date(result.generatedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty State - 데이터 없음 */}
          {!isAnalyzing && !result && data.length === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-[#0f3460] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-gray-400">분석할 데이터가 없습니다</p>
              <p className="text-gray-500 text-xs mt-1">데이터를 추가하면 AI가 자동으로 분석합니다</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

