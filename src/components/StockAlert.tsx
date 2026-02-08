'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// 재고 부족 품목 타입
export interface LowStockItem {
  id: number;
  rowIndex: number;
  itemName: string;
  currentStock: number;
  optimalStock: number;
  shortage: number;
  shortagePercent: number;
  fileName: string;
}

interface StockCheckResult {
  success: boolean;
  lowStockItems: LowStockItem[];
  totalChecked: number;
  aiSummary?: string;
  error?: string;
}

interface StockAlertProps {
  fileName?: string;
  autoCheck?: boolean;
  checkInterval?: number; // 분 단위
  onAlertClick?: (item: LowStockItem) => void;
}

// 🚨 팝업 모달 컴포넌트 - "사장님, 재고가 부족합니다!"
function StockAlertPopup({ 
  items, 
  onClose, 
  onItemClick 
}: { 
  items: LowStockItem[]; 
  onClose: () => void;
  onItemClick?: (item: LowStockItem) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // ESC 키로 닫기
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!mounted || items.length === 0) return null;

  // 긴급 품목 (50% 이상 부족)
  const urgentItems = items.filter(i => i.shortagePercent >= 50);
  const warningItems = items.filter(i => i.shortagePercent < 50);

  const popup = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn">
      {/* 배경 오버레이 */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 팝업 모달 */}
      <div className="relative bg-white rounded-3xl shadow-2xl border border-red-200 max-w-lg w-full max-h-[80vh] overflow-hidden animate-slideDown">
        {/* 상단 빨간 경고 바 */}
        <div className="bg-gradient-to-r from-red-600 via-red-500 to-orange-500 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-white text-xl font-bold">🚨 사장님, 재고가 부족합니다!</h2>
                <p className="text-white/80 text-sm">{items.length}개 품목 확인 필요</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 품목 리스트 */}
        <div className="p-4 max-h-[50vh] overflow-y-auto">
          {/* 긴급 품목 */}
          {urgentItems.length > 0 && (
            <div className="mb-4">
              <h3 className="text-red-600 font-bold text-sm mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                긴급 발주 필요 ({urgentItems.length}개)
              </h3>
              <div className="space-y-2">
                {urgentItems.slice(0, 5).map((item, idx) => (
                  <div 
                    key={item.id || idx}
                    onClick={() => onItemClick?.(item)}
                    className="p-3 bg-red-50 border border-red-200 rounded-xl cursor-pointer hover:bg-red-100 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-gray-900 font-medium">{item.itemName}</p>
                        <p className="text-xs text-gray-500">{item.fileName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-red-600 font-bold">{item.currentStock} / {item.optimalStock}</p>
                        <p className="text-xs text-red-500">{item.shortage}개 부족</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 경고 품목 */}
          {warningItems.length > 0 && (
            <div>
              <h3 className="text-yellow-600 font-bold text-sm mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-500 rounded-full" />
                주의 필요 ({warningItems.length}개)
              </h3>
              <div className="space-y-2">
                {warningItems.slice(0, 5).map((item, idx) => (
                  <div 
                    key={item.id || idx}
                    onClick={() => onItemClick?.(item)}
                    className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl cursor-pointer hover:bg-yellow-100 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-gray-900 font-medium">{item.itemName}</p>
                        <p className="text-xs text-gray-500">{item.fileName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-yellow-600 font-bold">{item.currentStock} / {item.optimalStock}</p>
                        <p className="text-xs text-yellow-600">{item.shortage}개 부족</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {items.length > 10 && (
            <p className="text-center text-gray-500 text-sm mt-4">
              +{items.length - 10}개 품목 더 있음
            </p>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="p-4 border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-all"
          >
            나중에 확인
          </button>
          <button
            onClick={() => {
              if (items[0]) onItemClick?.(items[0]);
              onClose();
            }}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all"
          >
            지금 확인하기
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}

// 🚨 상단 알림 배너 컴포넌트
function TopAlertBanner({ 
  items, 
  onClose, 
  onItemClick 
}: { 
  items: LowStockItem[]; 
  onClose: () => void;
  onItemClick?: (item: LowStockItem) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 여러 품목일 경우 3초마다 순환
  useEffect(() => {
    if (items.length > 1) {
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % items.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [items.length]);

  if (!mounted || items.length === 0) return null;

  const currentItem = items[currentIndex];

  const banner = (
    <div className="fixed top-0 left-0 right-0 z-[9998] animate-slideDown">
      <div className="bg-gradient-to-r from-red-600 via-red-500 to-orange-500 shadow-lg shadow-red-500/30">
        <div className="max-w-[1920px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* 경고 아이콘 */}
              <div className="flex-shrink-0 animate-pulse">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              
              {/* 메시지 */}
              <div 
                className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => onItemClick?.(currentItem)}
              >
                <span className="text-white font-bold text-lg">
                  🚨 {currentItem.itemName} 재고가 부족합니다!
                </span>
                <span className="text-white/80 text-sm">
                  (현재 {currentItem.currentStock}개 / 적정 {currentItem.optimalStock}개)
                </span>
              </div>

              {/* 페이지 인디케이터 */}
              {items.length > 1 && (
                <div className="flex items-center gap-1 ml-4">
                  <span className="text-white/70 text-xs">
                    {currentIndex + 1} / {items.length}
                  </span>
                  <div className="flex gap-1 ml-2">
                    {items.slice(0, 5).map((_, idx) => (
                      <div 
                        key={idx} 
                        className={`w-2 h-2 rounded-full transition-all ${
                          idx === currentIndex ? 'bg-white scale-125' : 'bg-white/40'
                        }`}
                      />
                    ))}
                    {items.length > 5 && (
                      <span className="text-white/50 text-xs ml-1">+{items.length - 5}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 닫기 버튼 */}
            <button
              onClick={onClose}
              className="flex-shrink-0 p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      {/* 하단 그라데이션 효과 */}
      <div className="h-1 bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400" />
    </div>
  );

  // Portal로 body에 직접 렌더링
  return createPortal(banner, document.body);
}

export default function StockAlert({
  fileName,
  autoCheck = false,
  checkInterval = 5,
  onAlertClick,
}: StockAlertProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<StockCheckResult | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTopBanner, setShowTopBanner] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  // 재고 체크 함수
  const checkStock = useCallback(async () => {
    if (isChecking) return;
    
    setIsChecking(true);
    setError(null);
    
    try {
      const response = await fetch('/api/ai/stock-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          generateAISummary: true,
        }),
      });
      
      const data: StockCheckResult = await response.json();
      setResult(data);
      setLastCheckedAt(new Date());
      
      if (!data.success) {
        setError(data.error || '재고 체크 실패');
      } else if (data.lowStockItems && data.lowStockItems.length > 0) {
        // 🚨 부족 품목 발견 시 팝업 + 상단 알림 표시!
        setShowPopup(true);
        setShowTopBanner(true);
      }
    } catch (err) {
      console.error('Stock check error:', err);
      setError('네트워크 오류');
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, fileName]);

  // 자동 체크
  useEffect(() => {
    if (autoCheck) {
      checkStock();
      const interval = setInterval(checkStock, checkInterval * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [autoCheck, checkInterval]); // eslint-disable-line

  // 파생 데이터
  const lowStockItems = result?.lowStockItems || [];
  const lowStockCount = lowStockItems.length;
  const totalChecked = result?.totalChecked || 0;
  const aiSummary = result?.aiSummary;
  const hasLowStock = lowStockCount > 0;

  // 긴급도 색상
  const getUrgencyColor = (percent: number) => {
    if (percent >= 70) return 'text-red-400 bg-red-500/20 border-red-500/40';
    if (percent >= 50) return 'text-orange-400 bg-orange-500/20 border-orange-500/40';
    return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/40';
  };

  // 🚨 팝업 모달 (부족 품목 발견 시 표시)
  const alertPopup = showPopup && lowStockItems.length > 0 && (
    <StockAlertPopup 
      items={lowStockItems}
      onClose={() => setShowPopup(false)}
      onItemClick={onAlertClick}
    />
  );

  // 🚨 상단 알림 배너 (팝업 닫은 후에도 유지)
  const topBanner = showTopBanner && !showPopup && lowStockItems.length > 0 && (
    <TopAlertBanner 
      items={lowStockItems}
      onClose={() => setShowTopBanner(false)}
      onItemClick={onAlertClick}
    />
  );

  // 에러/로딩 상태
  if (error && !result) {
    return (
      <>
        {alertPopup}
        {topBanner}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-gray-700 font-medium">재고 체크</p>
                <p className="text-xs text-gray-500">{error}</p>
              </div>
            </div>
            <button onClick={checkStock} disabled={isChecking} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg transition-all disabled:opacity-50">
              {isChecking ? '체크 중...' : '체크하기'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // 양호 상태
  if (!hasLowStock && result) {
    return (
      <>
        {alertPopup}
        {topBanner}
        <div className="bg-green-50 rounded-2xl border border-green-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-green-700 font-medium">재고 상태 양호</p>
                <p className="text-xs text-gray-500">
                  {totalChecked}개 품목 확인 완료
                  {lastCheckedAt && ` · ${lastCheckedAt.toLocaleTimeString()}`}
                </p>
              </div>
            </div>
            <button onClick={checkStock} disabled={isChecking} className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 text-sm rounded-lg transition-all disabled:opacity-50">
              {isChecking ? '체크 중...' : '다시 체크'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // 초기 상태 (체크 전)
  if (!result) {
    return (
      <>
        {alertPopup}
        {topBanner}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                {isChecking ? (
                  <svg className="w-5 h-5 text-green-600 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-gray-700 font-medium">재고 부족 체크</p>
                <p className="text-xs text-gray-500">
                  {isChecking ? 'AI가 재고를 분석 중입니다...' : '현재재고 vs 적정재고 비교'}
                </p>
              </div>
            </div>
            <button onClick={checkStock} disabled={isChecking} className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 text-sm rounded-lg transition-all disabled:opacity-50">
              {isChecking ? '분석 중...' : '체크 시작'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // 부족 품목 있음
  return (
    <>
      {alertPopup}
      {topBanner}
      <div className="bg-red-50 rounded-2xl border border-red-200 overflow-hidden shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-red-100 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center shadow-md">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center">
              <span className="text-xs text-white font-bold">{lowStockCount}</span>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">재고 부족 알림</h3>
            <p className="text-xs text-gray-500">{lowStockCount}개 품목이 적정 재고 미만입니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); checkStock(); }} disabled={isChecking} className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-all disabled:opacity-50">
            <svg className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* AI 요약 */}
      {aiSummary && (
        <div className="px-4 pb-3">
          <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-start gap-2">
              <span className="text-lg">🤖</span>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
            </div>
          </div>
        </div>
      )}

      {/* 상세 목록 */}
      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {lowStockItems.map((item, idx) => (
              <div key={item.id || idx} onClick={() => onAlertClick?.(item)} className={`p-3 rounded-xl border cursor-pointer hover:scale-[1.02] transition-all bg-white ${item.shortagePercent >= 70 ? 'border-red-300' : item.shortagePercent >= 50 ? 'border-orange-300' : 'border-yellow-300'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${item.shortagePercent >= 70 ? 'bg-red-600 text-white' : item.shortagePercent >= 50 ? 'bg-orange-500 text-white' : 'bg-yellow-500 text-white'}`}>
                      {item.shortagePercent >= 70 ? '긴급' : item.shortagePercent >= 50 ? '주의' : '경고'}
                    </span>
                    <div>
                      <p className="font-medium text-gray-900">{item.itemName}</p>
                      <p className="text-xs text-gray-500">{item.fileName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono">
                      <span className="text-red-600">{item.currentStock}</span>
                      <span className="text-gray-400"> / </span>
                      <span className="text-gray-700">{item.optimalStock}</span>
                    </p>
                    <p className="text-xs text-gray-500">{item.shortage}개 부족</p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full ${item.shortagePercent >= 70 ? 'bg-red-500' : item.shortagePercent >= 50 ? 'bg-orange-500' : 'bg-yellow-500'}`} style={{ width: `${Math.min(100, (item.currentStock / item.optimalStock) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-red-200 text-xs text-gray-500 flex justify-between">
            <span>총 {totalChecked}개 품목 중 {lowStockCount}개 부족</span>
            {lastCheckedAt && <span>{lastCheckedAt.toLocaleTimeString()}</span>}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
