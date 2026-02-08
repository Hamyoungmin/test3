// OpenAI API 설정
// 주의: 실제 배포 시에는 API 키를 서버에서 관리하세요!
const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY'; // 여기에 API 키 입력

interface InventoryData {
  itemName: string;
  currentStock: number;
  baseStock: number;
  shortage: number;
  isLowStock: boolean;
}

export async function getAIBusinessAdvice(inventoryData: InventoryData[]): Promise<string> {
  // API 키가 설정되지 않은 경우 기본 메시지 반환
  if (OPENAI_API_KEY === 'YOUR_OPENAI_API_KEY' || !OPENAI_API_KEY) {
    return generateLocalAdvice(inventoryData);
  }

  try {
    // 재고 상황 요약 생성
    const lowStockItems = inventoryData.filter(item => item.isLowStock);
    const totalItems = inventoryData.length;
    
    const inventorySummary = lowStockItems.length > 0
      ? lowStockItems.map(item => 
          `- ${item.itemName}: 현재 ${item.currentStock}개 (기준 ${item.baseStock}개, ${item.shortage}개 부족)`
        ).join('\n')
      : '모든 품목의 재고가 충분합니다.';

    const prompt = `당신은 소규모 사업체의 경영 컨설턴트입니다. 아래 재고 현황을 보고 사장님께 오늘 어떤 품목을 우선적으로 주문해야 할지 한 문장으로 추천해주세요. 친근하고 실용적인 조언을 해주세요.

총 품목 수: ${totalItems}개
재고 부족 품목 수: ${lowStockItems.length}개

재고 부족 현황:
${inventorySummary}

한 문장으로 조언해주세요:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '당신은 친근하고 실용적인 경영 컨설턴트입니다. 항상 한 문장으로 핵심만 조언합니다.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI API 호출 실패');
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || generateLocalAdvice(inventoryData);
    
  } catch (error) {
    console.error('AI 조언 생성 실패:', error);
    return generateLocalAdvice(inventoryData);
  }
}

// OpenAI API 없이 로컬에서 조언 생성 (폴백)
function generateLocalAdvice(inventoryData: InventoryData[]): string {
  const lowStockItems = inventoryData.filter(item => item.isLowStock);
  
  if (lowStockItems.length === 0) {
    const messages = [
      "오늘은 재고가 모두 충분합니다! 여유롭게 영업에 집중하세요. 💪",
      "재고 상태 좋습니다! 오늘 하루도 화이팅하세요! ✨",
      "모든 품목이 안정적이에요. 고객 서비스에 집중해보세요! 😊",
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  if (lowStockItems.length === 1) {
    const item = lowStockItems[0];
    return `"${item.itemName}" 재고가 ${item.shortage}개 부족해요. 오늘 중으로 발주하시는 걸 추천드려요! 📦`;
  }

  // 가장 부족한 품목 찾기
  const mostUrgent = lowStockItems.reduce((prev, current) => 
    current.shortage > prev.shortage ? current : prev
  );

  // 총 부족량
  const totalShortage = lowStockItems.reduce((sum, item) => sum + item.shortage, 0);

  const advices = [
    `${lowStockItems.length}개 품목 중 "${mostUrgent.itemName}"이 가장 급해요! 총 ${totalShortage}개 발주가 필요합니다. 📋`,
    `오늘 "${mostUrgent.itemName}" 먼저 주문하시고, 나머지 ${lowStockItems.length - 1}개 품목도 체크해보세요! 🔍`,
    `"${mostUrgent.itemName}" 외 ${lowStockItems.length - 1}개 품목 재고 부족! 오전 중 발주 추천드려요. ⏰`,
  ];

  return advices[Math.floor(Math.random() * advices.length)];
}
