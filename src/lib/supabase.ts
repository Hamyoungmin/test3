import { createClient } from '@supabase/supabase-js';

// Supabase 프로젝트 설정
// 나중에 실제 값으로 교체해주세요
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Supabase 클라이언트 생성
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 타입 정의 예시 (나중에 실제 테이블 구조에 맞게 수정)
export type Database = {
  public: {
    Tables: {
      // 예시: users 테이블
      // users: {
      //   Row: {
      //     id: string;
      //     email: string;
      //     created_at: string;
      //   };
      //   Insert: {
      //     id?: string;
      //     email: string;
      //     created_at?: string;
      //   };
      //   Update: {
      //     id?: string;
      //     email?: string;
      //     created_at?: string;
      //   };
      // };
    };
  };
};

