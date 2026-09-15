// Populate the teams dimension with conferences, so analytics can roll picks
// up by league. Idempotent: re-run each season after realignment.
//
// CFB comes from cfbd /teams/fbs (needs CFBD_API_KEY). NFL comes from ESPN's
// groups tree (no key). Both are matched to games by exact name, which is the
// same string each provider writes on its game rows.
//
// Run: npx tsx scripts/seed-teams.ts [year]

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { fetchCfbdTeams, fetchEspnNflTeams } from "../src/lib/sports/providers";

function loadEnv() {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnv();
  const year = Number(process.argv[2] ?? new Date().getFullYear());
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [cfb, nfl] = await Promise.all([fetchCfbdTeams(year), fetchEspnNflTeams()]);
  console.log(`Fetched ${cfb.length} FBS teams (${year}) and ${nfl.length} NFL teams`);

  const { error } = await admin.from("teams").upsert(
    [...cfb, ...nfl].map((t) => ({
      sport: t.sport,
      name: t.name,
      abbreviation: t.abbreviation,
      external_id: t.external_id,
      conference: t.conference,
      division: t.division,
    })),
    { onConflict: "sport,name" }
  );
  if (error) throw new Error(`teams upsert: ${error.message}`);

  // Names that appear on games but not in the dimension will fall into the
  // "Other" bucket on the analytics page -- list them so they can be checked.
  const { data: games } = await admin.from("games").select("sport, home_team, away_team");
  const known = new Set([...cfb, ...nfl].map((t) => `${t.sport}:${t.name}`));
  const missing = new Set<string>();
  for (const g of games ?? []) {
    for (const name of [g.home_team, g.away_team]) {
      if (!known.has(`${g.sport}:${name}`)) missing.add(`${g.sport}:${name}`);
    }
  }
  console.log(`Upserted ${cfb.length + nfl.length} teams.`);
  if (missing.size > 0) {
    console.log(`${missing.size} game team names have no conference (FCS opponents, old seed data):`);
    for (const m of Array.from(missing).sort()) console.log(`  ${m}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
