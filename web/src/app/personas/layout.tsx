import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Who sees what",
  description:
    "Demo personas showing how role and jurisdiction scope determine what each officer can see and do.",
  robots: { index: false, follow: false },
};

export default function PersonasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
