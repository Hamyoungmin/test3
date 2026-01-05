import { NextResponse } from 'next/server';

/**
 * 알림 전송 API
 * 
 * 이 API는 이메일 및 카카오톡 알림을 전송하기 위한 초안입니다.
 * 실제 구현 시 아래의 서비스들을 연동해야 합니다:
 * 
 * 1. 이메일 전송:
 *    - Nodemailer (SMTP)
 *    - SendGrid
 *    - AWS SES
 *    - Resend
 * 
 * 2. 카카오톡 알림:
 *    - 카카오톡 비즈니스 API (카카오 비즈니스 계정 필요)
 *    - 카카오 알림톡 (사업자 등록 필요)
 */

interface NotificationRequest {
  type: 'email' | 'kakao' | 'both';
  recipient: string; // 이메일 주소 또는 전화번호
  alertInfo: {
    fileName: string;
    columnName: string;
    conditionType: 'below' | 'above' | 'equals';
    thresholdValue: number;
    triggeredValue: number;
    triggeredCount: number;
  };
}

// 이메일 전송 함수 (초안)
async function sendEmail(
  to: string, 
  subject: string, 
  body: string
): Promise<{ success: boolean; error?: string }> {
  /**
   * 실제 구현 예시 (Nodemailer):
   * 
   * import nodemailer from 'nodemailer';
   * 
   * const transporter = nodemailer.createTransporter({
   *   host: process.env.SMTP_HOST,
   *   port: parseInt(process.env.SMTP_PORT || '587'),
   *   secure: false,
   *   auth: {
   *     user: process.env.SMTP_USER,
   *     pass: process.env.SMTP_PASS,
   *   },
   * });
   * 
   * await transporter.sendMail({
   *   from: process.env.SMTP_FROM,
   *   to,
   *   subject,
   *   html: body,
   * });
   */
  
  // 개발용 로그
  console.log('📧 이메일 전송 시뮬레이션:', { to, subject, body: body.substring(0, 100) + '...' });
  
  // 실제 구현 전 시뮬레이션
  return { success: true };
}

// 카카오톡 알림 전송 함수 (초안)
async function sendKakaoNotification(
  phoneNumber: string, 
  message: string
): Promise<{ success: boolean; error?: string }> {
  /**
   * 카카오톡 비즈니스 알림톡 API 구현 예시:
   * 
   * 1. 카카오 비즈니스 계정 생성 및 채널 개설
   * 2. 알림톡 템플릿 등록 및 승인
   * 3. API 키 발급
   * 
   * const response = await fetch('https://kapi.kakao.com/v1/api/talk/memo/default/send', {
   *   method: 'POST',
   *   headers: {
   *     'Authorization': `Bearer ${process.env.KAKAO_ACCESS_TOKEN}`,
   *     'Content-Type': 'application/x-www-form-urlencoded',
   *   },
   *   body: new URLSearchParams({
   *     template_object: JSON.stringify({
   *       object_type: 'text',
   *       text: message,
   *       link: {
   *         web_url: 'https://your-domain.com',
   *         mobile_web_url: 'https://your-domain.com',
   *       },
   *     }),
   *   }),
   * });
   */
  
  // 개발용 로그
  console.log('💬 카카오톡 알림 시뮬레이션:', { phoneNumber, message: message.substring(0, 100) + '...' });
  
  // 실제 구현 전 시뮬레이션
  return { success: true };
}

// POST: 알림 전송
export async function POST(request: Request) {
  try {
    const body: NotificationRequest = await request.json();
    
    const { type, recipient, alertInfo } = body;
    
    // 조건 텍스트 생성
    const conditionText = {
      below: '미만',
      above: '초과',
      equals: '동일',
    }[alertInfo.conditionType];
    
    // 메시지 생성
    const subject = `[재고 알림] ${alertInfo.fileName} - ${alertInfo.columnName} 조건 충족`;
    
    const messageBody = `
      <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🔔 재고 알림</h1>
        </div>
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px;">
          <h2 style="color: #333; margin-top: 0;">조건이 충족되었습니다</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #eee; color: #666;">파일명</td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold;">${alertInfo.fileName}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #eee; color: #666;">컬럼</td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold;">${alertInfo.columnName}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #eee; color: #666;">조건</td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold;">${alertInfo.thresholdValue} ${conditionText}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #eee; color: #666;">현재 값</td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #dc3545;">${alertInfo.triggeredValue}</td>
            </tr>
            <tr>
              <td style="padding: 12px; color: #666;">해당 행 수</td>
              <td style="padding: 12px; font-weight: bold; color: #dc3545;">${alertInfo.triggeredCount}개</td>
            </tr>
          </table>
          
          <p style="color: #666; font-size: 14px; margin-bottom: 0;">
            이 알림은 자동으로 발송되었습니다.<br>
            설정 변경은 재고 관리 시스템에서 가능합니다.
          </p>
        </div>
      </div>
    `;
    
    const kakaoMessage = `[재고 알림] 
📁 파일: ${alertInfo.fileName}
📊 컬럼: ${alertInfo.columnName}
⚠️ 조건: ${alertInfo.thresholdValue} ${conditionText}
📍 현재값: ${alertInfo.triggeredValue}
🔢 해당 ${alertInfo.triggeredCount}건

※ 상세 내용은 관리 시스템에서 확인하세요.`;

    const results: { email?: boolean; kakao?: boolean } = {};
    
    if (type === 'email' || type === 'both') {
      const emailResult = await sendEmail(recipient, subject, messageBody);
      results.email = emailResult.success;
    }
    
    if (type === 'kakao' || type === 'both') {
      const kakaoResult = await sendKakaoNotification(recipient, kakaoMessage);
      results.kakao = kakaoResult.success;
    }
    
    return NextResponse.json({
      success: true,
      results,
      message: '알림이 전송되었습니다 (시뮬레이션)',
    });
  } catch (error) {
    console.error('Send notification error:', error);
    return NextResponse.json(
      { success: false, error: '알림 전송에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// GET: 알림 히스토리 조회
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get('alert_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Supabase 클라이언트 생성
    const { createServerSupabaseClient } = await import('@/lib/supabase');
    const supabase = createServerSupabaseClient();
    
    let query = supabase
      .from('alert_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (alertId) {
      query = query.eq('alert_id', parseInt(alertId));
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Get notification history error:', error);
    return NextResponse.json(
      { success: false, error: '알림 히스토리를 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}

