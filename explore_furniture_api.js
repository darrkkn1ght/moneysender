import fs from "node:fs/promises";

const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTg6MDU1NjI1fQ.7VzMtbZ14jWfYBHbtBd9tAxUjIlA0fmu8irKlTynBJI";
const BASE_URL = "https://lagoslife.eliysites.com/api";

const PATHS = [
  "/shop",
  "/catalog",
  "/catalogue",
  "/apartment",
  "/house",
  "/room",
  "/furniture",
  "/inventory",
  "/storage",
  "/items",
  "/design",
  "/place",
  "/me"
];

async function main() {
  const results = {};
  for (const path of PATHS) {
    try {
      const resp = await fetch(`${BASE_URL}${path}`, {
        method: "GET",
        headers: {
          "accept": "application/json",
          "cookie": COOKIE,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
      });

      const text = await resp.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parsed = text.substring(0, 300);
      }

      console.log(`[${resp.status}] GET ${path}:`, typeof parsed === "object" ? Object.keys(parsed) : String(parsed).substring(0, 100));
      results[path] = { status: resp.status, data: parsed };
    } catch (err) {
      console.log(`[ERR] GET ${path}:`, err.message);
    }
  }

  await fs.writeFile("./furniture_discovery.json", JSON.stringify(results, null, 2));
  console.log("\nResults saved to ./furniture_discovery.json");
}

main().catch(console.error);
