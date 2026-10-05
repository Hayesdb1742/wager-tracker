import webpush from "web-push";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatLine, formatWager } from "@/lib/wagers";

type AdminClient = ReturnType<typeof createAdminClient>;

// Web Push for admin alerts. No third-party service: the browser vendor's push endpoint is
// the only hop, and VAPID is how we prove the message came from this app.
//
// The keys live in the environment, never in the database. The public one ships to the
// browser (NEXT_PUBLIC_), the private one signs and must not.

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

let configured = false;

/**
 * Hand web-push the VAPID details, once per process.
 *
 * The `mailto:` is required by the spec -- it is the contact a push service uses if this
 * app starts misbehaving, so it wants to be a real address.
 */
function ensureVapid(): void {
  if (configured) return;
  if (!pushConfigured()) throw new Error("VAPID keys are not configured");

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hayesdbentley1@live.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Where the notification takes you when tapped. */
  url: string;
  /** Collapses same-tag notifications, so a re-send replaces rather than stacks. */
  tag?: string;
};

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushResult = { sent: number; removed: number; failed: number };

/**
 * Send one payload to every stored subscription.
 *
 * A push service answers 404 or 410 when the browser has thrown the subscription away --
 * uninstalled, cleared, permission revoked. That is not an error to retry, it is a row to
 * delete, and doing so here is the only thing that keeps the table from filling with dead
 * endpoints nobody will ever prune by hand.
 */
export async function sendToAll(
  admin: AdminClient,
  payload: PushPayload
): Promise<PushResult> {
  ensureVapid();

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");

  if (error) throw new Error(`reading subscriptions: ${error.message}`);
  if (!subs?.length) return { sent: 0, removed: 0, failed: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;
  let failed = 0;

  // Two admins with a couple of devices each -- a handful of requests, so in parallel and
  // settled rather than raced: one dead endpoint must not stop the other phone ringing.
  const results = await Promise.allSettled(
    (subs as SubscriptionRow[]).map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      )
    )
  );

  await Promise.all(
    results.map(async (result, i) => {
      const sub = (subs as SubscriptionRow[])[i];

      if (result.status === "fulfilled") {
        sent++;
        await admin
          .from("push_subscriptions")
          .update({ last_sent_at: new Date().toISOString(), last_error: null })
          .eq("endpoint", sub.endpoint);
        return;
      }

      const status = (result.reason as { statusCode?: number })?.statusCode;
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);

      if (status === 404 || status === 410) {
        dead.push(sub.endpoint);
        return;
      }

      failed++;
      await admin
        .from("push_subscriptions")
        .update({ last_error: message.slice(0, 500) })
        .eq("endpoint", sub.endpoint);
    })
  );

  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", dead);
  }

  return { sent, removed: dead.length, failed };
}

// ---------------------------------------------------------------- flag messages

/** The shape the notify route reads out of pick_line_flags_detail. */
export type FlagNotice = {
  member: string | null;
  week_number: number | null;
  matchup: string | null;
  bet_type: string | null;
  selection: string | null;
  pick_line: number | null;
  market_best_line: number | null;
  market_worst_line: number | null;
  deviation: number | null;
  verdict: string | null;
};

/** "+9.5 to +10.5", or just "+9.5" when both books sat on the same number. */
function marketRange(flag: FlagNotice): string {
  const best = flag.market_best_line;
  const worst = flag.market_worst_line;
  if (best === null || worst === null) return "no posted line";
  if (best === worst) return formatLine(Number(best));
  // Low number first, so it reads as a range rather than as best-to-worst.
  const [lo, hi] = [Number(worst), Number(best)].sort((a, b) => a - b);
  return `${formatLine(lo)} to ${formatLine(hi)}`;
}

/**
 * The wager in the member's own words -- "Colorado +8.5", "Over 52.5".
 *
 * `formatWager` needs a matchup to name the side, and the view hands us the matchup already
 * rendered as "Away at Home". Splitting it back apart is a little inelegant, but the
 * alternative is a second query per flag purely to re-fetch two team names we already have.
 */
function wagerText(flag: FlagNotice): string {
  const parts = (flag.matchup ?? "").split(" at ");
  const game = { away_team: parts[0] ?? "Away", home_team: parts[1] ?? "Home" };
  return formatWager(
    {
      bet_type: flag.bet_type ?? "SPREAD",
      selection: flag.selection ?? "HOME",
      line: Number(flag.pick_line ?? 0),
    },
    game
  );
}

/**
 * Turn one or more flags into a notification.
 *
 * One flag gets the detail -- what they wrote, what the books had, how far off. A batch
 * (a re-sweep at a new tolerance) gets a count and the names, because a lock screen is not
 * the place to read twenty lines and the page is one tap away.
 */
export function flagNotification(flags: FlagNotice[], baseUrl: string): PushPayload {
  const url = `${baseUrl.replace(/\/$/, "")}/line-flags`;

  if (flags.length === 1) {
    const flag = flags[0];
    const dev = Number(flag.deviation ?? 0);
    const direction = flag.verdict === "BETTER_THAN_MARKET" ? "better than" : "worse than";
    const week = flag.week_number === null ? "" : `week ${flag.week_number}`;

    return {
      title: `Line flag — ${flag.member ?? "someone"}${week ? `, ${week}` : ""}`,
      body:
        `${wagerText(flag)} · books had ${marketRange(flag)}\n` +
        `${Math.abs(dev)} pts ${direction} market · ${flag.matchup ?? ""}`,
      url,
      // One tag per pick would stack; one tag for the feature means a newer alert replaces
      // an unread older one rather than burying it.
      tag: "line-flag",
    };
  }

  const members = [...new Set(flags.map((f) => f.member).filter(Boolean))];
  const who =
    members.length <= 3
      ? members.join(", ")
      : `${members.slice(0, 3).join(", ")} +${members.length - 3} more`;

  return {
    title: `${flags.length} line flags raised`,
    body: who ? `${who} — tap to review` : "Tap to review",
    url,
    tag: "line-flag",
  };
}
