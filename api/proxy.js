import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    // Build full Perchance URL (keep path & query params)
    const targetUrl = "https://perchance.org" + (req.url.replace("/api/proxy", "") || "/zahid-aistudio");

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0"
      }
    });

    let body = await response.text();

    // Only rewrite for HTML pages
    if (response.headers.get("content-type")?.includes("text/html")) {
      body = body
        .replace(/href="\//g, 'href="/api/proxy/')   // CSS, links
        .replace(/src="\//g, 'src="/api/proxy/')     // JS, images
        .replace(/action="\//g, 'action="/api/proxy/');
    }

    res.setHeader("Content-Type", response.headers.get("content-type") || "text/html; charset=utf-8");
    res.status(response.status).send(body);
  } catch (error) {
    res.status(500).send("Error fetching site: " + error.message);
  }
}
