// Supabase Edge Function - 재고 부족 알림 발송
// Supabase Dashboard > Edge Functions에서 배포하세요

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Expo Push API로 알림 발송
async function sendPushNotification(expoPushToken: string, title: string, body: string) {
  const message = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data: { type: 'inventory_alert' },
    priority: 'high',
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })

    const result = await response.json()
    return { success: true, result }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// 현재 재고 컬럼 값 찾기
function findCurrentStock(data: Record<string, unknown>): number {
  const keywords = ['현재재고', '현재 재고', '재고', '수량', 'stock', 'quantity', 'qty']
  
  for (const key of Object.keys(data)) {
    const normalizedKey = key.toLowerCase().replace(/\s/g, '')
    for (const keyword of keywords) {
      if (normalizedKey.includes(keyword.toLowerCase())) {
        return Number(data[key]) || 0
      }
    }
  }
  return 0
}

// 품목명 찾기
function findItemName(data: Record<string, unknown>): string {
  const keywords = ['품목', '품목명', '상품명', '제품명', '이름', '항목', 'name', 'item', 'product']
  
  for (const key of Object.keys(data)) {
    const normalizedKey = key.toLowerCase().replace(/\s/g, '')
    for (const keyword of keywords) {
      if (normalizedKey.includes(keyword.toLowerCase())) {
        const value = data[key]
        if (value && String(value).trim()) {
          return String(value)
        }
      }
    }
  }
  return '알 수 없는 품목'
}

Deno.serve(async (req) => {
  try {
    // 1. 재고 부족 품목 조회
    const { data: inventoryItems, error: inventoryError } = await supabase
      .from('재고')
      .select('*')
      .not('base_stock', 'is', null)

    if (inventoryError) {
      throw new Error(`재고 조회 실패: ${inventoryError.message}`)
    }

    // 2. 재고 부족 품목 필터링
    const lowStockItems = inventoryItems?.filter(item => {
      const currentStock = findCurrentStock(item.data as Record<string, unknown>)
      return currentStock < (item.base_stock || 0)
    }) || []

    if (lowStockItems.length === 0) {
      return new Response(
        JSON.stringify({ message: '재고 부족 품목이 없습니다.', sent: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 3. 활성화된 Push Token 조회
    const { data: tokens, error: tokenError } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('is_active', true)

    if (tokenError) {
      throw new Error(`토큰 조회 실패: ${tokenError.message}`)
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ message: '등록된 푸시 토큰이 없습니다.', sent: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 4. 알림 메시지 생성
    const mostShortageItem = lowStockItems.reduce((prev, current) => {
      const prevStock = findCurrentStock(prev.data as Record<string, unknown>)
      const currentStock = findCurrentStock(current.data as Record<string, unknown>)
      const prevShortage = (prev.base_stock || 0) - prevStock
      const currentShortage = (current.base_stock || 0) - currentStock
      return currentShortage > prevShortage ? current : prev
    })

    const mostShortageItemName = findItemName(mostShortageItem.data as Record<string, unknown>)
    
    const title = '⚠️ 재고 부족 알림'
    const body = lowStockItems.length === 1
      ? `"${mostShortageItemName}" 품목의 재고가 부족합니다. 발주가 필요합니다!`
      : `${lowStockItems.length}개 품목의 재고가 부족합니다. 가장 부족한 품목: ${mostShortageItemName}`

    // 5. 모든 기기에 알림 발송
    const results = await Promise.all(
      tokens.map(async ({ token }) => {
        const result = await sendPushNotification(token, title, body)
        
        // 알림 로그 저장
        await supabase
          .from('notification_logs')
          .insert({
            push_token: token,
            title,
            body,
            success: result.success,
            error_message: result.error || null,
          })
        
        return result
      })
    )

    const successCount = results.filter(r => r.success).length

    return new Response(
      JSON.stringify({ 
        message: `알림 발송 완료`,
        total: tokens.length,
        success: successCount,
        lowStockCount: lowStockItems.length,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
