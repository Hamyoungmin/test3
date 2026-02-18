'use client';

import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
      className="fixed top-4 right-6 z-[60] flex items-center justify-center w-11 h-11 rounded-xl bg-white dark:bg-slate-700/80 border border-gray-200 dark:border-slate-600 shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
    >
      {theme === 'light' ? (
        <Sun className="w-5 h-5 text-amber-500" />
      ) : (
        <Moon className="w-5 h-5 text-sky-300" />
      )}
    </button>
  );
}
