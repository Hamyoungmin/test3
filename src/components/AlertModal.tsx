'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface AlertConfig {
  id?: number;
  file_name: string;
  column_name: string;
  condition_type: 'below' | 'above' | 'equals';
  threshold_value: number;
  notification_type: string[];
  email?: string;
  is_active: boolean;
  last_triggered_at?: string;
  created_at?: string;
}

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  columns: string[];
  onAlertCreated?: () => void;
}

export default function AlertModal({ 
  isOpen, 
  onClose, 
  fileName, 
  columns,
  onAlertCreated 
}: AlertModalProps) {
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  
  // 새 알림 폼 상태
  const [newAlert, setNewAlert] = useState<Partial<AlertConfig>>({
    file_name: fileName,
    column_name: '',
    condition_type: 'below',
    threshold_value: 0,
    notification_type: [],
    email: '',
    is_active: true,
  });
  
  // 알림 목록 불러오기
  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/alerts?file_name=${encodeURIComponent(fileName)}`);
      const result = await response.json();
      
      if (result.success) {
        setAlerts(result.data || []);
      }
    } catch (error) {
      console.error('Fetch alerts error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fileName]);
  
  useEffect(() => {
    if (isOpen) {
      fetchAlerts();
      setNewAlert(prev => ({ ...prev, file_name: fileName }));
    }
  }, [isOpen, fileName, fetchAlerts]);
  
  // 알림 생성
  const handleCreateAlert = async () => {
    if (!newAlert.column_name) {
      window.alert('컬럼을 선택해주세요.');
      return;
    }
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAlert),
      });
      
      const result = await response.json();
      
      if (result.success) {
        await fetchAlerts();
        setActiveTab('list');
        setNewAlert({
          file_name: fileName,
          column_name: '',
          condition_type: 'below',
          threshold_value: 0,
          notification_type: [],
          email: '',
          is_active: true,
        });
        onAlertCreated?.();
      } else {
        window.alert(result.error || '알림 생성에 실패했습니다.');
      }
    } catch (error) {
      console.error('Create alert error:', error);
      window.alert('알림 생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // 알림 삭제
  const handleDeleteAlert = async (id: number) => {
    if (!confirm('이 알림을 삭제하시겠습니까?')) return;
    
    try {
      const response = await fetch(`/api/alerts?id=${id}`, {
        method: 'DELETE',
      });
      
      const result = await response.json();
      
      if (result.success) {
        await fetchAlerts();
        onAlertCreated?.();
      }
    } catch (error) {
      console.error('Delete alert error:', error);
    }
  };
  
  // 알림 활성화/비활성화 토글
  const handleToggleAlert = async (alertItem: AlertConfig) => {
    try {
      const response = await fetch('/api/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...alertItem, is_active: !alertItem.is_active }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        await fetchAlerts();
      }
    } catch (error) {
      console.error('Toggle alert error:', error);
    }
  };
  
  // 알림 테스트 전송
  const handleTestNotification = async (alertItem: AlertConfig) => {
    try {
      // 먼저 조건 체크
      const checkResponse = await fetch('/api/alerts/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: alertItem.file_name }),
      });
      
      const checkResult = await checkResponse.json();
      
      if (checkResult.success && checkResult.triggered.length > 0) {
        const triggered = checkResult.triggered.find(
          (t: { alert: AlertConfig }) => t.alert.id === alertItem.id
        );
        
        if (triggered && alertItem.notification_type.length > 0) {
          // 알림 전송
          const notifyResponse = await fetch('/api/alerts/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: alertItem.notification_type.includes('email') && alertItem.notification_type.includes('kakao') 
                ? 'both' 
                : alertItem.notification_type[0],
              recipient: alertItem.email,
              alertInfo: {
                fileName: alertItem.file_name,
                columnName: alertItem.column_name,
                conditionType: alertItem.condition_type,
                thresholdValue: alertItem.threshold_value,
                triggeredValue: triggered.triggeredRows[0]?.currentValue || 0,
                triggeredCount: triggered.triggeredRows.length,
              },
            }),
          });
          
          const notifyResult = await notifyResponse.json();
          window.alert(notifyResult.message || '알림이 전송되었습니다.');
        } else {
          window.alert('현재 조건을 충족하는 데이터가 없습니다.');
        }
      } else {
        window.alert('조건을 충족하는 데이터가 없습니다.');
      }
    } catch (error) {
      console.error('Test notification error:', error);
      window.alert('알림 테스트 중 오류가 발생했습니다.');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative min-h-full flex items-center justify-center p-4">
        <div className="relative bg-[#16213e] rounded-2xl shadow-2xl w-full max-w-2xl border border-[#0f3460]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0f3460]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">알림 설정</h2>
                <p className="text-xs text-gray-400">{fileName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#0f3460] flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex border-b border-[#0f3460]">
            <button
              onClick={() => setActiveTab('list')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'list'
                  ? 'text-amber-400 border-b-2 border-amber-400 bg-[#0f3460]/30'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              알림 목록 ({alerts.length})
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'create'
                  ? 'text-amber-400 border-b-2 border-amber-400 bg-[#0f3460]/30'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              + 새 알림 추가
            </button>
          </div>
          
          {/* Content */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            {activeTab === 'list' ? (
              <div className="space-y-3">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-[#0f3460] rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <p className="text-gray-400 mb-4">설정된 알림이 없습니다</p>
                    <button
                      onClick={() => setActiveTab('create')}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      알림 추가하기
                    </button>
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-xl border ${
                        alert.is_active
                          ? 'bg-[#0f3460]/50 border-[#0f3460]'
                          : 'bg-gray-900/30 border-gray-700 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              alert.condition_type === 'below'
                                ? 'bg-red-500/20 text-red-400'
                                : alert.condition_type === 'above'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-purple-500/20 text-purple-400'
                            }`}>
                              {alert.condition_type === 'below' ? '미만' : 
                               alert.condition_type === 'above' ? '초과' : '동일'}
                            </span>
                            {!alert.is_active && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-400">
                                비활성
                              </span>
                            )}
                          </div>
                          <p className="text-white font-medium">
                            <span className="text-amber-400">{alert.column_name}</span>
                            {' '}값이{' '}
                            <span className="text-emerald-400">{alert.threshold_value.toLocaleString()}</span>
                            {alert.condition_type === 'below' ? ' 미만' : 
                             alert.condition_type === 'above' ? ' 초과' : '과 동일'}일 때
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                            {alert.notification_type.includes('email') && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                이메일
                              </span>
                            )}
                            {alert.notification_type.includes('kakao') && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 3c-5.52 0-10 3.58-10 8 0 2.63 1.74 4.95 4.36 6.36-.14.52-.9 3.25-.93 3.5 0 0-.02.14.07.2.09.05.2.02.2.02.27-.04 3.1-2.04 4.4-2.88.62.09 1.26.14 1.9.14 5.52 0 10-3.58 10-8s-4.48-8-10-8z"/>
                                </svg>
                                카카오톡
                              </span>
                            )}
                            {alert.email && (
                              <span className="truncate max-w-[150px]" title={alert.email}>
                                → {alert.email}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTestNotification(alert)}
                            className="w-8 h-8 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white flex items-center justify-center transition-colors"
                            title="테스트 알림"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleToggleAlert(alert)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                              alert.is_active
                                ? 'bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white'
                                : 'bg-gray-600/20 hover:bg-gray-600 text-gray-400 hover:text-white'
                            }`}
                            title={alert.is_active ? '비활성화' : '활성화'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {alert.is_active ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              )}
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteAlert(alert.id!)}
                            className="w-8 h-8 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white flex items-center justify-center transition-colors"
                            title="삭제"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* 컬럼 선택 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    모니터링할 컬럼 <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={newAlert.column_name || ''}
                    onChange={(e) => setNewAlert(prev => ({ ...prev, column_name: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#0f3460] border border-[#1a1a2e] rounded-xl text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                  >
                    <option value="">컬럼 선택...</option>
                    {columns.filter(col => col !== 'id' && col !== 'file_name' && col !== 'row_index').map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
                
                {/* 조건 설정 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      조건 유형
                    </label>
                    <select
                      value={newAlert.condition_type || 'below'}
                      onChange={(e) => setNewAlert(prev => ({ 
                        ...prev, 
                        condition_type: e.target.value as AlertConfig['condition_type']
                      }))}
                      className="w-full px-4 py-3 bg-[#0f3460] border border-[#1a1a2e] rounded-xl text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                    >
                      <option value="below">미만 (값이 기준보다 작을 때)</option>
                      <option value="above">초과 (값이 기준보다 클 때)</option>
                      <option value="equals">동일 (값이 기준과 같을 때)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      기준값
                    </label>
                    <input
                      type="number"
                      value={newAlert.threshold_value || 0}
                      onChange={(e) => setNewAlert(prev => ({ 
                        ...prev, 
                        threshold_value: parseFloat(e.target.value) || 0
                      }))}
                      className="w-full px-4 py-3 bg-[#0f3460] border border-[#1a1a2e] rounded-xl text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                      placeholder="예: 100"
                    />
                  </div>
                </div>
                
                {/* 알림 방법 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    알림 방법
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAlert.notification_type?.includes('email') || false}
                        onChange={(e) => {
                          const types = newAlert.notification_type || [];
                          setNewAlert(prev => ({
                            ...prev,
                            notification_type: e.target.checked
                              ? [...types, 'email']
                              : types.filter(t => t !== 'email')
                          }));
                        }}
                        className="w-5 h-5 rounded border-gray-600 bg-[#0f3460] text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-gray-300">이메일</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAlert.notification_type?.includes('kakao') || false}
                        onChange={(e) => {
                          const types = newAlert.notification_type || [];
                          setNewAlert(prev => ({
                            ...prev,
                            notification_type: e.target.checked
                              ? [...types, 'kakao']
                              : types.filter(t => t !== 'kakao')
                          }));
                        }}
                        className="w-5 h-5 rounded border-gray-600 bg-[#0f3460] text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-gray-300">카카오톡</span>
                    </label>
                  </div>
                </div>
                
                {/* 이메일 입력 */}
                {newAlert.notification_type?.includes('email') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      수신 이메일
                    </label>
                    <input
                      type="email"
                      value={newAlert.email || ''}
                      onChange={(e) => setNewAlert(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-3 bg-[#0f3460] border border-[#1a1a2e] rounded-xl text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                      placeholder="example@email.com"
                    />
                  </div>
                )}
                
                {/* 안내 메시지 */}
                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-amber-200">
                      <p className="font-medium mb-1">알림 기능 안내</p>
                      <ul className="text-amber-300/80 space-y-1">
                        <li>• 설정한 조건이 충족되면 경고 표시가 나타납니다.</li>
                        <li>• 이메일/카카오톡 전송은 실제 서비스 연동 후 사용 가능합니다.</li>
                        <li>• 여러 알림 조건을 추가할 수 있습니다.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className="px-6 py-4 border-t border-[#0f3460] flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              닫기
            </button>
            {activeTab === 'create' && (
              <button
                onClick={handleCreateAlert}
                disabled={isLoading || !newAlert.column_name}
                className="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '저장 중...' : '알림 추가'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

