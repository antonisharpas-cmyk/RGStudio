import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return {
    /* `/link` is the share card: unlisted on purpose, handed out by address
       rather than found. It is not in sitemap.ts either, and the page itself
       carries `robots: { index: false }` — this stops it being crawled, that
       stops it being indexed. */
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/account", "/api", "/link"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
