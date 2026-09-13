import type { Metadata } from "next";

// The console page itself is a client component and so cannot export
// metadata; a segment layout is the supported place to put it.
//
// `robots: noindex` is not belt-and-braces on top of robots.txt — it is
// the part that actually binds. robots.txt asks a crawler not to fetch;
// this tells one that already has the URL not to index it. Console URLs
// name real parcels, alerts and cases.
export const metadata: Metadata = {
  title: "Command map",
  description:
    "Operational map of government land under monitoring, with alerts by severity and the parcels they sit on.",
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
