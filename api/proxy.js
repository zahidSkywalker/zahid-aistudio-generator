// api/proxy.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const perchanceUrl = "https://perchance.org/zahid-aistudio";

    const response = await fetch(perchanceUrl, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0"
      }
    });

    const body = await response.text();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(body);
  } catch (error) {
    res.status(500).send("Error fetching site: " + error.message);
  }
}
