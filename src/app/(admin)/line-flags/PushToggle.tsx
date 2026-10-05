"use client";

import { useCallback, useEffect, useState } from "react";

// The opt-in for admin push alerts, and the iPhone install instructions that have to come
// first. Notification permission can only be requested from a user gesture, so this is a
// button and not something the page does on load.

/** The VAPID public key ships base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type State = "loading" | "unsupported" | "needs-install" | "off" | "on";
type Env = { state: State; isIOS: boolean };

/**
 * What this browser can do, and whether it is already subscribed.
 *
 * Async all the way down on purpose: every answer here needs `navigator`, so none of it can
 * be computed during render, and resolving it in one promise keeps the effect below free of
 * the synchronous setState that turns into cascading renders.
 */
async function detectEnv(): Promise<Env> {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag, which predates display-mode and is still what iOS sets.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  // On iOS an uninstalled site looks unsupported: Safari hides PushManager until the app is
  // on the home screen, so "unsupported" there really means "not yet".
  if (isIOS && !standalone) return { state: "needs-install", isIOS };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { state: "unsupported", isIOS };
  }

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  const sub = await registration.pushManager.getSubscription();
  return { state: sub ? "on" : "off", isIOS };
}

export function PushToggle() {
  const [{ state, isIOS }, setEnv] = useState<Env>({ state: "loading", isIOS: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    detectEnv()
      .then((env) => {
        if (!cancelled) setEnv(env);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Service worker failed to register");
        setEnv({ state: "unsupported", isIOS: false });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setState = (next: State) => setEnv((env) => ({ ...env, state: next }));

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          permission === "denied"
            ? "Notifications are blocked for this site. Turn them back on in your browser settings."
            : "Notification permission was dismissed."
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set on this deployment.");
        return;
      }

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });

      const res = await fetch("/api/admin/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      if (!res.ok) {
        // Don't leave a live browser subscription pointing at a server that never stored it.
        await sub.unsubscribe();
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save the subscription.");
        return;
      }

      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/admin/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Alerts on this device</h2>
          <p className="mt-1 text-sm text-slate-400">
            {state === "on"
              ? "This device will buzz when a line flag is raised."
              : "Get a notification the moment someone's line falls outside the market."}
          </p>
        </div>

        {state === "on" && (
          <button
            onClick={disable}
            disabled={busy}
            className="shrink-0 rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "…" : "Turn off"}
          </button>
        )}
        {state === "off" && (
          <button
            onClick={enable}
            disabled={busy}
            className="shrink-0 rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {busy ? "…" : "Turn on"}
          </button>
        )}
      </div>

      {state === "needs-install" && (
        <p className="mt-3 rounded-md bg-slate-950 p-3 text-sm text-slate-300">
          {isIOS ? (
            <>
              iPhone only allows notifications from an installed app. Tap{" "}
              <span aria-label="the share button">Share</span> at the bottom of Safari, choose{" "}
              <strong className="text-slate-100">Add to Home Screen</strong>, then open Wagers
              from your home screen and come back here.
            </>
          ) : (
            <>Install this app to your home screen, then come back here to turn alerts on.</>
          )}
        </p>
      )}

      {state === "unsupported" && (
        <p className="mt-3 text-sm text-slate-400">
          This browser can&apos;t do push notifications.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
    </div>
  );
}
