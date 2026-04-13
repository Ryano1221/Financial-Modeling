import type { MetadataRoute } from "next";

const publicAllow = ["/", "/about", "/docs", "/example", "/security", "/contact", "/brand/", "/llms.txt", "/llms-full.txt"];

const privateDisallow = [
  "/account",
  "/branding",
  "/client",
  "/completed-leases/share",
  "/financial-analyses/share",
  "/report",
  "/sign-in",
  "/sign-up",
  "/sublease-recovery/share",
  "/surveys/share",
  "/upload",
  "/api/",
];

const aiUserAgents = [
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: publicAllow,
        disallow: privateDisallow,
      },
      {
        userAgent: aiUserAgents,
        allow: publicAllow,
        disallow: privateDisallow,
      },
    ],
    sitemap: "https://thecremodel.com/sitemap.xml",
    host: "https://thecremodel.com",
  };
}
