import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createServerSupabaseClient } from '@/lib/supabase';

// OpenAI 클라이언트를 런타임에서 생성
function getOpenAIClient(): OpenAI | null {
  const apiKey = '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';
  
  if (!apiKey || apiKey.length < 20) {
    console.error('OpenAI API key is missing or invalid');
    return null;
  }
  
  return new OpenAI({ apiKey });
}

interface AnalysisRequest {
  data: Array<Record<string, unknown>>;
  headers: string[];
  fileName: string;
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

    // DB에서 해당 파일의 알람 상태 조회 (base_stock 기준)
    const supabase = createServerSupabaseClient();
    const { data: alarmRows } = await supabase
      .from('재고')
      .select('id, data, base_stock, alarm_status')
      .eq('file_name', fileName)
      .eq('alarm_status', true);

    // 알람 상태인 품목들 (base_stock 기준으로 재고 부족인 것만)
    const alarmItems = (alarmRows || []).map(row => {
      const rowData = row.data as Record<string, unknown>;
      // 품목명 찾기
      const nameKeys = ['품목', '품목명', '상품명', '제품명', '이름', 'name', 'item', 'product'];
      let itemName = `행 ${row.id}`;
      for (const key of Object.keys(rowData)) {
        if (nameKeys.some(nk => key.toLowerCase().includes(nk.toLowerCase()))) {
          itemName = String(rowData[key]);
          break;
        }
      }
      // 현재 재고 찾기
      const stockKeys = ['현재재고', '재고', '수량', 'stock', 'quantity'];
      let currentStock = 0;
      for (const key of Object.keys(rowData)) {
        if (stockKeys.some(sk => key.toLowerCase().replace(/\s/g, '').includes(sk.toLowerCase()))) {
          currentStock = Number(rowData[key]) || 0;
          break;
        }
      }
      return {
        name: itemName,
        value: currentStock,
        baseStock: row.base_stock,
      };
    });

    // 숫자 컬럼 식별 및 통계 계산
    const numericColumns: string[] = [];
    const columnStats: Record<string, { 
      min: number; 
      max: number; 
      avg: number; 
      sum: number; 
      count: number;
      lowItems: Array<{ name: string; value: number }>;
    }> = {};

    // 이름/품목 컬럼 찾기
    const nameColumn = headers.find(h => 
      ['이름', '품목', '품목명', '상품명', '제품명', '항목', 'name', 'item', 'product'].some(
        keyword => h.toLowerCase().includes(keyword.toLowerCase())
      )
    ) || headers.find(h => h !== 'id') || 'id';

    // 숫자 컬럼 분석
    headers.forEach(header => {
      if (header === 'id') return;
      
      const values = data
        .map(row => row[header])
        .filter(v => v !== null && v !== undefined && !isNaN(Number(v)))
        .map(v => Number(v));

      if (values.length > 0 && values.length >= data.length * 0.3) {
        numericColumns.push(header);
        
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);

        // 재고 부족 품목: DB의 alarm_status가 true인 것만 사용 (base_stock 기준)
        // alarmItems가 없으면 빈 배열
        columnStats[header] = { 
          min, 
          max, 
          avg, 
          sum, 
          count: values.length, 
          lowItems: alarmItems.length > 0 ? alarmItems : [] 
        };
      }
    });
    
    // 첫 번째 숫자 컬럼에만 알람 품목 할당 (중복 방지)
    if (numericColumns.length > 0 && alarmItems.length > 0) {
      const firstNumericCol = numericColumns[0];
      Object.keys(columnStats).forEach(col => {
        if (col !== firstNumericCol) {
          columnStats[col].lowItems = [];
        }
      });
    }

    // AI에게 전달할 데이터 요약
    const dataSummary = {
      fileName,
      totalRows: data.length,
      numericColumns: numericColumns.map(col => ({
        name: col,
        stats: columnStats[col],
      })),
      sampleData: data.slice(0, 5).map(row => {
        const simplified: Record<string, unknown> = {};
        headers.slice(0, 8).forEach(h => {
          simplified[h] = row[h];
        });
        return simplified;
      }),
    };

    // OpenAI API 호출
    const openai = getOpenAIClient();
    
    if (!openai) {
      // API 키가 없으면 기본 응답 반환
      return NextResponse.json({
        success: true,
        analysis: `사장님, ${fileName} 파일의 데이터 ${data.length}개 행을 확인했습니다. AI 분석을 위해서는 OpenAI API 키 설정이 필요합니다.`,
        insights: {
          totalRows: data.length,
          numericColumnsCount: numericColumns.length,
          lowStockAlerts: [],
          columnStats,
        },
        generatedAt: new Date().toISOString(),
      });
    }
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `당신은 중소기업 사장님을 위한 AI 경영 비서입니다. 
재고 데이터를 분석하고, 사장님께 친근하고 명확하게 브리핑해주세요.

규칙:
1. 반드시 한국어로 답변하세요.
2. "사장님," 으로 시작하는 대화체로 작성하세요.
3. 재고가 부족한 품목, 발주가 필요한 항목, 전체적인 재고 상황을 알려주세요.
4. 구체적인 숫자와 품목명을 언급하세요.
5. 실행 가능한 조언을 1-2가지 제안하세요.
6. 전체 답변은 200단어 이내로 간결하게 작성하세요.
7. 긍정적이고 격려하는 톤을 유지하세요.`
        },
        {
          role: 'user',
          content: `다음 재고 데이터를 분석해서 경영 브리핑을 작성해주세요:

파일명: ${fileName}
총 행 수: ${dataSummary.totalRows}개

숫자 컬럼 통계:
${dataSummary.numericColumns.map(col => `
[${col.name}]
- 범위: ${col.stats.min.toLocaleString()} ~ ${col.stats.max.toLocaleString()}
- 평균: ${col.stats.avg.toFixed(1)}
- 합계: ${col.stats.sum.toLocaleString()}
- 부족 품목 (${col.stats.lowItems.length}개): ${col.stats.lowItems.map(item => `${item.name}(${item.value})`).join(', ') || '없음'}
`).join('\n')}

샘플 데이터:
${JSON.stringify(dataSummary.sampleData, null, 2)}`
        }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const aiResponse = completion.choices[0]?.message?.content || '분석 결과를 생성할 수 없습니다.';

    // 추가 통계 정보
    const insights = {
      totalRows: data.length,
      numericColumnsCount: numericColumns.length,
      lowStockAlerts: Object.entries(columnStats)
        .filter(([_, stats]) => stats.lowItems.length > 0)
        .map(([column, stats]) => ({
          column,
          count: stats.lowItems.length,
          items: stats.lowItems.slice(0, 5),
        })),
      columnStats,
    };

    return NextResponse.json({
      success: true,
      analysis: aiResponse,
      insights,
      generatedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('AI Analysis error:', error);
    
    // OpenAI API 키 문제 확인
    if (error instanceof Error && error.message.includes('API key')) {
      return NextResponse.json({
        success: false,
        error: 'OpenAI API 키가 설정되지 않았거나 유효하지 않습니다.',
      }, { status: 401 });
    }

    return NextResponse.json({
      success: false,
      error: 'AI 분석 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}

