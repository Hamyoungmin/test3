import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Service Role Key를 사용하여 DDL 쿼리 실행
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { columnName, columnType = 'text' } = body;

    if (!columnName) {
      return NextResponse.json(
        { success: false, error: '컬럼 이름이 필요합니다.' },
        { status: 400 }
      );
    }

    // 컬럼 이름 유효성 검사 (영문, 숫자, 한글, 언더스코어만 허용)
    const validColumnName = /^[a-zA-Z0-9가-힣_]+$/;
    if (!validColumnName.test(columnName)) {
      return NextResponse.json(
        { success: false, error: '컬럼 이름은 영문, 숫자, 한글, 언더스코어만 사용할 수 있습니다.' },
        { status: 400 }
      );
    }

    // SQL 타입 매핑
    const typeMap: Record<string, string> = {
      text: 'TEXT',
      number: 'NUMERIC',
      integer: 'INTEGER',
      boolean: 'BOOLEAN',
      date: 'DATE',
      timestamp: 'TIMESTAMPTZ',
    };

    const sqlType = typeMap[columnType] || 'TEXT';

    // ALTER TABLE로 새 컬럼 추가
    const { error } = await supabaseAdmin.rpc('exec_sql', {
      query: `ALTER TABLE "재고" ADD COLUMN IF NOT EXISTS "${columnName}" ${sqlType};`
    });

    // rpc가 없으면 직접 SQL 실행 시도
    if (error && error.message.includes('function') && error.message.includes('does not exist')) {
      // Supabase SQL Editor를 통해 실행해야 함을 알림
      // 대안: 더미 데이터 삽입으로 컬럼 자동 생성
      const { data: existingData } = await supabaseAdmin
        .from('재고')
        .select('id')
        .limit(1);

      if (existingData && existingData.length > 0) {
        // 기존 행에 새 컬럼 값 추가 (upsert로 스키마 확장)
        const { error: updateError } = await supabaseAdmin
          .from('재고')
          .update({ [columnName]: null })
          .eq('id', existingData[0].id);

        if (updateError) {
          // 컬럼이 없어서 실패하면, insert로 시도
          const { error: insertError } = await supabaseAdmin
            .from('재고')
            .insert({ [columnName]: null });

          if (insertError && !insertError.message.includes('duplicate')) {
            throw insertError;
          }
        }
      } else {
        // 테이블이 비어있으면 새 행 추가
        const { error: insertError } = await supabaseAdmin
          .from('재고')
          .insert({ [columnName]: null });

        if (insertError) {
          throw insertError;
        }
      }
    } else if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `'${columnName}' 컬럼이 추가되었습니다.`,
      columnName,
      columnType: sqlType,
    });
  } catch (error) {
    console.error('Add column error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '컬럼 추가 중 오류가 발생했습니다.' 
      },
      { status: 500 }
    );
  }
}

