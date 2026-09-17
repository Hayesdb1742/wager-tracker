import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a member has already spent on locks: the week's one LOTW and the season's one
 * LOTY. Both /api/picks (lock chosen at submit) and /api/picks/lock (raised afterwards)
 * feed this into lockUpgradeError, so a lock is refused for the same reasons on either path.
 *
 * A LOTY reaches its season through weeks, so that lookup needs the join -- !inner keeps
 * it a filter rather than a left join. `excludePickId` leaves the pick being raised out
 * of both counts.
 */
export async function memberLockContext(
  admin: SupabaseClient,
  args: { memberId: string; weekId: number; seasonId: number; excludePickId?: string }
): Promise<{ weekLockOnAnotherPick: boolean; lotyUsedThisSeason: boolean }> {
  let weekLocks = admin
    .from("picks")
    .select("id")
    .eq("member_id", args.memberId)
    .eq("week_id", args.weekId)
    .eq("is_lotw", true);
  if (args.excludePickId) weekLocks = weekLocks.neq("id", args.excludePickId);

  let seasonLoty = admin
    .from("picks")
    .select("id, weeks!inner(season_id)")
    .eq("member_id", args.memberId)
    .eq("is_loty", true)
    .eq("weeks.season_id", args.seasonId);
  if (args.excludePickId) seasonLoty = seasonLoty.neq("id", args.excludePickId);

  const [{ data: weekRows }, { data: lotyRows }] = await Promise.all([weekLocks, seasonLoty]);

  return {
    weekLockOnAnotherPick: (weekRows ?? []).length > 0,
    lotyUsedThisSeason: (lotyRows ?? []).length > 0,
  };
}
