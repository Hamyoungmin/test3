import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

// 재고 컬럼으로 사용될 수 있는 키워드들
const STOCK_KEYWORDS = [
  '현재재고', '현재_재고', '재고', '재고량', '수량', 
  '최종확정재고', '최종_확정_재고', '확정재고',
  'stock', 'quantity', 'inventory', 'current_stock'
];

// data JSONB에서 재고 값을 찾는 함수 (키워드 우선, 없으면 첫 번째 숫자)
function findStockValue(data: Record<string, unknown>): number | null {
  if (!data || typeof data !== 'object') return null;
  
  // 1차: 키워드 매칭으로 재고 값 찾기
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase().replace(/\s/g, '');
    for (const keyword of STOCK_KEYWORDS) {
      if (lowerKey.includes(keyword.toLowerCase().replace(/\s/g, ''))) {
        const value = data[key];
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const num = parseFloat(value.replace(/,/g, ''));
          if (!isNaN(num)) return num;
        }
      }
    }
  }
  
  // 2차: 키워드 매칭 실패 시, 첫 번째 숫자 값 사용
  for (const key of Object.keys(data)) {
    if (key === 'id') continue; // id는 제외
    const value = data[key];
    if (typeof value === 'number' && value >= 0) return value;
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/,/g, ''));
      if (!isNaN(num) && num >= 0) return num;
    }
  }
  
  return null;
}

// POST: 특정 행의 알람 상태 체크 및 업데이트
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rowId, data } = body;

    if (!rowId) {
      return NextResponse.json({
        success: false,
        error: 'rowId가 필요합니다.',
      }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    // 현재 행 데이터 조회
    const { data: row, error: fetchError } = await supabase
      .from('재고')
      .select('*')
      .eq('id', rowId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return NextResponse.json({
        success: false,
        error: '데이터 조회 실패',
      }, { status: 500 });
    }

    // 기준 재고가 없으면 알람 체크 안함
    if (row.base_stock === null || row.base_stock === undefined) {
      return NextResponse.json({
        success: true,
        rowId,
        alarmStatus: false,
        message: '기준 재고가 설정되지 않음 - 먼저 [최종 확정]을 눌러주세요',
      });
    }

    // 현재 재고 값 찾기
    const stockData = data || row.data;
    const currentStock = findStockValue(stockData);

    // 알람 상태 결정: 현재 재고 < 기준 재고 → true
    let newAlarmStatus = false;
    if (currentStock !== null && row.base_stock > 0) {
      newAlarmStatus = currentStock < row.base_stock;
    }

    // 알람 상태 업데이트
    const { error: updateError } = await supabase
      .from('재고')
      .update({ alarm_status: newAlarmStatus })
      .eq('id', rowId);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json({
        success: false,
        error: '알람 상태 업데이트 실패',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      rowId,
      currentStock,
      baseStock: row.base_stock,
      alarmStatus: newAlarmStatus,
      message: newAlarmStatus 
        ? `⚠️ 재고 부족! 현재 ${currentStock} < 기준재고 ${row.base_stock}`
        : '✅ 재고 정상',
    });

  } catch (error) {
    console.error('Check alarm error:', error);
    return NextResponse.json({
      success: false,
      error: '알람 체크 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}

// PUT: [최종 확정] - 현재 재고를 기준 재고로 저장
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { rowId, baseStock } = body;

    if (!rowId) {
      return NextResponse.json({
        success: false,
        error: 'rowId가 필요합니다.',
      }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    // 현재 행 데이터 조회
    const { data: row, error: fetchError } = await supabase
      .from('재고')
      .select('*')
      .eq('id', rowId)
      .single();

    if (fetchError) {
      return NextResponse.json({
        success: false,
        error: '데이터 조회 실패',
      }, { status: 500 });
    }

    // baseStock이 제공되지 않으면 현재 재고 값을 기준 재고로 사용
    let effectiveBaseStock = baseStock;
    if (effectiveBaseStock === undefined || effectiveBaseStock === null) {
      effectiveBaseStock = findStockValue(row.data);
    }

    if (effectiveBaseStock === null) {
      return NextResponse.json({
        success: false,
        error: '재고 값을 찾을 수 없습니다. 재고 컬럼을 확인해주세요.',
      }, { status: 400 });
    }

    // base_stock 업데이트, alarm_status는 false로 초기화 (최종 확정 시점)
    const { error: updateError } = await supabase
      .from('재고')
      .update({ 
        base_stock: effectiveBaseStock,
        alarm_status: false, // 확정 시점에서는 알람 없음
      })
      .eq('id', rowId);

    if (updateError) {
      return NextResponse.json({
        success: false,
        error: '기준 재고 설정 실패',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      rowId,
      baseStock: effectiveBaseStock,
      alarmStatus: false,
      message: `✅ 기준 재고가 ${effectiveBaseStock}으로 확정되었습니다.`,
    });

  } catch (error) {
    console.error('Set base_stock error:', error);
    return NextResponse.json({
      success: false,
      error: '기준 재고 설정 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}

// GET: 알람 상태인 모든 행 조회
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file_name');

    const supabase = createServerSupabaseClient();

    let query = supabase
      .from('재고')
      .select('*')
      .eq('alarm_status', true);

    if (fileName) {
      query = query.eq('file_name', fileName);
    }

    const { data: alarmRows, error } = await query;

    if (error) {
      return NextResponse.json({
        success: false,
        error: '알람 데이터 조회 실패',
      }, { status: 500 });
    }

    // 알람 행 데이터 가공
    const alerts = (alarmRows || []).map(row => {
      const currentStock = findStockValue(row.data);
      return {
        id: row.id,
        fileName: row.file_name,
        rowIndex: row.row_index,
        currentStock,
        baseStock: row.base_stock,
        data: row.data,
      };
    });

    return NextResponse.json({
      success: true,
      count: alerts.length,
      alerts,
    });

  } catch (error) {
    console.error('Get alarms error:', error);
    return NextResponse.json({
      success: false,
      error: '알람 조회 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}

// PATCH: 전체 최종 확정 - 파일의 모든 행에 대해 현재 재고를 기준 재고로 설정
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { fileName, rowIds } = body;

    if (!fileName && (!rowIds || rowIds.length === 0)) {
      return NextResponse.json({
        success: false,
        error: 'fileName 또는 rowIds가 필요합니다.',
      }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    // 대상 행 조회
    let query = supabase.from('재고').select('*');
    
    if (rowIds && rowIds.length > 0) {
      query = query.in('id', rowIds);
    } else if (fileName) {
      query = query.eq('file_name', fileName);
    }

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      return NextResponse.json({
        success: false,
        error: '데이터 조회 실패',
      }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: '확정할 데이터가 없습니다.',
      }, { status: 404 });
    }

    // 각 행의 현재 재고를 기준 재고로 설정
    let successCount = 0;
    let failCount = 0;

    for (const row of rows) {
      const currentStock = findStockValue(row.data);
      
      // 재고 값을 찾지 못해도 0으로 설정하여 "확정됨" 상태로 만듦
      const effectiveStock = currentStock ?? 0;

      const { error: updateError } = await supabase
        .from('재고')
        .update({
          base_stock: effectiveStock,
          alarm_status: false, // 확정 시점에서는 알람 없음
        })
        .eq('id', row.id);

      if (updateError) {
        failCount++;
      } else {
        successCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `✅ ${successCount}개 행이 최종 확정되었습니다.${failCount > 0 ? ` (${failCount}개 실패)` : ''}`,
      successCount,
      failCount,
      totalProcessed: rows.length,
    });

  } catch (error) {
    console.error('Bulk confirm error:', error);
    return NextResponse.json({
      success: false,
      error: '전체 확정 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
