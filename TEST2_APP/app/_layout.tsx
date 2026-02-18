import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import Constants from 'expo-constants';
import 'react-native-reanimated';

import { AppThemeProvider, useAppTheme } from '@/contexts/AppThemeContext';
import { 
  registerForPushNotificationsAsync, 
  savePushTokenToSupabase 
} from '../lib/notifications';

// Expo Go 환경인지 확인
const isExpoGo = Constants.appOwnership === 'expo';

// Expo Go에서 발생하는 푸시 알림 관련 경고 무시
if (isExpoGo) {
  LogBox.ignoreLogs([
    'expo-notifications',
    'Push Token',
    'projectId',
  ]);
}

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutContent() {
  const { resolvedTheme } = useAppTheme();

  useEffect(() => {
    // Expo Go에서는 푸시 알림 관련 기능 완전히 스킵
    if (isExpoGo) {
      console.log('Expo Go 환경: 원격 푸시 알림 기능이 비활성화됩니다. (로컬 알림은 작동)');
      return;
    }

    // 푸시 알림 등록 및 토큰 저장 (Development Build에서만)
    registerForPushNotificationsAsync()
      .then(token => {
        if (token) {
          savePushTokenToSupabase(token);
        }
      })
      .catch(error => {
        console.log('푸시 알림 등록 스킵됨:', error);
      });
  }, []);

  return (
    <ThemeProvider value={resolvedTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootLayoutContent />
    </AppThemeProvider>
  );
}
