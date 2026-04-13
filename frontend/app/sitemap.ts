import type { MetadataRoute } from "next";

const SITE_URL = "https://thecremodel.com";

const publicRoutes = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/about", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/docs", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/example", priority: 0.75, changeFrequency: "monthly" as const },
  { path: "/security", priority: 0.65, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.6, changeFrequency: "monthly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return publicRoutes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
