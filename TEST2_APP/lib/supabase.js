import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gfntfpemgcpoavbudlxx.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbnRmcGVtZ2Nwb2F2YnVkbHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNDE4MTIsImV4cCI6MjA4MTcxNzgxMn0.zyxI88dhSS-Knjq6N2xm59MVcDErXtjJhXHqAn1NS68';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
