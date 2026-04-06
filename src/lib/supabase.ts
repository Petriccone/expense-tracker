import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xitpldfoxnhidxvehxao.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpdHBsZGZveG5oaWR4dmVoeGFvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM0Njc3NSwiZXhwIjoyMDkwOTIyNzc1fQ.WDhnFjVRONwN1I9bSwZ-uxgOF3e4M8cD76Qtxdj1AI8';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
