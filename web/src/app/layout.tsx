import type { Metadata, Viewport } from "next";
import "./globals.css";

// `viewportFit: "cover"` lets the page draw under the notch/home indicator
// on iPhone (and in home-screen/standalone mode) instead of leaving black
// bars. It also makes the `env(safe-area-inset-*)` values non-zero, which
// the app chrome and map console rely on to keep controls clear of the
// notch and home indicator — without this, those env() values are all 0
// and the safe-area padding below is a no-op.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
