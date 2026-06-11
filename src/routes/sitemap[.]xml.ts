import { createAPIFileRoute } from "@/lib/api-route";

const BASE_URL = "https://project--8951aa20-01ab-48dc-ba51-0835dc420a3c.lovable.app";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const APIRoute = createAPIFileRoute("/sitemap.xml")({
  GET: async () => {
    const entries: SitemapEntry[] = [
      { path: "/", changefreq: "monthly", priority: "1.0" },
      { path: "/auth", changefreq: "monthly", priority: "0.6" },
    ];

    const urls = entries.map((e) =>
      [
        `  <url>`,
        `    <loc>${BASE_URL}${e.path}</loc>`,
        e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
        e.priority ? `    <priority>${e.priority}</priority>` : null,
        `  </url>`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...urls,
      `</urlset>`,
    ].join("\n");

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
});
