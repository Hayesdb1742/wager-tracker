// Service worker for admin push alerts.
//
// Deliberately minimal: it handles push and taps, and caches nothing. An offline shell would
// mean deciding when stale picks and stale lines are worse than no page at all, and for a
// league app that reads live data on every screen the answer is usually "worse". Push is
// what the home-screen install is for here.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Wager Tracker", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? "Wager Tracker", {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same tag replaces rather than stacks, so an unread alert is never buried by a newer
      // one -- the newer one simply takes its place.
      tag: data.tag ?? "wager-tracker",
      renotify: true,
      vibrate: [80, 40, 80],
      data: { url: data.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = event.notification.data?.url ?? "/";

  // Focus the app if it is already open rather than piling up tabs; only open a window when
  // nothing is running. On an installed PWA this is the difference between returning to the
  // app and launching a second copy of it.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if ("navigate" in client) client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
