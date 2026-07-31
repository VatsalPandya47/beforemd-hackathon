import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Components can't set cookies (middleware refreshes the session
// instead), so the setAll call is wrapped and safe to ignore there.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; ignore.
          }
        },
      },
    }
  );
}
