import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { BackendBanner } from "@/components/BackendBanner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Lease Deck",
  description: "Tenant office lease financial analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="font-sans antialiased min-h-screen bg-[#0a0a0b] text-white premium-noise">
        <BackendBanner />
        {children}
      </body>
    </html>
  );
}