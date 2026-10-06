import type { MetadataRoute } from "next";

// The web app manifest -- what turns wager-tracker into an icon on a home screen.
//
// It is also the hard requirement for push on iPhone: Safari only allows Web Push from a
// site that has been added to the home screen, and it will only offer that if a valid
// manifest is served. So this file is load-bearing for the alerts, not decoration.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wager Tracker",
    short_name: "Wagers",
    description: "Weekly picks, standings and results for the league.",
    start_url: "/picks",
    // No browser chrome: the point of installing is that it stops looking like a tab.
    display: "standalone",
    orientation: "portrait",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops a maskable icon to whatever shape the launcher uses; the mark sits
      // inside the middle 60% of the art so there is nothing to clip.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
