import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Expo Go 환경인지 확인 (SDK 53 이후 원격 푸시 알림 미지원)
const isExpoGo = Constants.appOwnership === 'expo';

// 알림 핸들러 설정 - 앱이 foreground에 있을 때 알림 표시 방법
// (로컬 알림은 Expo Go에서도 작동)
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (error) {
  console.log('알림 핸들러 설정 스킵');
}

// Expo Push Token 얻기
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Expo Go에서는 SDK 53 이후 원격 푸시 알림 미지원
  if (isExpoGo) {
    console.log('Expo Go에서는 원격 푸시 알림이 지원되지 않습니다. (로컬 알림은 작동합니다)');
    return null;
  }

  let token: string | null = null;

  // 실제 기기에서만 푸시 알림 동작
  if (!Device.isDevice) {
    console.log('푸시 알림은 실제 기기에서만 동작합니다.');
    return null;
  }

  // Android 채널 설정
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('inventory-alerts', {
        name: '재고 알림',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
      });
    } catch (error) {
      console.log('Android 채널 설정 스킵:', error);
    }
  }

  // 권한 확인 및 요청
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('푸시 알림 권한이 거부되었습니다.');
      return null;
    }
  } catch (error) {
    console.log('알림 권한 확인 스킵:', error);
    return null;
  }

  // Expo Push Token 얻기
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId 
      ?? Constants.easConfig?.projectId;
    
    if (!projectId) {
      console.log('projectId가 없습니다. Development build에서만 푸시 토큰을 얻을 수 있습니다.');
      return null;
    }
    
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenData.data;
    
    console.log('Expo Push Token:', token);
  } catch (error) {
    console.log('Push Token 얻기 스킵 (Expo Go에서는 지원되지 않음)');
  }

  return token;
}

// Supabase에 Push Token 저장
export async function savePushTokenToSupabase(token: string): Promise<boolean> {
  try {
    // 기존 토큰 확인
    const { data: existingTokens } = await supabase
      .from('push_tokens')
      .select('id')
      .eq('token', token);

    // 이미 존재하면 업데이트
    if (existingTokens && existingTokens.length > 0) {
      const { error } = await supabase
        .from('push_tokens')
        .update({ 
          updated_at: new Date().toISOString(),
          is_active: true 
        })
        .eq('token', token);

      if (error) throw error;
    } else {
      // 새로운 토큰 삽입
      const { error } = await supabase
        .from('push_tokens')
        .insert({
          token,
          platform: Platform.OS,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
    }

    console.log('Push Token이 Supabase에 저장되었습니다.');
    return true;
  } catch (error) {
    console.error('Push Token 저장 실패:', error);
    return false;
  }
}

// 로컬 알림 발송 (테스트용)
export async function sendLocalNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: null, // 즉시 발송
  });
}

// 재고 부족 알림 발송 (앱 내에서 직접 발송 - 테스트용)
export async function checkAndNotifyLowStock() {
  try {
    const { data: lowStockItems, error } = await supabase
      .from('재고')
      .select('*')
      .not('base_stock', 'is', null);

    if (error) throw error;

    const alertItems = lowStockItems?.filter(item => {
      const data = item.data as Record<string, unknown>;
      const currentStock = Number(
        Object.entries(data).find(([key]) => 
          key.toLowerCase().includes('재고') || 
          key.toLowerCase().includes('수량') ||
          key.toLowerCase().includes('stock')
        )?.[1] || 0
      );
      return currentStock < (item.base_stock || 0);
    });

    if (alertItems && alertItems.length > 0) {
      await sendLocalNotification(
        '⚠️ 재고 부족 알림',
        `${alertItems.length}개 품목의 재고가 부족합니다. 앱에서 확인해주세요!`
      );
    }
  } catch (error) {
    console.error('재고 확인 실패:', error);
  }
}
