import type { Metadata } from "next";
import { DM_Mono, Syne } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { BackgroundNumberRain } from "@/components/BackgroundNumberRain";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { DebugBackendUrl } from "@/components/DebugBackendUrl";
import { ClientWorkspaceProvider } from "@/components/workspace/ClientWorkspaceProvider";
import { BrokerOsProvider } from "@/components/workspace/BrokerOsProvider";
import { FeedbackBubble } from "@/components/FeedbackBubble";
import TrialBanner from "@/components/billing/TrialBanner";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-syne",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
});

export const metadata: Metadata = {
  title: {
    default: "The CRE Model | Commercial Real Estate CRM & Lease Analysis",
    template: "%s | The CRE Model",
  },
  description:
    "The CRE Model is a commercial real estate CRM and lease analysis workspace for brokers: document intake, proposals, surveys, lease abstracts, obligations, and client-ready financial analysis.",
  applicationName: "The Commercial Real Estate Model",
  metadataBase: new URL("https://thecremodel.com"),
  alternates: { canonical: "/" },
  keywords: [
    "the cre model",
    "thecremodel",
    "The Commercial Real Estate Model",
    "commercial real estate",
    "commercial real estate CRM",
    "CRE CRM",
    "lease analysis software",
    "commercial lease analysis",
    "tenant representation CRM",
    "landlord representation CRM",
    "lease abstract software",
    "market survey software",
    "commercial real estate broker software",
  ],
  authors: [{ name: "The CRE Model" }],
  creator: "The CRE Model",
  publisher: "The CRE Model",
  category: "Commercial Real Estate Software",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    siteName: "The CRE Model",
    title: "The CRE Model | Commercial Real Estate CRM & Lease Analysis",
    description:
      "Commercial real estate CRM, lease analysis, proposal intake, surveys, lease abstracts, obligations, and broker workflow automation in one connected workspace.",
    url: "https://thecremodel.com",
    type: "website",
    locale: "en_US",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "The CRE Model commercial real estate CRM and lease analysis platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The CRE Model | Commercial Real Estate CRM & Lease Analysis",
    description:
      "Commercial real estate CRM, lease analysis, proposal intake, surveys, lease abstracts, obligations, and broker workflow automation.",
    images: ["/brand/og.png"],
  },
  icons: {
    icon: "/brand/favicon.svg",
    shortcut: "/brand/favicon.svg",
    apple: "/brand/apple-touch-icon.png",
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://thecremodel.com/#organization",
      name: "The CRE Model",
      alternateName: [
        "theCREmodel",
        "The Commercial Real Estate Model",
        "The CRE Model",
      ],
      url: "https://thecremodel.com",
      logo: "https://thecremodel.com/brand/logo.png",
      contactPoint: {
        "@type": "ContactPoint",
        email: "info@thecremodel.com",
        contactType: "customer support",
        areaServed: "US",
        availableLanguage: "English",
      },
    },
    {
      "@type": "WebSite",
      "@id": "https://thecremodel.com/#website",
      name: "The CRE Model",
      alternateName: "theCREmodel",
      url: "https://thecremodel.com",
      publisher: {
        "@id": "https://thecremodel.com/#organization",
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://thecremodel.com/#software",
      name: "The CRE Model",
      alternateName: "theCREmodel",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://thecremodel.com",
      description:
        "Commercial real estate CRM and lease analysis workspace for brokers, with document intake, proposals, surveys, lease abstracts, obligations, and client-ready financial analysis.",
      publisher: {
        "@id": "https://thecremodel.com/#organization",
      },
      offers: [
        {
          "@type": "Offer",
          name: "Starter",
          price: "10",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", billingDuration: "P1M" },
          availability: "https://schema.org/InStock",
          url: "https://thecremodel.com/pricing",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: "20",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", billingDuration: "P1M" },
          availability: "https://schema.org/InStock",
          url: "https://thecremodel.com/pricing",
        },
        {
          "@type": "Offer",
          name: "Enterprise",
          price: "50",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", billingDuration: "P1M" },
          availability: "https://schema.org/InStock",
          url: "https://thecremodel.com/pricing",
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${dmMono.variable}`}>
      <body className="min-h-screen antialiased premium-noise bg-grid">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <BackgroundNumberRain />
        <ClientWorkspaceProvider>
          <BrokerOsProvider>
            <Suspense fallback={null}>
              <TopNav />
            </Suspense>
            <Suspense fallback={null}>
              <TrialBanner />
            </Suspense>
            {children}
            <Footer />
            <Suspense fallback={null}>
              <DebugBackendUrl />
            </Suspense>
            <FeedbackBubble />
          </BrokerOsProvider>
        </ClientWorkspaceProvider>
      </body>
    </html>
  );
}
