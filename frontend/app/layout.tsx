import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { DebugBackendUrl } from "@/components/DebugBackendUrl";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "The Commercial Real Estate Model",
    template: "%s | TheCREmodel",
  },
  description:
    "Tenant office lease financial analysis: scenario comparison, PDF reports, and AI lease extraction.",
  applicationName: "The Commercial Real Estate Model",
  metadataBase: new URL("https://thecremodel.com"),
  alternates: { canonical: "https://thecremodel.com" },
  openGraph: {
    siteName: "TheCREmodel",
    title: "The Commercial Real Estate Model",
    description:
      "Tenant office lease financial analysis: scenario comparison, PDF reports, and AI lease extraction.",
    url: "https://thecremodel.com",
    type: "website",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "TheCREmodel" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Commercial Real Estate Model",
    description:
      "Tenant office lease financial analysis: scenario comparison, PDF reports, and AI lease extraction.",
    images: ["/brand/og.png"],
  },
  icons: {
    icon: "/brand/favicon.svg",
    shortcut: "/brand/favicon.svg",
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="font-sans antialiased min-h-screen bg-[#0a0a0b] text-white premium-noise bg-grid">
        <TopNav />
        {children}
        <DebugBackendUrl />
      </body>
    </html>
  );
}
