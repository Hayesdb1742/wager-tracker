import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Auth for admin routes that pg_cron also calls: an admin session, or
// `Authorization: Bearer ${CRON_SECRET}` so pg_net can call without a user.
export async function isAdminOrCron(request: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.app_metadata?.role === "ADMIN";
}
