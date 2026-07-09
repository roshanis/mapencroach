import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mapencroach | Encroachment Monitoring Console",
  description:
    "Government console for monitoring land parcel encroachment alerts and due-process cases.",
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
