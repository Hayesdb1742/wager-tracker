import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Service-role client — only use in server-side code (API routes, Server Actions)
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
