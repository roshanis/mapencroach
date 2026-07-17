import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "mapencroach | Public Land Intelligence",
    template: "%s | mapencroach",
  },
  description:
    "Public land intelligence for Indian state governments—from satellite change signals to verified, evidence-backed due process.",
  openGraph: {
    type: "website",
    title: "See land risk early. Move every case lawfully.",
    description:
      "Mapencroach connects satellite screening, cadastral truth, field verification, and due process in one operating system.",
    siteName: "mapencroach",
  },
  twitter: {
    card: "summary",
    title: "mapencroach | Public Land Intelligence",
    description:
      "From probable land change to verified, evidence-backed action.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
