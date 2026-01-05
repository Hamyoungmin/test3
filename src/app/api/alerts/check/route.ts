import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

const supabase = createServerSupabaseClient();

interface Alert {
  id: number;
  file_name: string;
  column_name: string;
  condition_type: 'below' | 'above' | 'equals';
  threshold_value: number;
  notification_type: string[];
  email?: string;
  is_active: boolean;
}

interface TriggeredAlert {
  alert: Alert;
  triggeredRows: Array<{
    rowIndex: number;
    currentValue: number;
  }>;
}

// POST: 특정 파일의 알림 조건 체크
export async function POST(request: Request) {
  try {
    const { file_name } = await request.json();
    
    if (!file_name) {
      return NextResponse.json(
        { success: false, error: '파일명이 필요합니다.' },
        { status: 400 }
      );
    }
    
    // 해당 파일의 활성화된 알림 조건 조회
    const { data: alerts, error: alertsError } = await supabase
      .from('alerts')
      .select('*')
      .eq('file_name', file_name)
      .eq('is_active', true);
    
    if (alertsError) {
      throw alertsError;
    }
    
    if (!alerts || alerts.length === 0) {
      return NextResponse.json({ 
        success: true, 
        triggered: [],
        message: '설정된 알림이 없습니다.' 
      });
    }
    
    // 해당 파일의 데이터 조회
    const { data: fileData, error: fileError } = await supabase
      .from('재고')
      .select('*')
      .eq('file_name', file_name)
      .order('row_index', { ascending: true });
    
    if (fileError) {
      throw fileError;
    }
    
    // 각 알림 조건에 대해 체크
    const triggeredAlerts: TriggeredAlert[] = [];
    
    for (const alert of alerts as Alert[]) {
      const triggeredRows: TriggeredAlert['triggeredRows'] = [];
      
      for (const row of fileData || []) {
        const data = row.data as Record<string, unknown>;
        const value = data[alert.column_name];
        
        // 숫자 값인 경우만 체크
        if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))) {
          const numValue = typeof value === 'number' ? value : parseFloat(value);
          let isTriggered = false;
          
          switch (alert.condition_type) {
            case 'below':
              isTriggered = numValue < alert.threshold_value;
              break;
            case 'above':
              isTriggered = numValue > alert.threshold_value;
              break;
            case 'equals':
              isTriggered = numValue === alert.threshold_value;
              break;
          }
          
          if (isTriggered) {
            triggeredRows.push({
              rowIndex: row.row_index,
              currentValue: numValue,
            });
          }
        }
      }
      
      if (triggeredRows.length > 0) {
        triggeredAlerts.push({
          alert,
          triggeredRows,
        });
        
        // 알림 히스토리 기록
        await supabase.from('alert_history').insert({
          alert_id: alert.id,
          file_name: alert.file_name,
          column_name: alert.column_name,
          triggered_value: triggeredRows[0].currentValue,
          threshold_value: alert.threshold_value,
          condition_type: alert.condition_type,
          notification_sent_to: alert.notification_type,
        });
        
        // 알림 트리거 시간 업데이트
        await supabase
          .from('alerts')
          .update({ last_triggered_at: new Date().toISOString() })
          .eq('id', alert.id);
      }
    }
    
    return NextResponse.json({
      success: true,
      triggered: triggeredAlerts,
      totalTriggered: triggeredAlerts.reduce((sum, t) => sum + t.triggeredRows.length, 0),
    });
  } catch (error) {
    console.error('Check alerts error:', error);
    return NextResponse.json(
      { success: false, error: '알림 체크에 실패했습니다.' },
      { status: 500 }
    );
  }
}

