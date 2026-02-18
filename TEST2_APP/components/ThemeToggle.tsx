'use client';

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { AppColors } from '@/constants/theme-colors';

/**
 * 손가락으로 누르기 편한 크기의 테마 토글 (최소 44pt 터치 영역)
 */
export function ThemeToggle() {
  const { isDark, toggleTheme } = useAppTheme();
  const colors = AppColors[isDark ? 'dark' : 'light'];

  return (
    <TouchableOpacity
      onPress={toggleTheme}
      activeOpacity={0.7}
      style={[styles.wrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View style={styles.iconContainer}>
        {isDark ? (
          <Ionicons name="moon-outline" size={22} color="#94A3B8" />
        ) : (
          <Ionicons name="sunny-outline" size={22} color="#F59E0B" />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
