import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server routes writing session/transcript/draft data
// on behalf of an unauthenticated patient intake session (no user cookies to
// scope RLS against). Never import this from client components.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
