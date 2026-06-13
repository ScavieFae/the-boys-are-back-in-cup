import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "The Boys Are Back In Cup",
  description: "World Cup 2026 draft pool — who drafted whom, live.",
};

const NAV = [
  { href: "/", label: "Now Playing" },
  { href: "/head-to-head", label: "Head to Head" },
  { href: "/stats", label: "Stats" },
  { href: "/managers", label: "Managers" },
  { href: "/teams", label: "Teams" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <header className="border-b border-white/10 sticky top-0 z-10 bg-[var(--background)]/80 backdrop-blur">
          <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-bold tracking-tight text-lg">
              ⚽ The Boys Are Back In Cup
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="px-3 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/5 transition"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-10 text-xs text-zinc-600">
          World Cup 2026 · $10 a man · scores via ESPN, corrected by hand when they lie.
        </footer>
      </body>
    </html>
  );
}
