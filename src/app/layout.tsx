import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbitex | Personal Command Dashboard",
  description: "A clean, futuristic personal planner dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
