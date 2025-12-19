import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 환경 변수 가져오기 (런타임에 평가)
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    console.warn('NEXT_PUBLIC_SUPABASE_URL 환경 변수가 설정되지 않았습니다.');
    return '';
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    console.warn('NEXT_PUBLIC_SUPABASE_ANON_KEY 환경 변수가 설정되지 않았습니다.');
    return '';
  }
  return key;
}

// Supabase 클라이언트 인스턴스 (지연 초기화)
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = getSupabaseUrl();
    const key = getSupabaseAnonKey();
    
    if (!url || !key) {
      throw new Error('Supabase 환경 변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.');
    }
    
    _supabase = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _supabase;
}

// 하위 호환성을 위한 export (기존 코드에서 supabase로 접근하는 경우)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return Reflect.get(getSupabase(), prop);
  },
});

// 서버 전용 클라이언트 (Service Role Key 사용 - API Routes에서만 사용)
export function createServerSupabaseClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  }

  return createClient(url, serviceRoleKey, {
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
      // 재고 테이블
      재고: {
        Row: {
          id: number;
          [key: string]: string | number | boolean | null;
        };
        Insert: {
          id?: number;
          [key: string]: string | number | boolean | null | undefined;
        };
        Update: {
          id?: number;
          [key: string]: string | number | boolean | null | undefined;
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
