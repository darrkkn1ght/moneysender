import fs from "node:fs/promises";

const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNjU5OTE3MDkyfQ.L5dRXep7_imQgT9TlLrL77NSZYJzuv3RhpWKJO_lfo0";
const BASE_URL = "https://lagoslife.eliysites.com/api";

const PATHS = [
  "/venue",
  "/venue?id=quilox",
  "/club",
  "/spend",
  "/save",
  "/politics",
  "/gov",
  "/music"
];

async function exploreClub() {
  console.log("=== Exploring Nightclub Endpoints ===");
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
      let data;
      try { data = JSON.parse(text); } catch (e) { data = text.substring(0, 200); }
      console.log(`[${resp.status}] GET ${path}:`, typeof data === "object" ? Object.keys(data) : String(data).substring(0, 100));
      results[path] = { status: resp.status, data };
    } catch (e) {
      console.error(`[ERR] GET ${path}:`, e.message);
    }
  }

  await fs.writeFile("./club_discovery.json", JSON.stringify(results, null, 2));
}

exploreClub().catch(console.error);
