"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/weeks", label: "Weeks" },
  { href: "/pick-grid", label: "Pick Grid" },
  { href: "/results", label: "Results" },
  { href: "/members", label: "Members" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="bg-slate-900 border-b border-slate-700 shadow-lg shadow-black/40">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="pr-3 py-3 text-sm font-semibold tracking-wide text-sky-300">Admin</span>
          {LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "text-white bg-slate-800"
                    : "text-slate-200 hover:text-white hover:bg-slate-800"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <Link href="/picks" className="px-3 py-3 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800">
          ← Back to app
        </Link>
      </div>
    </nav>
  );
}
