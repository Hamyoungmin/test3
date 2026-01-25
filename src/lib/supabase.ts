import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 하드코딩된 Supabase 설정 (환경 변수 로드 문제 우회)
const SUPABASE_URL = 'https://gfntfpemgcpoavbudlxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbnRmcGVtZ2Nwb2F2YnVkbHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNDE4MTIsImV4cCI6MjA4MTcxNzgxMn0.zyxI88dhSS-Knjq6N2xm59MVcDErXtjJhXHqAn1NS68';

// 단순화된 Supabase 클라이언트 - 함수 호출 시마다 새로 생성
export function createSupabaseClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

// 기본 클라이언트 인스턴스 (직접 export)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// 하위 호환성을 위한 getSupabase 함수
export function getSupabase(): SupabaseClient {
  return supabase;
}

// 서버 전용 클라이언트 (Service Role Key 사용 - API Routes에서만 사용)
export function createServerSupabaseClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbnRmcGVtZ2Nwb2F2YnVkbHh4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjE0MTgxMiwiZXhwIjoyMDgxNzE3ODEyfQ.4VqOjEdNToXPCA169g9JLvWcXvOEcheJrmT1Si38Bto';
  
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// 타입 정의 (Supabase에서 자동 생성 가능)
export type Database = {
  public: {
    Tables: {
      // files 테이블
      files: {
        Row: {
          id: string;
          name: string;
          size: number;
          user_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          size: number;
          user_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          size?: number;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      // 재고 테이블 - DB 컬럼명: id, file_name, row_index, data, base_stock, alarm_status
      재고: {
        Row: {
          id: number;
          file_name: string;
          row_index: number;
          data: Record<string, unknown>;
          base_stock: number | null;  // 기준 재고 (최종 확정 시점의 재고)
          alarm_status: boolean;
          created_at?: string;
        };
        Insert: {
          id?: number;
          file_name: string;
          row_index: number;
          data: Record<string, unknown>;
          base_stock?: number | null;
          alarm_status?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          file_name?: string;
          row_index?: number;
          data?: Record<string, unknown>;
          base_stock?: number | null;
          alarm_status?: boolean;
          created_at?: string;
        };
      };
    };
  };
};

// 재고 데이터 타입 (동적 컬럼 지원)
export type InventoryRow = Record<string, string | number | boolean | null>;

export type Tables<T extends keyof Database['public']['Tables']> = 
  Database['public']['Tables'][T]['Row'];

export type InsertTables<T extends keyof Database['public']['Tables']> = 
  Database['public']['Tables'][T]['Insert'];

export type UpdateTables<T extends keyof Database['public']['Tables']> = 
  Database['public']['Tables'][T]['Update'];
