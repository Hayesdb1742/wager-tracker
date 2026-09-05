import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// The one season flagged is_active (enforced by a partial unique index). Week
// lookups scope to it so a stale season's OPEN week — the preseason, an old
// dev season — can't outrank the live one just by having a higher week_number.
export async function getActiveSeasonId(admin: AdminClient): Promise<number | null> {
  const { data } = await admin
    .from("seasons")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  return data?.id ?? null;
}
