import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import OpenAI from 'openai';

// OpenAI 클라이언트
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.length < 20) return null;
  return new OpenAI({ apiKey });
}

// 재고 부족 품목 타입
export interface LowStockItem {
  id: number;
  rowIndex: number;
  itemName: string;
  currentStock: number;
  optimalStock: number;  // base_stock 값 (기준 재고)
  shortage: number;
  shortagePercent: number;
  fileName: string;
}

// 컬럼명 매칭 함수 (유연한 매칭)
function findColumn(headers: string[], keywords: string[]): string | null {
  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().replace(/\s/g, '');
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.toLowerCase().replace(/\s/g, '');
      if (normalizedHeader.includes(normalizedKeyword)) {
        return header;
      }
    }
  }
  return null;
}

// POST: 재고 부족 체크 (base_stock 기준)
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { file_name, generateAISummary = true } = body;
    
    const supabase = createServerSupabaseClient();
    
    // 재고 데이터 조회 - base_stock이 설정된 행만 조회
    let query = supabase
      .from('재고')
      .select('*')
      .not('base_stock', 'is', null)  // base_stock이 NULL이 아닌 것만 (최종 확정된 것만)
      .order('file_name')
      .order('row_index');
    
    if (file_name) {
      query = query.eq('file_name', file_name);
    }
    
    const { data: inventoryData, error: dbError } = await query;
    
    if (dbError) {
      console.error('DB Error:', dbError);
      return NextResponse.json({
        success: false,
        error: 'DB 조회 실패',
        lowStockItems: [],
        totalChecked: 0,
      });
    }
    
    if (!inventoryData || inventoryData.length === 0) {
      return NextResponse.json({
        success: true,
        lowStockItems: [],
        totalChecked: 0,
        message: '최종 확정된 재고 데이터가 없습니다. [최종 확정] 버튼을 눌러 기준 재고를 설정해주세요.',
      });
    }
    
    // 파일별로 그룹화
    const fileGroups: Record<string, typeof inventoryData> = {};
    for (const row of inventoryData) {
      if (!fileGroups[row.file_name]) {
        fileGroups[row.file_name] = [];
      }
      fileGroups[row.file_name].push(row);
    }
    
    const lowStockItems: LowStockItem[] = [];
    let totalChecked = 0;
    
    // 각 파일별로 재고 체크
    for (const [fileName, rows] of Object.entries(fileGroups)) {
      if (rows.length === 0) continue;
      
      // 첫 번째 행에서 헤더(컬럼명) 추출
      const sampleData = rows[0].data as Record<string, unknown>;
      const headers = Object.keys(sampleData);
      
      // '현재 재고' 컬럼 찾기
      const currentStockColumn = findColumn(headers, [
        '현재재고', '현재 재고', '재고량', '재고수량', '현재수량', 
        '재고', 'stock', 'current_stock', 'quantity', 'qty'
      ]);
      
      // 품목명 컬럼 찾기
      const itemNameColumn = findColumn(headers, [
        '품목', '품목명', '상품명', '제품명', '이름', '품명', '항목',
        'name', 'item', 'product', 'item_name', 'product_name'
      ]);
      
      // 현재 재고 컬럼을 찾지 못한 경우 스킵
      if (!currentStockColumn) {
        console.log(`[${fileName}] 현재 재고 컬럼 없음`);
        continue;
      }
      
      // 각 행 검사 - base_stock(기준 재고) 기준으로 비교
      for (const row of rows) {
        const data = row.data as Record<string, unknown>;
        const currentStock = parseFloat(String(data[currentStockColumn] || 0));
        const baseStock = row.base_stock;  // DB에 저장된 기준 재고
        
        if (isNaN(currentStock) || baseStock === null || baseStock === undefined) continue;
        
        totalChecked++;
        
        // 현재 재고 < 기준 재고이면 부족
        if (currentStock < baseStock) {
          const shortage = baseStock - currentStock;
          const shortagePercent = baseStock > 0 
            ? Math.round((shortage / baseStock) * 100) 
            : 100;
          
          lowStockItems.push({
            id: row.id,
            rowIndex: row.row_index,
            itemName: String(data[itemNameColumn || 'id'] || `행 ${row.row_index}`),
            currentStock,
            optimalStock: baseStock,  // 기준 재고
            shortage,
            shortagePercent,
            fileName,
          });
          
          // 알람 상태 업데이트 (true로 변경)
          await supabase
            .from('재고')
            .update({ alarm_status: true })
            .eq('id', row.id);
        } else {
          // 정상 재고 - 알람 상태 해제
          if (row.alarm_status) {
            await supabase
              .from('재고')
              .update({ alarm_status: false })
              .eq('id', row.id);
          }
        }
      }
    }
    
    // 부족률 높은 순으로 정렬
    lowStockItems.sort((a, b) => b.shortagePercent - a.shortagePercent);
    
    // AI 요약 생성 (옵션)
    let aiSummary: string | undefined;
    if (generateAISummary && lowStockItems.length > 0) {
      const openai = getOpenAIClient();
      if (openai) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `당신은 재고 관리 AI 비서입니다. 재고 부족 현황을 분석하고 사장님께 간결하게 보고해주세요.
규칙:
1. 반드시 한국어로 답변
2. "사장님," 으로 시작
3. 가장 긴급한 품목 3개를 먼저 언급
4. 전체 부족 품목 수와 추천 조치 제안
5. 100단어 이내로 간결하게`
              },
              {
                role: 'user',
                content: `재고 부족 품목 ${lowStockItems.length}개 발견:
${lowStockItems.slice(0, 10).map(item => 
  `- ${item.itemName}: 현재 ${item.currentStock}개 / 기준 ${item.optimalStock}개 (${item.shortagePercent}% 부족)`
).join('\n')}`
              }
            ],
            temperature: 0.7,
            max_tokens: 300,
          });
          
          aiSummary = completion.choices[0]?.message?.content || undefined;
        } catch (aiError) {
          console.error('AI 요약 생성 실패:', aiError);
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      lowStockItems,
      totalChecked,
      aiSummary,
      checkedAt: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Stock check error:', error);
    return NextResponse.json({
      success: false,
      lowStockItems: [],
      totalChecked: 0,
      error: '재고 체크 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
