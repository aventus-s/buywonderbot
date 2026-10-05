import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "buywonderbot — live deal radar",
  description: "Buywander auctions scored against eBay sold prices. 50%+ margin, $100+ profit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
