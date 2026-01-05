import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

const supabase = createServerSupabaseClient();

// 알림 타입 정의
interface Alert {
  id?: number;
  file_name: string;
  column_name: string;
  condition_type: 'below' | 'above' | 'equals';
  threshold_value: number;
  notification_type: string[];
  email?: string;
  is_active?: boolean;
}

// GET: 알림 목록 조회
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file_name');
    
    let query = supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (fileName) {
      query = query.eq('file_name', fileName);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Get alerts error:', error);
    return NextResponse.json(
      { success: false, error: '알림 목록을 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}

// POST: 새 알림 생성
export async function POST(request: Request) {
  try {
    const body: Alert = await request.json();
    
    // 필수 필드 검증
    if (!body.file_name || !body.column_name || !body.condition_type || body.threshold_value === undefined) {
      return NextResponse.json(
        { success: false, error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase
      .from('alerts')
      .insert([{
        file_name: body.file_name,
        column_name: body.column_name,
        condition_type: body.condition_type,
        threshold_value: body.threshold_value,
        notification_type: body.notification_type || [],
        email: body.email,
        is_active: body.is_active ?? true,
      }])
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Create alert error:', error);
    return NextResponse.json(
      { success: false, error: '알림 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// PUT: 알림 수정
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.id) {
      return NextResponse.json(
        { success: false, error: '알림 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase
      .from('alerts')
      .update({
        column_name: body.column_name,
        condition_type: body.condition_type,
        threshold_value: body.threshold_value,
        notification_type: body.notification_type,
        email: body.email,
        is_active: body.is_active,
      })
      .eq('id', body.id)
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Update alert error:', error);
    return NextResponse.json(
      { success: false, error: '알림 수정에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// DELETE: 알림 삭제
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: '알림 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    const { error } = await supabase
      .from('alerts')
      .delete()
      .eq('id', parseInt(id));
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete alert error:', error);
    return NextResponse.json(
      { success: false, error: '알림 삭제에 실패했습니다.' },
      { status: 500 }
    );
  }
}

