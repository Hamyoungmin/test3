/**
 * 다크 모드: 세련된 다크 그레이 톤 (답답하지 않게)
 * 라이트 모드: 기존 스타일 유지
 */

export const AppColors = {
  light: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#F9FAFB',
    surfaceCard: '#FFFFFF',
    border: '#E5E7EB',
    borderLight: '#F3F4F6',
    text: '#111111',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    headerBg: '#F8F9FA',
    searchBg: '#F3F4F6',
    green: '#166534',
    greenLight: '#F0FDF4',
    greenBorder: '#BBF7D0',
    red: '#DC2626',
    redLight: '#FEF2F2',
    redBorder: '#FECACA',
    amberLight: '#FFFBEB',
    amberBorder: '#FDE68A',
    reportShareBg: '#2563EB',       // blue-600, 신뢰감
    reportShareText: '#FFFFFF',
    reportShareBorder: '#1D4ED8',  // blue-700
    reportShareShadow: '#1D4ED840', // 그림자
    errorMsgBg: '#FEF2F2',
    errorMsgText: '#B91C1C',
    successMsgBg: '#F0FDF4',
    successMsgText: '#166534',
    activityLogCard: '#F3F4F6',
  },
  dark: {
    background: '#0F172A',
    surface: '#1E293B',
    surfaceAlt: '#334155',
    surfaceCard: '#1E293B',
    border: '#475569',         // slate-600
    borderLight: '#64748B',    // slate-500
    text: '#F8FAFC',           // slate-50
    textSecondary: '#94A3B8',  // slate-400
    textMuted: '#64748B',     // slate-500
    headerBg: '#0F172A',
    searchBg: '#334155',
    green: '#4ADE80',          // green-400
    greenLight: '#14532D',     // green-900
    greenBorder: '#166534',
    red: '#F87171',            // red-400
    redLight: '#7F1D1D',       // red-900
    redBorder: '#991B1B',
    amberLight: '#78350F',
    amberBorder: '#92400E',
    reportShareBg: '#38BDF8',       // sky-400, 네온 블루
    reportShareText: '#0F172A',     // slate-900, 시인성
    reportShareBorder: '#0EA5E9',  // sky-500
    reportShareShadow: '#38BDF840', // 그림자
    errorMsgBg: '#7F1D1D',
    errorMsgText: '#FEE2E2',
    successMsgBg: '#14532D',
    successMsgText: '#DCFCE7',
    activityLogCard: '#334155',
  },
} as const;

export type ColorScheme = keyof typeof AppColors;
