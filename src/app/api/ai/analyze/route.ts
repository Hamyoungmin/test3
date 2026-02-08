import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createServerSupabaseClient } from '@/lib/supabase';

// OpenAI 클라이언트를 런타임에서 생성
function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // 디버깅: 환경 변수 확인
  console.log('[OpenAI] API Key loaded:', apiKey ? `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 5)} (length: ${apiKey.length})` : 'NOT FOUND');
  
  if (!apiKey || apiKey.length < 20) {
    console.error('[OpenAI] API key is missing or invalid. Please set OPENAI_API_KEY in .env.local');
    return null;
  }
  
  return new OpenAI({ apiKey });
}

interface AnalysisRequest {
  data: Array<Record<string, unknown>>;
  headers: string[];
  fileName: string;
}

interface LowStockItem {
  id: number;
  itemName: string;
  currentStock: number;
  baseStock: number;
  shortage: number;
  shortagePercent: number;
}

// POST: AI 재고 분석
export async function POST(request: Request) {
  try {
    const body: AnalysisRequest = await request.json();
    const { data, headers, fileName } = body;

    if (!data || data.length === 0) {
      return NextResponse.json({
        success: false,
        error: '분석할 데이터가 없습니다.',
      });
    }

    // DB에서 해당 파일의 모든 데이터 조회 (base_stock 포함)
    const supabase = createServerSupabaseClient();
    const { data: allRows } = await supabase
      .from('재고')
      .select('id, data, base_stock, alarm_status')
      .eq('file_name', fileName);

    // 재고 부족 품목 상세 분석
    const lowStockItems: LowStockItem[] = [];
    let totalShortage = 0;
    let confirmedItemsCount = 0; // 기준 재고가 설정된 품목 수

    // 품목명 컬럼 키 찾기
    const nameKeys = ['품목', '품목명', '상품명', '제품명', '이름', 'name', 'item', 'product', '세목', '항목'];
    const stockKeys = ['현재재고', '현재_재고', '재고', '재고량', '수량', 'stock', 'quantity', '잔량'];

    (allRows || []).forEach(row => {
      const rowData = row.data as Record<string, unknown>;
      if (!rowData) return;

      // 품목명 찾기
      let itemName = `행 #${row.id}`;
      for (const key of Object.keys(rowData)) {
        if (nameKeys.some(nk => key.toLowerCase().includes(nk.toLowerCase()))) {
          const val = rowData[key];
          if (val && String(val).trim()) {
            itemName = String(val);
            break;
          }
        }
      }

      // 현재 재고 찾기
      let currentStock = 0;
      for (const key of Object.keys(rowData)) {
        const normalizedKey = key.toLowerCase().replace(/[\s_]/g, '');
        if (stockKeys.some(sk => normalizedKey.includes(sk.toLowerCase().replace(/[\s_]/g, '')))) {
          currentStock = Number(rowData[key]) || 0;
          break;
        }
      }

      // 숫자 데이터가 있는 첫 번째 컬럼에서 현재 값 추출 (재고 컬럼이 없는 경우)
      if (currentStock === 0) {
        for (const key of Object.keys(rowData)) {
          const val = rowData[key];
          if (typeof val === 'number' && val > 0) {
            currentStock = val;
            break;
          }
        }
      }

      // 기준 재고가 설정된 품목인지 확인
      if (row.base_stock !== null && row.base_stock !== undefined) {
        confirmedItemsCount++;
        
        // 재고 부족 여부 확인
        if (currentStock < row.base_stock) {
          const shortage = row.base_stock - currentStock;
          totalShortage += shortage;
          
          lowStockItems.push({
            id: row.id,
            itemName,
            currentStock,
            baseStock: row.base_stock,
            shortage,
            shortagePercent: row.base_stock > 0 ? Math.round((shortage / row.base_stock) * 100) : 0,
          });
        }
      }
    });

    // 부족 정도에 따라 정렬 (가장 부족한 순)
    lowStockItems.sort((a, b) => b.shortagePercent - a.shortagePercent);

    // 통계 계산
    const totalItems = data.length;
    const lowStockCount = lowStockItems.length;
    const criticalItems = lowStockItems.filter(item => item.shortagePercent >= 50); // 50% 이상 부족
    const warningItems = lowStockItems.filter(item => item.shortagePercent >= 20 && item.shortagePercent < 50);

    // 숫자 컬럼 통계
    const numericStats: Record<string, { min: number; max: number; avg: number; sum: number; count: number }> = {};
    headers.forEach(header => {
      if (header === 'id') return;
      const values = data
        .map(row => row[header])
        .filter(v => v !== null && v !== undefined && !isNaN(Number(v)))
        .map(v => Number(v));

      if (values.length > data.length * 0.3) {
        const sum = values.reduce((a, b) => a + b, 0);
        numericStats[header] = {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: sum / values.length,
          sum,
          count: values.length,
        };
      }
    });

    // OpenAI API 호출
    const openai = getOpenAIClient();
    
    if (!openai) {
      // API 키가 없으면 상세한 기본 분석 반환
      const basicAnalysis = generateBasicAnalysis(fileName, totalItems, confirmedItemsCount, lowStockItems, totalShortage, criticalItems);
      
      return NextResponse.json({
        success: true,
        analysis: basicAnalysis,
        insights: {
          totalRows: totalItems,
          confirmedItems: confirmedItemsCount,
          lowStockCount,
          totalShortage,
          criticalCount: criticalItems.length,
          warningCount: warningItems.length,
          lowStockItems: lowStockItems.slice(0, 10),
          numericStats,
        },
        generatedAt: new Date().toISOString(),
      });
    }

    // AI 프롬프트 구성 - 상세하고 전문적인 분석 요청
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `당신은 대기업 수준의 전문 재고관리 AI 컨설턴트입니다.
사장님께 보고서 형식으로 정확하고 상세한 재고 분석을 제공합니다.

## 출력 형식 (반드시 준수)

📊 **재고 현황 요약**
- 총 품목 수, 기준 재고 설정 품목 수, 재고 부족 품목 수를 명시

🚨 **긴급 발주 필요 품목** (가장 부족한 상위 5개)
- 품목명: 현재 OO개 / 기준 OO개 (부족 OO개, OO% 부족)

📦 **발주 권고 사항**
- 총 발주 예상 수량: OO개
- 우선순위별 발주 제안

💡 **경영 인사이트**
- 재고 운영 개선 제안 1-2가지

## 규칙
1. 반드시 한국어로, 격식체(~습니다, ~입니다)로 작성
2. 수치는 정확하게, 계산 근거를 명확히
3. 이모지를 적절히 활용하여 가독성 향상
4. 전체 300단어 이내로 간결하게`
        },
        {
          role: 'user',
          content: `다음 재고 데이터를 분석하여 전문적인 보고서를 작성해주세요:

## 기본 정보
- 파일명: ${fileName}
- 총 품목 수: ${totalItems}개
- 기준 재고 설정 품목: ${confirmedItemsCount}개
- 재고 부족 품목: ${lowStockCount}개
- 총 부족 수량: ${totalShortage.toLocaleString()}개

## 재고 부족 품목 상세 (상위 10개)
${lowStockItems.slice(0, 10).map((item, idx) => 
`${idx + 1}. ${item.itemName}
   - 현재: ${item.currentStock.toLocaleString()}개
   - 기준: ${item.baseStock.toLocaleString()}개
   - 부족: ${item.shortage.toLocaleString()}개 (${item.shortagePercent}% 부족)`
).join('\n') || '없음'}

## 긴급도 분류
- 🔴 위험 (50% 이상 부족): ${criticalItems.length}개 품목
- 🟡 주의 (20~50% 부족): ${warningItems.length}개 품목
- 🟢 정상: ${confirmedItemsCount - lowStockCount}개 품목

## 숫자 컬럼 통계
${Object.entries(numericStats).slice(0, 5).map(([col, stats]) => 
`[${col}] 범위: ${stats.min.toLocaleString()} ~ ${stats.max.toLocaleString()}, 평균: ${stats.avg.toFixed(1)}, 합계: ${stats.sum.toLocaleString()}`
).join('\n')}

위 데이터를 바탕으로 사장님께 보고할 전문적인 재고 분석 리포트를 작성해주세요.`
        }
      ],
      temperature: 0.5,
      max_tokens: 800,
    });

    const aiResponse = completion.choices[0]?.message?.content || generateBasicAnalysis(fileName, totalItems, confirmedItemsCount, lowStockItems, totalShortage, criticalItems);

    return NextResponse.json({
      success: true,
      analysis: aiResponse,
      insights: {
        totalRows: totalItems,
        confirmedItems: confirmedItemsCount,
        lowStockCount,
        totalShortage,
        criticalCount: criticalItems.length,
        warningCount: warningItems.length,
        lowStockItems: lowStockItems.slice(0, 10),
        numericStats,
      },
      generatedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('AI Analysis error:', error);
    
    // 기본 insights 응답 (에러 시에도 UI가 깨지지 않도록)
    const defaultInsights = {
      totalRows: 0,
      confirmedItems: 0,
      lowStockCount: 0,
      totalShortage: 0,
      criticalCount: 0,
      warningCount: 0,
      lowStockItems: [],
      numericStats: {},
    };
    
    if (error instanceof Error && error.message.includes('API key')) {
      return NextResponse.json({
        success: false,
        error: 'OpenAI API 키가 설정되지 않았거나 유효하지 않습니다.',
        insights: defaultInsights,
      }, { status: 401 });
    }

    return NextResponse.json({
      success: false,
      error: 'AI 분석 중 오류가 발생했습니다.',
      insights: defaultInsights,
    }, { status: 500 });
  }
}

// API 키 없을 때 기본 분석 생성
function generateBasicAnalysis(
  fileName: string,
  totalItems: number,
  confirmedItems: number,
  lowStockItems: LowStockItem[],
  totalShortage: number,
  criticalItems: LowStockItem[]
): string {
  const lowStockCount = lowStockItems.length;
  
  let analysis = `📊 **재고 현황 요약**\n\n`;
  analysis += `${fileName} 파일의 재고 현황을 분석했습니다.\n\n`;
  analysis += `• 총 품목 수: ${totalItems.toLocaleString()}개\n`;
  analysis += `• 기준 재고 설정: ${confirmedItems}개 품목\n`;
  
  if (lowStockCount > 0) {
    analysis += `• **재고 부족: ${lowStockCount}개 품목**\n\n`;
    
    analysis += `🚨 **긴급 발주 필요 품목**\n\n`;
    lowStockItems.slice(0, 5).forEach((item, idx) => {
      analysis += `${idx + 1}. **${item.itemName}**\n`;
      analysis += `   현재 ${item.currentStock.toLocaleString()}개 / 기준 ${item.baseStock.toLocaleString()}개 (${item.shortage.toLocaleString()}개 부족, ${item.shortagePercent}%↓)\n\n`;
    });
    
    analysis += `📦 **발주 권고 사항**\n\n`;
    analysis += `• 총 발주 예상 수량: **${totalShortage.toLocaleString()}개**\n`;
    analysis += `• 긴급 발주 필요: ${criticalItems.length}개 품목\n\n`;
    
    analysis += `💡 **권장 조치**\n`;
    analysis += `재고 부족 품목에 대한 즉시 발주를 권장드립니다.`;
  } else if (confirmedItems === 0) {
    analysis += `\n⚠️ 기준 재고가 설정된 품목이 없습니다.\n`;
    analysis += `'최종 확정' 버튼을 눌러 각 품목의 기준 재고를 설정해주세요.`;
  } else {
    analysis += `\n✅ **모든 품목의 재고가 정상 수준입니다.**\n`;
    analysis += `현재 재고 관리가 잘 되고 있습니다.`;
  }
  
  return analysis;
}
