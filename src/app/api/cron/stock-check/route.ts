import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import OpenAI from 'openai';

// Vercel Cron Job - 매일 오전 9시 실행
// vercel.json에 설정 필요

function getOpenAIClient() {
  // 환경변수 또는 하드코딩된 키 사용
  const apiKey = process.env.OPENAI_API_KEY || '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';
  if (!apiKey || apiKey.length < 20) return null;
  return new OpenAI({ apiKey });
}

function findColumn(headers: string[], keywords: string[]): string | null {
  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().replace(/\s/g, '');
    for (const keyword of keywords) {
      if (normalizedHeader.includes(keyword.toLowerCase().replace(/\s/g, ''))) {
        return header;
      }
    }
  }
  return null;
}

interface LowStockItem {
  id: number;
  rowIndex: number;
  itemName: string;
  currentStock: number;
  optimalStock: number;
  shortage: number;
  shortagePercent: number;
  fileName: string;
}

// GET: Cron Job 호출
export async function GET(request: Request) {
  try {
    // 인증 확인 (선택적)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    
    const supabase = createServerSupabaseClient();
    
    const { data: inventoryData, error: dbError } = await supabase
      .from('재고')
      .select('*')
      .order('file_name')
      .order('row_index');
    
    if (dbError) {
      return NextResponse.json({ success: false, error: 'DB 오류' }, { status: 500 });
    }
    
    if (!inventoryData || inventoryData.length === 0) {
      return NextResponse.json({ success: true, message: '데이터 없음', lowStockCount: 0 });
    }
    
    // 파일별 그룹화
    const fileGroups: Record<string, typeof inventoryData> = {};
    for (const row of inventoryData) {
      if (!fileGroups[row.file_name]) fileGroups[row.file_name] = [];
      fileGroups[row.file_name].push(row);
    }
    
    const lowStockItems: LowStockItem[] = [];
    let totalChecked = 0;
    
    for (const [fileName, rows] of Object.entries(fileGroups)) {
      if (rows.length === 0) continue;
      
      const sampleData = rows[0].data as Record<string, unknown>;
      const headers = Object.keys(sampleData);
      
      const currentStockColumn = findColumn(headers, ['현재재고', '현재 재고', '재고량', '재고', 'stock', 'quantity']);
      const optimalStockColumn = findColumn(headers, ['적정재고', '적정 재고', '최소재고', '안전재고', 'min_stock', 'optimal_stock']);
      const itemNameColumn = findColumn(headers, ['품목', '품목명', '상품명', '제품명', '이름', 'name', 'item', 'product']);
      
      if (!currentStockColumn || !optimalStockColumn) continue;
      
      for (const row of rows) {
        const data = row.data as Record<string, unknown>;
        const currentStock = parseFloat(String(data[currentStockColumn] || 0));
        const optimalStock = parseFloat(String(data[optimalStockColumn] || 0));
        
        if (isNaN(currentStock) || isNaN(optimalStock)) continue;
        totalChecked++;
        
        if (currentStock < optimalStock) {
          const shortage = optimalStock - currentStock;
          lowStockItems.push({
            id: row.id,
            rowIndex: row.row_index,
            itemName: String(data[itemNameColumn || 'id'] || `행 ${row.row_index}`),
            currentStock,
            optimalStock,
            shortage,
            shortagePercent: Math.round((shortage / optimalStock) * 100),
            fileName,
          });
        }
      }
    }
    
    lowStockItems.sort((a, b) => b.shortagePercent - a.shortagePercent);
    
    // AI 요약
    let aiSummary: string | undefined;
    if (lowStockItems.length > 0) {
      const openai = getOpenAIClient();
      if (openai) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: '재고 관리 AI입니다. 매일 아침 재고 현황을 보고합니다. 한국어로 150단어 이내로 작성하세요.' },
              { role: 'user', content: `오늘 재고 체크 결과: 총 ${totalChecked}개 중 ${lowStockItems.length}개 부족\n${lowStockItems.slice(0, 10).map(i => `- ${i.itemName}: ${i.currentStock}/${i.optimalStock}`).join('\n')}` }
            ],
            max_tokens: 400,
          });
          aiSummary = completion.choices[0]?.message?.content || undefined;
        } catch (e) {
          console.error('AI 오류:', e);
        }
      }
    }
    
    console.log(`[Cron] 재고 체크: ${totalChecked}개 중 ${lowStockItems.length}개 부족`);
    
    return NextResponse.json({
      success: true,
      totalChecked,
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 20),
      aiSummary,
      checkedAt: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
