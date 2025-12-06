import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let configPromise: Promise<{ supabaseUrl: string; supabaseAnonKey: string }> | null = null;

async function fetchConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/auth/config')
      .then(res => res.json())
      .catch(() => ({ supabaseUrl: '', supabaseAnonKey: '' }));
  }
  return configPromise;
}

export async function getSupabase(): Promise<SupabaseClient> {
  if (supabaseInstance) {
    return supabaseInstance;
  }
  
  const config = await fetchConfig();
  
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.warn('Supabase credentials not configured. Authentication will not work.');
  }
  
  supabaseInstance = createClient(
    config.supabaseUrl || 'https://placeholder.supabase.co',
    config.supabaseAnonKey || 'placeholder'
  );
  
  return supabaseInstance;
}

export { supabaseInstance as supabase };
